import { fail, clone, sourceHashes, availableFonts } from './model.mjs';
import { createDocument, applyOperations, materializeDocument, migrateV1 } from './v2-model.mjs';

export function makeV2Service({snapshot,manifest,project,provenance,assets,store}) {
 const key=project.id+':editor-v2';
 const fingerprintPromise=sourceHashes({'src/index.html':snapshot.html,'src/styles.css':snapshot.css,'provenance.json':JSON.stringify(Object.entries(provenance.files||{}).sort(([a],[b])=>a.localeCompare(b)))}).then(x=>x.revision_hash);
 async function load(owner){
  const loaded=await store.read(key,owner),fingerprint=await fingerprintPromise;
  if(!loaded.state.schemaVersion){
   if(loaded.state.head!=='r0'||loaded.state.revisions.length!==1||Object.keys(loaded.state.revisions[0].edits||{}).length)fail('V2_STATE_MISMATCH','El espacio V2 no está vacío',409);
   const document=createDocument(snapshot);
   loaded.state={schemaVersion:2,sourceFingerprint:fingerprint,head:'v2-r0',revisions:[{id:'v2-r0',parent:null,document,createdAt:new Date().toISOString(),label:'Fuente V2',operations:[],...await sourceHashes(materializeDocument(snapshot,document))}],undoStack:[],redoStack:[]};
   await store.save(key,owner,loaded.version,loaded.state);loaded.version++;
  }
  if(loaded.state.schemaVersion!==2||loaded.state.sourceFingerprint!==fingerprint)fail('SOURCE_MISMATCH','La fuente V2 cambió; se requiere migración explícita',409);
  return loaded;
 }
 const current=state=>state.revisions.find(r=>r.id===state.head);
 async function detail(r){const hashes=await sourceHashes(materializeDocument(snapshot,r.document));if(r.revision_hash&&r.revision_hash!==hashes.revision_hash)fail('REVISION_HASH_MISMATCH','La revisión V2 no coincide con su huella',409);return {id:r.id,revision_id:r.id,parent:r.parent,createdAt:r.createdAt,label:r.label,operations:r.operations,...hashes,draft_only:true,deployed:false};}
 async function response(state){return {project:{id:project.id,name:project.name},schemaVersion:2,sourceFingerprint:state.sourceFingerprint,head:state.head,document:clone(current(state).document),canUndo:!!state.undoStack.length,canRedo:!!state.redoStack.length,history:await Promise.all(state.revisions.map(detail)),snapshot,assets,fonts:availableFonts(snapshot.css)};}
 async function invoke(action,args,owner){
  const loaded=await load(owner),state=loaded.state;
  if(action==='load')return response(state);
  if(!args||typeof args!=='object'||Array.isArray(args))fail('INVALID_ARGUMENTS','Argumentos inválidos');
  if(action==='export'){if(Object.keys(args).some(k=>k!=='revision_id')||('revision_id'in args&&typeof args.revision_id!=='string'))fail('INVALID_ARGUMENTS','Revisión inválida');const r=args.revision_id?state.revisions.find(r=>r.id===args.revision_id):current(state);if(!r)fail('UNKNOWN_REVISION','Revisión V2 desconocida',404);return {project_id:project.id,base_commit:provenance.commit,source_fingerprint:state.sourceFingerprint,...await detail(r),files:materializeDocument(snapshot,r.document),requires_human_review:true,deployed:false,instruction:'Borrador V2. Revisar HTML/CSS y móvil. Integración y publicación requieren autorización independiente.'};}
  if(!['save','undo','redo','migrate_v1'].includes(action))fail('UNKNOWN_ACTION','Acción V2 desconocida',404);
  const allowed=action==='save'?['expected_revision','operations','idempotency_key']:action==='migrate_v1'?['expected_revision','v1_revision']:['expected_revision'];
  if(Object.keys(args).some(k=>!allowed.includes(k)))fail('INVALID_ARGUMENTS','Campo no permitido');
  let requestHash;
  if(action==='save'){
   if(typeof args.idempotency_key!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(args.idempotency_key))fail('INVALID_ARGUMENTS','Clave inválida');
   requestHash=(await sourceHashes({request:JSON.stringify(args)})).revision_hash;
   const existing=state.revisions.find(r=>r.requestKey===args.idempotency_key);
   if(existing){if(existing.requestHash!==requestHash)fail('IDEMPOTENCY_CONFLICT','Clave reutilizada',409);if(state.head!==existing.id)fail('REVISION_CONFLICT','El guardado se recibió pero otro borrador avanzó después. Conservá tus cambios locales.',409);return response(state);}
  }
  if(state.head!==args.expected_revision)fail('REVISION_CONFLICT','Otro borrador llegó antes. Tus cambios locales se conservan.',409);
  if(state.revisions.length>=150)fail('REVISION_LIMIT','Exportá el borrador antes de continuar',409);
  let document,operations,label;
  if(action==='save'){
   document=applyOperations(snapshot,current(state).document,args.operations,{fontChoices:availableFonts(snapshot.css)});operations=args.operations;label='Edición V2';
   state.undoStack.push(state.head);state.redoStack=[];
  } else if(action==='migrate_v1'){
   if(state.revisions.length!==1)fail('MIGRATION_NOT_EMPTY','La migración requiere un espacio V2 vacío',409);
   const old=await store.read(project.id,owner),r=old.state.revisions.find(r=>r.id===args.v1_revision);
   const oldFingerprint=(await sourceHashes({fingerprint:JSON.stringify({html:snapshot.html,css:snapshot.css,files:Object.entries(provenance.files||{}).sort(([a],[b])=>a.localeCompare(b))})})).file_hashes.fingerprint;
   if(!r||old.state.sourceFingerprint!==oldFingerprint)fail('SOURCE_MISMATCH','El borrador V1 no corresponde a esta fuente',409);
   document=migrateV1(snapshot,manifest,r.edits);operations=[{type:'migration',source_revision:r.id}];label='Copia explícita de V1';state.undoStack.push(state.head);state.redoStack=[];
  } else {
   const from=action==='undo'?state.undoStack:state.redoStack,to=action==='undo'?state.redoStack:state.undoStack;
   if(!from.length)fail('HISTORY_EMPTY','No hay más historial',409);
   const targetId=from.pop();document=clone(state.revisions.find(r=>r.id===targetId).document);to.push(state.head);operations=[{type:action}];label=action==='undo'?'Deshacer':'Rehacer';
  }
  const r={...await sourceHashes(materializeDocument(snapshot,document)),id:'v2-r'+state.revisions.length,parent:state.head,document,operations:clone(operations),label,createdAt:new Date().toISOString(),...(requestHash?{requestHash,requestKey:args.idempotency_key}:{})};
  state.revisions.push(r);state.head=r.id;
  await store.save(key,owner,loaded.version,state);
  return response(state);
 }
 return {invoke};
}
