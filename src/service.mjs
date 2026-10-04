import { availableFonts, PROPERTIES, VIEWPORTS, fail, clone, revision, checkRevision, mergeChanges, materialize, diffSummary, commitRevision, sourceHashes } from './model.mjs';
import { tasteMarkdown } from './taste.mjs';
export const tools = [
 ['list_projects','Lista los proyectos de borrador accesibles. No expone sitios ajenos.',{}],
 ['open_review','Abre la revisión visual de una copia congelada; no modifica la web publicada.',{project_id:'string',page_id:'string',revision_id:'string?'}],
 ['inspect_page','Árbol acotado y correspondencia con el código de la página. La geometría exacta se mide en la vista visual.',{project_id:'string',page_id:'string',revision_id:'string',viewport:'string?'}],
 ['get_revision','Lee una revisión guardada, su auditoría y los hashes SHA-256 de sus archivos exactos.',{project_id:'string',revision_id:'string'}],
 ['list_saved_changes','Lee revisiones de borrador guardadas con auditoría de campos y cursor incremental. Nunca guarda cambios.',{project_id:'string',cursor:'number?'}],
 ['get_element','Texto y propiedades editables de un elemento del borrador.',{project_id:'string',revision_id:'string',element_id:'string',viewport:'string?'}],
 ['propose_changes','Crea una propuesta revisable; no guarda ni publica la web real.',{project_id:'string',base_revision:'string',changes:'array'}],
 ['discard_changes','Descarta una propuesta pendiente sin alterar el borrador.',{project_id:'string',patch_id:'string',expected_revision:'string'}],
 ['apply_changes','Confirma una propuesta en el historial del BORRADOR fuente. No escribe en Git ni publica.',{project_id:'string',patch_id:'string',expected_revision:'string'}],
 ['restore_revision','Crea una nueva revisión de borrador a partir de una anterior; conserva el historial.',{project_id:'string',revision_id:'string',expected_revision:'string'}],
 ['list_feedback','Lee comentarios de revisión con cursor incremental.',{project_id:'string',cursor:'number?'}],
 ['reply_feedback','Añade una respuesta a un comentario del borrador.',{project_id:'string',feedback_id:'string',text:'string',idempotency_key:'string'}],
 ['get_web_taste','Devuelve las decisiones aprobadas, limitadas a este proyecto.',{project_id:'string'}],
 ['propose_web_taste','Registra una propuesta pendiente; no cambia las decisiones aprobadas.',{project_id:'string',decisions:'array',evidence:'array',expected_revision:'string'}],
 ['export_web_taste','Exporta solo la revisión aprobada como web-taste.md.',{project_id:'string',approved_revision:'string'}],
 ['export_patch','Devuelve los archivos y diferencias del borrador para una integración humana separada.',{project_id:'string',revision_id:'string'}],
];
export const toolSchemas=tools.map(([name,description,shape])=>({name,description,inputSchema:{type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(shape).map(([k,v])=>[k,{type:v.replace('?','')}])),required:Object.entries(shape).filter(([,v])=>!v.endsWith('?')).map(([k])=>k)},annotations:{readOnlyHint:!['propose_changes','discard_changes','apply_changes','restore_revision','reply_feedback','propose_web_taste'].includes(name),destructiveHint:false,openWorldHint:false}}));
const canvasSchema={inputSchema:{required:['project_id','expected_revision','changes','idempotency_key'],properties:{project_id:{},expected_revision:{},changes:{},idempotency_key:{},label:{}}}};
const boundedString=(v,max=2000)=>typeof v==='string'&&v.trim()&&v.length<=max;
export function makeService({snapshot,manifest,provenance,store,project}){
  const PROJECT_ID=project.id,taste=project.taste,fontChoices=availableFonts(snapshot.css);
  const sourceFingerprintPromise=crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({html:snapshot.html,css:snapshot.css,files:Object.entries(provenance.files||{}).sort(([a],[b])=>a.localeCompare(b))}))).then(bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join(''));
  async function loadBound(owner){
    const loaded=await store.read(PROJECT_ID,owner),fingerprint=await sourceFingerprintPromise;
    if(loaded.state.sourceFingerprint===fingerprint)return loaded;
    const s=loaded.state;
    const pristine=!s.sourceFingerprint&&s.head==='r0'&&s.revisions?.length===1&&Object.keys(s.revisions[0].edits||{}).length===0&&!s.patches?.length&&!s.feedback?.length&&!s.tasteProposals?.length;
    if(!pristine)fail('SOURCE_MISMATCH','El historial pertenece a otra fuente o no tiene huella verificable. Restaurá la fuente original o migrá el proyecto con revisión explícita.',409);
    s.sourceFingerprint=fingerprint;await store.save(PROJECT_ID,owner,loaded.version,s);return {state:s,version:loaded.version+1};
  }
  const publicRevision=({edits,direct_save,...r})=>({...r,draft_only:true,deployed:false});
  async function revisionDetails(r){
    const files=materialize(snapshot,manifest,r.edits),hashes=await sourceHashes(files);
    if(r.revision_hash&&r.revision_hash!==hashes.revision_hash)fail('REVISION_HASH_MISMATCH','La revisión guardada no coincide con su huella',409);
    return {...publicRevision(r),revision_id:r.id,...hashes};
  }
  async function commitDraft(state,edits,label,action,context,extra={}){
    const base=revision(state,state.head),changes=diffSummary(manifest,base.edits,edits).map(change=>({...change,operation:change.property==='text'?'text-edit':change.property==='font-size'?'font-resize':['margin-left','margin-top'].includes(change.property)?'flow-move':'style-edit'}));
    const audit={actor:context.transport==='ui'?'user':context.transport==='mcp'?'agent':'unknown',action,origin:action==='save_canvas_changes'?'canvas':context.transport||'service',base_revision:base.id,changes};
    return commitRevision(state,edits,label,{...await sourceHashes(materialize(snapshot,manifest,edits)),audit,draft_only:true,deployed:false,...extra});
  }
  const summary=(state)=>({project_id:PROJECT_ID,name:project.name,subtitle:project.subtitle,pageLabel:project.pageLabel,revisionLabel:project.revisionLabel,source_kind:'frozen-source-draft',source_commit:provenance.commit,available_fonts:fontChoices,head:state.head,page_id:'home',live_apply:false,capabilities:['text','typography','color','spacing','direct-canvas-save','flow-drag','font-resize','responsive-styles','saved-change-audit','responsive-preview','revision-history','patch-export'],manifest,history:state.revisions.map(publicRevision),edits:revision(state,state.head).edits,feedback:state.feedback,canUndo:!!state.undoStack?.length,canRedo:!!state.redoStack?.length,taste});
  async function invoke(name,args,owner,origin,context={}){
    const discovered=toolSchemas.find(t=>t.name===name);
    if(context.transport==='mcp'&&!discovered)fail('UNKNOWN_TOOL','Herramienta desconocida',404);
    if(name==='save_canvas_changes'&&context.transport!=='ui')fail('UI_ONLY_ACTION','Los cambios directos solo se guardan desde el editor visual',403);
    const schema=discovered||(name==='save_canvas_changes'?canvasSchema:null);
    if(!schema&&!['project','add_feedback','undo','redo'].includes(name))fail('UNKNOWN_TOOL','Herramienta desconocida',404);
    if(!args||typeof args!=='object'||Array.isArray(args))fail('INVALID_ARGUMENTS','Argumentos inválidos');
    if(schema){for(const required of schema.inputSchema.required)if(!(required in args))fail('INVALID_ARGUMENTS',`Falta ${required}`);for(const key of Object.keys(args))if(!(key in schema.inputSchema.properties))fail('INVALID_ARGUMENTS',`Campo desconocido: ${key}`);}
    if(name!=='list_projects'&&args.project_id!==PROJECT_ID)fail('UNKNOWN_PROJECT','Proyecto no accesible',404);
    if(args.page_id&&args.page_id!=='home')fail('UNKNOWN_PAGE','Página desconocida',404);
    if(args.viewport!==undefined&&!VIEWPORTS.includes(args.viewport))fail('INVALID_VIEWPORT','Vista no permitida');
    const loaded=await loadBound(owner);const state=loaded.state;state.undoStack??=[];state.redoStack??=[];state.feedbackCursor=Number.isSafeInteger(state.feedbackCursor)?state.feedbackCursor:Math.max(0,...state.feedback.map(f=>Number.isSafeInteger(f.cursor)?f.cursor:0));let mutated=false,result;
    switch(name){
      case 'list_projects': result={projects:[{project_id:PROJECT_ID,name:project.name,subtitle:project.subtitle,pageLabel:project.pageLabel,revisionLabel:project.revisionLabel,source_kind:'frozen-source-draft',live_apply:false}]};break;
      case 'project':result=summary(state);break;
      case 'open_review': {const r=revision(state,args.revision_id||state.head);result={url:`${origin}/?revision=${r.id}`,revision_id:r.id,source_kind:'frozen-source-draft',live_apply:false};break;}
      case 'inspect_page': {const r=revision(state,args.revision_id);result={revision_id:r.id,viewport:args.viewport||'desktop',capabilities:['direct-canvas-save','responsive-styles','flow-drag','font-resize'],elements:manifest.map(n=>({...n,text:r.edits[n.id]?.text??n.text,overrides:{...r.edits[n.id]?.styles,...r.edits[n.id]?.responsive?.[args.viewport||'desktop']},global_overrides:r.edits[n.id]?.styles||{},responsive:r.edits[n.id]?.responsive||{}})),geometry:null,geometry_note:'La vista visual mide la geometría real; no se calcula en el servidor.'};break;}
      case 'get_element': {const r=revision(state,args.revision_id),n=manifest.find(n=>n.id===args.element_id);if(!n)fail('UNKNOWN_ELEMENT','Elemento desconocido',404);result={...n,available_fonts:fontChoices,text:r.edits[n.id]?.text??n.text,overrides:{...r.edits[n.id]?.styles,...r.edits[n.id]?.responsive?.[args.viewport||'desktop']},global_overrides:r.edits[n.id]?.styles||{},responsive:r.edits[n.id]?.responsive||{},viewport:args.viewport||'desktop',revision_id:r.id};break;}
      case 'get_revision': {const r=revision(state,args.revision_id);result={project_id:PROJECT_ID,...await revisionDetails(r),edits:clone(r.edits),source_fingerprint:state.sourceFingerprint};break;}
      case 'list_saved_changes': {const cursor=args.cursor??0;if(!Number.isSafeInteger(cursor)||cursor<0)fail('INVALID_CURSOR','Cursor inválido');result={project_id:PROJECT_ID,head:state.head,items:await Promise.all(state.revisions.slice(1).map((r,index)=>({r,cursor:index+1})).filter(x=>x.cursor>cursor).map(async({r,cursor})=>({...await revisionDetails(r),cursor}))),cursor:Math.max(cursor,state.revisions.length-1),draft_only:true,deployed:false};break;}
      case 'save_canvas_changes': {
        if(!boundedString(args.idempotency_key,100)||('label'in args&&!boundedString(args.label,100)))fail('INVALID_ARGUMENTS','Clave de guardado o etiqueta inválida');
        if(typeof args.expected_revision!=='string')fail('INVALID_ARGUMENTS','Revisión inválida');
        const request_hash=(await sourceHashes({request:JSON.stringify({expected_revision:args.expected_revision,changes:args.changes,label:args.label??null})})).revision_hash;
        const existing=state.revisions.find(r=>r.direct_save?.key===args.idempotency_key);
        if(existing){if(existing.direct_save.request_hash!==request_hash)fail('IDEMPOTENCY_CONFLICT','La clave de guardado ya se usó con otros cambios',409);result={...await revisionDetails(existing),idempotent:true};break;}
        checkRevision(state,args.expected_revision);
        const base=revision(state,state.head),edits=mergeChanges(base.edits,args.changes,manifest,fontChoices),diff=diffSummary(manifest,base.edits,edits);
        if(!diff.length)fail('EMPTY_CHANGE','No hay cambios nuevos');
        state.undoStack.push(state.head);state.redoStack=[];
        const r=await commitDraft(state,edits,args.label||`Edición directa · ${diff.length} cambios`,'save_canvas_changes',context,{direct_save:{key:args.idempotency_key,request_hash}});
        mutated=true;result={...await revisionDetails(r),idempotent:false};break;
      }
      case 'propose_changes': {checkRevision(state,args.base_revision);if(state.patches.filter(p=>!p.appliedRevision).length>=100)fail('PATCH_LIMIT','Demasiadas propuestas pendientes',409);const base=revision(state,state.head),edits=mergeChanges(base.edits,args.changes,manifest,fontChoices),diff=diffSummary(manifest,base.edits,edits);if(!diff.length)fail('EMPTY_CHANGE','No hay cambios nuevos');const patch={id:crypto.randomUUID(),base:state.head,edits,diff,createdAt:new Date().toISOString()};state.patches.push(patch);mutated=true;result={patch_id:patch.id,base_revision:patch.base,diff,preview_revision:`patch:${patch.id}`,draft_only:true};break;}
      case 'discard_changes': {const p=state.patches.find(p=>p.id===args.patch_id);if(!p) {result={discarded:true,idempotent:true};break;}if(p.appliedRevision)fail('PATCH_ALREADY_APPLIED','La propuesta ya está guardada',409);if(p.base!==args.expected_revision)fail('REVISION_CONFLICT','La propuesta pertenece a otra revisión',409);state.patches=state.patches.filter(p=>p.id!==args.patch_id);mutated=true;result={discarded:true};break;}
      case 'apply_changes': {const patch=state.patches.find(p=>p.id===args.patch_id);if(!patch)fail('UNKNOWN_PATCH','Propuesta desconocida',404);if(patch.appliedRevision){if(args.expected_revision!==patch.base)fail('REVISION_CONFLICT','Reintento con revisión diferente',409);result={...await revisionDetails(revision(state,patch.appliedRevision)),idempotent:true};break;}checkRevision(state,args.expected_revision);if(patch.base!==state.head)fail('REVISION_CONFLICT','La propuesta pertenece a una revisión anterior',409);state.undoStack.push(state.head);state.redoStack=[];const r=await commitDraft(state,patch.edits,`Edición visual · ${patch.diff.length} cambios`,'apply_changes',context);patch.appliedRevision=r.id;mutated=true;result=await revisionDetails(r);break;}
      case 'restore_revision': {checkRevision(state,args.expected_revision);state.undoStack.push(state.head);state.redoStack=[];const old=revision(state,args.revision_id),r=await commitDraft(state,old.edits,`Restaurar ${old.id}`,'restore_revision',context,{restored_from:old.id});mutated=true;result=await revisionDetails(r);break;}
      case 'undo': case 'redo': {checkRevision(state,args.expected_revision);const from=name==='undo'?state.undoStack:state.redoStack,to=name==='undo'?state.redoStack:state.undoStack;if(!from.length)fail('HISTORY_EMPTY','No hay revisión disponible',409);const target=revision(state,from.pop());to.push(state.head);const r=await commitDraft(state,target.edits,name==='undo'?'Deshacer':'Rehacer',name,context,{restored_from:target.id});mutated=true;result=await revisionDetails(r);break;}
      case 'list_feedback': {const cursor=args.cursor??0;if(!Number.isSafeInteger(cursor)||cursor<0)fail('INVALID_CURSOR','Cursor inválido');result={items:state.feedback.filter(f=>f.cursor>cursor).sort((a,b)=>a.cursor-b.cursor),cursor:state.feedbackCursor||0};break;}
      case 'add_feedback': {checkRevision(state,args.expected_revision);if(!boundedString(args.text)||!manifest.some(n=>n.id===args.element_id))fail('INVALID_FEEDBACK','Comentario inválido');if(state.feedback.length>=200)fail('FEEDBACK_LIMIT','Límite de comentarios alcanzado');const item={id:crypto.randomUUID(),cursor:++state.feedbackCursor,revision_id:state.head,element_id:args.element_id,text:args.text,replies:[],createdAt:new Date().toISOString()};state.feedback.push(item);mutated=true;result=item;break;}
      case 'reply_feedback': {if(!boundedString(args.text)||!boundedString(args.idempotency_key,100))fail('INVALID_FEEDBACK','Respuesta inválida');const f=state.feedback.find(f=>f.id===args.feedback_id);if(!f)fail('UNKNOWN_FEEDBACK','Comentario desconocido',404);const existing=f.replies.find(r=>r.key===args.idempotency_key);if(existing){if(existing.text!==args.text)fail('IDEMPOTENCY_CONFLICT','La clave ya se usó con otro texto',409);result={accepted:true,id:existing.id};break;}if(f.replies.length>=50)fail('FEEDBACK_LIMIT','Límite de respuestas');const reply={id:crypto.randomUUID(),key:args.idempotency_key,text:args.text,createdAt:new Date().toISOString()};f.replies.push(reply);f.cursor=++state.feedbackCursor;mutated=true;result={accepted:true,id:reply.id};break;}
      case 'get_web_taste':result=taste;break;
      case 'propose_web_taste': {checkRevision(state,args.expected_revision);if(!Array.isArray(args.decisions)||!args.decisions.length||args.decisions.length>10||!args.decisions.every(x=>boundedString(x,1000))||!Array.isArray(args.evidence)||args.evidence.length>10||!args.evidence.every(x=>boundedString(x,2000)))fail('INVALID_TASTE','Propuesta de gusto inválida');if(state.tasteProposals.length>=50)fail('TASTE_LIMIT','Límite de propuestas');const p={id:crypto.randomUUID(),decisions:args.decisions,evidence:args.evidence,status:'pending-human-approval',createdAt:new Date().toISOString()};state.tasteProposals.push(p);mutated=true;result=p;break;}
      case 'export_web_taste':if(args.approved_revision!==taste.revision)fail('UNKNOWN_TASTE','Revisión de gusto no aprobada',409);result={filename:'web-taste.md',content:tasteMarkdown(taste)};break;
      case 'export_patch': {const r=revision(state,args.revision_id);result={project_id:PROJECT_ID,base_commit:provenance.commit,source_fingerprint:state.sourceFingerprint,...await revisionDetails(r),source_kind:'frozen-source-draft',requires_human_review:true,deployed:false,files:materialize(snapshot,manifest,r.edits),changes:diffSummary(manifest,{},r.edits),instruction:'Revisar contra el commit base, aplicar al repositorio correcto y verificar pruebas con autorización independiente. No contiene lógica de agenda ni permisos de publicación.'};break;}
    }
    if(mutated)await store.save(PROJECT_ID,owner,loaded.version,state);
    return result;
  }
  return {invoke,async getRevision(owner,id){const {state}=await loadBound(owner);if(id?.startsWith('patch:')){const p=state.patches.find(p=>'patch:'+p.id===id);if(!p)fail('UNKNOWN_PATCH','Propuesta desconocida',404);return {id,edits:p.edits};}const r=revision(state,id||state.head);return {...await revisionDetails(r),edits:clone(r.edits)};}};
}
