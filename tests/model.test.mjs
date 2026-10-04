import test from 'node:test';import assert from 'node:assert/strict';import { readFile } from 'node:fs/promises';
import { makeService,toolSchemas } from '../src/service.mjs';import { createWorker } from '../src/worker.mjs';import { initialState,makeManifest,materialize,mergeChanges } from '../src/model.mjs';import { previewHTML } from '../src/preview.mjs';import { DatabaseSync } from 'node:sqlite';
const bundle=JSON.parse(await readFile('.local/bundle.json','utf8'));const owner='verified-owner';
function memoryStore(){let version=0,state=initialState();return {async read(id,user){return {version,state:structuredClone(state)}},async save(id,user,v,s){if(v!==version)throw Error('conflict');state=structuredClone(s);version++;}};}
function env(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE editor_projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,version INTEGER NOT NULL,state_json TEXT NOT NULL,updated_at TEXT NOT NULL)');return {EDITOR_OWNER_USER_ID:owner,DB:{prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}}}}}};}
const req=(path,body,user=owner)=>new Request('https://editor.example'+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},...(body?{body:JSON.stringify(body)}:{})});
test('exact no-op source, safe text/style roundtrip and original untouched',()=>{const leaf=bundle.manifest.find(n=>n.text==='MAKE ROOM.');assert.ok(leaf);const edits=mergeChanges({},[{element_id:leaf.id,text:'MI ESTILO. <seguro>',styles:{color:'#aabbcc','font-size':'84px','padding-top':'16px','font-family':'Anton'}}],bundle.manifest);const files=materialize(bundle.snapshot,bundle.manifest,edits);assert.match(files['src/index.html'],/MI ESTILO\. &lt;seguro&gt;/);assert.match(files['src/styles.css'],/color: #aabbcc/);assert.match(bundle.snapshot.html,/MAKE ROOM\./);assert.equal(materialize(bundle.snapshot,bundle.manifest,{})['src/index.html'],bundle.snapshot.html);assert.equal(materialize(bundle.snapshot,bundle.manifest,{})['src/styles.css'],bundle.snapshot.css);});
test('reject script style injection, arbitrary elements, properties and huge text',()=>{const n=bundle.manifest.find(x=>x.text==='MAKE ROOM.');for(const changes of [[{element_id:n.id,styles:{color:'url(https://evil.test)'}}],[{element_id:n.id,styles:{position:'fixed'}}],[{element_id:'../etc/passwd',text:'x'}],[{element_id:n.id,text:'x'.repeat(501)}],[{element_id:n.id,styles:{'font-family':'Arial;display:none'}}]])assert.throws(()=>mergeChanges({},changes,bundle.manifest));});
test('draft save/reload, stale rejection, idempotent apply, undo/redo and immutable history',async()=>{const service=makeService({...bundle,store:memoryStore()});const call=(n,args={})=>service.invoke(n,{project_id:bundle.project.id,...args},owner,'https://editor.example');const n=bundle.manifest.find(x=>x.text==='MAKE ROOM.');const p=await call('propose_changes',{base_revision:'r0',changes:[{element_id:n.id,text:'ESTILO NUEVO.',styles:{color:'#ffffff'}}]});const applied=await call('apply_changes',{patch_id:p.patch_id,expected_revision:'r0'});assert.equal(applied.revision_id,'r1');assert.equal((await call('project')).edits[n.id].text,'ESTILO NUEVO.');assert.equal((await call('apply_changes',{patch_id:p.patch_id,expected_revision:'r0'})).idempotent,true);await assert.rejects(()=>call('propose_changes',{base_revision:'r0',changes:[{element_id:n.id,text:'STILL STALE'}]}),e=>e.code==='REVISION_CONFLICT');await call('undo',{expected_revision:'r1'});assert.equal((await call('project')).head,'r2');assert.deepEqual((await call('project')).edits,{});await call('redo',{expected_revision:'r2'});assert.equal((await call('project')).edits[n.id].text,'ESTILO NUEVO.');const exported=await call('export_patch',{revision_id:'r3'});assert.match(exported.files['src/index.html'],/ESTILO NUEVO\./);assert.equal(exported.deployed,false);assert.equal(exported.base_commit,bundle.provenance.commit);});
test('deny no identity, wrong owner, unconfigured owner and wrong project; discovery private-data free',async()=>{const worker=createWorker(bundle),e=env();for(const [user,status] of [[null,401],['attacker',403]]){const response=await worker.fetch(req('/api/project',null,user),e);assert.equal(response.status,status);assert.doesNotMatch(await response.text(),/MAKE ROOM/);}assert.equal((await worker.fetch(req('/api/project'),{DB:e.DB})).status,503);const discovery=await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},null),e);assert.equal(discovery.status,200);assert.doesNotMatch(await discovery.text(),/synthetic-demo-v1|MAKE ROOM/);const wrong=await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_web_taste',arguments:{project_id:'other'}}}),e);assert.equal(wrong.status,200);const wrongBody=await wrong.json();assert.equal(wrongBody.id,2);assert.equal(wrongBody.result.isError,true);assert.match(wrongBody.result.content[0].text,/UNKNOWN_PROJECT/);});
test('D1 compare-and-swap blocks stale writes and persistence survives service recreation',async()=>{const e=env(),worker=createWorker(bundle);const n=bundle.manifest.find(x=>x.text==='MAKE ROOM.');const p=await(await worker.fetch(req('/api/action',{action:'propose_changes',args:{base_revision:'r0',changes:[{element_id:n.id,text:'Persistido'}]}}),e)).json();await worker.fetch(req('/api/action',{action:'apply_changes',args:{patch_id:p.patch_id,expected_revision:'r0'}}),e);const loaded=await(await createWorker(bundle).fetch(req('/api/project'),e)).json();assert.equal(loaded.edits[n.id].text,'Persistido');const {D1Store}=await import('../src/storage.mjs');const store=new D1Store(e.DB),a=await store.read(bundle.project.id,owner),b=await store.read(bundle.project.id,owner);await store.save(bundle.project.id,owner,a.version,a.state);await assert.rejects(()=>store.save(bundle.project.id,owner,b.version,b.state),x=>x.code==='REVISION_CONFLICT');});
test('preview strips active content, external image URLs, source scripts and navigation',()=>{const malicious={...bundle.snapshot,html:bundle.snapshot.html.replace('</body>','<script>alert(1)</script><img src="https://evil.test/a" onerror="parent.fetch(1)"><iframe src="https://evil.test"></iframe><form action="/api/action"></form></body>')};const html=previewHTML(malicious,makeManifest(malicious.html),{},bundle.assets,{nonce:'12345678-1234-1234-1234-123456789abc',project_id:bundle.project.id,revision_id:'r0'});assert.doesNotMatch(html,/alert\(1\)|onerror=|<iframe|<form|motion\.js|href=/);assert.doesNotMatch(html,/https:\/\/evil/);assert.match(html,/connect-src 'none'/);assert.equal((html.match(/<script /g)||[]).length,1);});
test('MCP init, tool calls and owner-bound source export',async()=>{const worker=createWorker(bundle),e=env();const init=await(await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:1,method:'initialize'},null),e)).json();assert.equal(init.result.serverInfo.name,'source-visual-editor');const call=await(await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'export_web_taste',arguments:{project_id:bundle.project.id,approved_revision:bundle.project.taste.revision}}}),e)).json();assert.equal(call.result.structuredContent.filename,'web-taste.md');assert.match(call.result.structuredContent.content,/not universally/);const denied=await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_projects',arguments:{}}},null),e);assert.equal(denied.status,401);});
test('worker is browser-compatible and has no shell, filesystem, local identity bypass or upstream runtime',async()=>{const built=await readFile('dist/server/index.js','utf8');assert.doesNotMatch(built,/node:fs|node:sqlite|child_process|local-owner|localhost:4173|npx -y/);});

test('evidence locks propagate to all rating and review descendants',()=>{const evidenceManifest=makeManifest('<html><body><main><p class=rating-summary><strong>4.2 <span>/ 5</span></strong></p></main></body></html>');const rating=evidenceManifest.find(x=>x.label==='rating-summary');const descendants=evidenceManifest.filter(x=>x.selector.startsWith(rating.selector+' > '));assert.ok(descendants.length);assert.ok(descendants.every(x=>!x.editable.text&&x.lockedReason));});
test('replies advance feedback cursor, idempotency stays stable, canceled proposals do not consume quota',async()=>{const service=makeService({...bundle,store:memoryStore()});const call=(n,args={})=>service.invoke(n,{project_id:bundle.project.id,...args},owner,'https://editor.example');const n=bundle.manifest.find(x=>x.text==='MAKE ROOM.');const feedback=await call('add_feedback',{element_id:n.id,text:'Revisar título',expected_revision:'r0'});await call('reply_feedback',{feedback_id:feedback.id,text:'Listo',idempotency_key:'reply-1'});const updates=await call('list_feedback',{cursor:feedback.cursor});assert.equal(updates.items.length,1);assert.equal(updates.cursor,2);await call('reply_feedback',{feedback_id:feedback.id,text:'Listo',idempotency_key:'reply-1'});assert.equal((await call('list_feedback',{cursor:2})).items.length,0);for(let i=0;i<105;i++){const p=await call('propose_changes',{base_revision:'r0',changes:[{element_id:n.id,text:'Otra propuesta '+i}]});await call('discard_changes',{patch_id:p.patch_id,expected_revision:'r0'});}assert.equal((await call('project')).head,'r0');});

test('source fingerprint rejects changed source under same project ID, including preview',async()=>{const store=memoryStore(),service=makeService({...bundle,store});const call=(n,args={})=>service.invoke(n,{project_id:bundle.project.id,...args},owner,'https://editor.example');const n=bundle.manifest.find(x=>x.text==='MAKE ROOM.');const p=await call('propose_changes',{base_revision:'r0',changes:[{element_id:n.id,text:'Saved on old source'}]});await call('apply_changes',{patch_id:p.patch_id,expected_revision:'r0'});const changed={...bundle.snapshot,html:bundle.snapshot.html.replace('<main>','<main><p>New unrelated paragraph</p>')};const other=makeService({...bundle,snapshot:changed,manifest:makeManifest(changed.html),store});await assert.rejects(()=>other.invoke('export_patch',{project_id:bundle.project.id,revision_id:'r1'},owner,'https://editor.example'),e=>e.code==='SOURCE_MISMATCH');await assert.rejects(()=>other.getRevision(owner,'r1'),e=>e.code==='SOURCE_MISMATCH');});
test('legacy edited state without source fingerprint fails closed; pristine state can bind',async()=>{const state=initialState();state.revisions.push({...state.revisions[0],id:'r1',parent:'r0'});state.head='r1';const legacy={async read(){return {version:0,state:structuredClone(state)}},async save(){throw Error('Legacy edited state must never be auto-bound')}};const service=makeService({...bundle,store:legacy});await assert.rejects(()=>service.invoke('project',{project_id:bundle.project.id},owner,'https://editor.example'),e=>e.code==='SOURCE_MISMATCH');});

test('font choices reflect bundled faces plus system fonts; missing faces are rejected',async()=>{const service=makeService({...bundle,store:memoryStore()});const call=(n,args={})=>service.invoke(n,{project_id:bundle.project.id,...args},owner,'https://editor.example');assert.deepEqual((await call('project')).available_fonts,['Arial','Georgia']);const node=bundle.manifest.find(n=>n.text==='MAKE ROOM.');await assert.rejects(()=>call('propose_changes',{base_revision:'r0',changes:[{element_id:node.id,styles:{'font-family':'Barlow Condensed'}}]}),e=>e.code==='INVALID_STYLE');});

test('responsive source operations remain bounded, scope styles and keep text shared',()=>{
  const node=bundle.manifest.find(n=>n.text==='MAKE ROOM.');
  const edits=mergeChanges({},[
    {element_id:node.id,styles:{color:'#aabbcc'}},
    {element_id:node.id,viewport:'desktop',text:'<script>& "quotes"</script>',styles:{'font-size':'100px','margin-left':'24px','margin-top':'8px'}},
    {element_id:node.id,viewport:'tablet',styles:{'font-size':'60px'}},
    {element_id:node.id,viewport:'mobile',styles:{'font-size':'32px'}},
  ],bundle.manifest);
  assert.deepEqual(edits[node.id].styles,{color:'#aabbcc'});
  assert.equal(edits[node.id].responsive.desktop['margin-left'],'24px');
  assert.equal(edits[node.id].text,'<script>& "quotes"</script>');
  const files=materialize(bundle.snapshot,bundle.manifest,edits);
  assert.ok(files['src/index.html'].includes('&lt;script&gt;&amp; "quotes"&lt;/script&gt;'));
  assert.match(files['src/styles.css'],/@media \(min-width: 1024px\) \{[\s\S]*font-size: 100px;/);
  assert.match(files['src/styles.css'],/@media \(min-width: 768px\) and \(max-width: 1023px\) \{/);
  assert.match(files['src/styles.css'],/@media \(max-width: 767px\) \{[\s\S]*font-size: 32px;/);
  for(const change of [
    {element_id:node.id,viewport:'wide',styles:{'font-size':'30px'}},
    {element_id:node.id,viewport:'mobile',styles:{transform:'translate(10px)'}},
    {element_id:node.id,viewport:'desktop',styles:{position:'absolute'}},
    {element_id:node.id,viewport:'desktop',styles:{'margin-left':'-1px'}},
    {element_id:node.id,viewport:'desktop',styles:{'margin-top':'161px'}},
    {element_id:node.id,viewport:'desktop',styles:{'font-size':'221px'}},
  ])assert.throws(()=>mergeChanges({},[change],bundle.manifest));
});

test('direct save is UI-only and owner authenticated; MCP only calls discovered tools',async()=>{
  const worker=createWorker(bundle),e=env(),node=bundle.manifest.find(n=>n.text==='MAKE ROOM.');
  const args={expected_revision:'r0',idempotency_key:'save-ui-1',changes:[{element_id:node.id,text:'Directly saved'}]};
  assert.ok(!toolSchemas.some(t=>t.name==='save_canvas_changes'));
  for(const name of ['get_revision','list_saved_changes'])assert.equal(toolSchemas.find(t=>t.name===name).annotations.readOnlyHint,true);
  for(const [user,status] of [[null,401],['attacker',403]])assert.equal((await worker.fetch(req('/api/action',{action:'save_canvas_changes',args},user),e)).status,status);
  assert.equal((await worker.fetch(req('/api/action',{action:'save_canvas_changes',args}),{DB:e.DB})).status,503);
  const crossOrigin=req('/api/action',{action:'save_canvas_changes',args});crossOrigin.headers.set('origin','https://evil.test');
  assert.equal((await worker.fetch(crossOrigin,e)).status,403);
  for(const name of ['save_canvas_changes','project','undo','redo']){
    const result=await(await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:7,method:'tools/call',params:{name,arguments:{project_id:bundle.project.id,...args}}}),e)).json();
    assert.equal(result.result.isError,true);assert.match(result.result.content[0].text,/UNKNOWN_TOOL/);
  }
  const service=makeService({...bundle,store:memoryStore()});
  await assert.rejects(()=>service.invoke('save_canvas_changes',{project_id:bundle.project.id,...args},owner,'https://editor.example'),x=>x.code==='UI_ONLY_ACTION');
  const saved=await(await worker.fetch(req('/api/action',{action:'save_canvas_changes',args}),e)).json();
  assert.equal(saved.revision_id,'r1');assert.equal(saved.audit.actor,'user');assert.equal(saved.audit.origin,'canvas');
  assert.equal(saved.draft_only,true);assert.equal(saved.deployed,false);
  const extra=await worker.fetch(req('/api/action',{action:'save_canvas_changes',args:{...args,transport:'ui'}}),e);
  assert.equal(extra.status,400);
});

test('atomic direct save has exact source hashes, per-field audit, idempotency and incremental read-only exports',async()=>{
  const {createHash}=await import('node:crypto');
  const store=memoryStore(),service=makeService({...bundle,store}),origin='https://editor.example';
  const call=(n,args={})=>service.invoke(n,{project_id:bundle.project.id,...args},owner,origin,{transport:'ui'});
  const first=bundle.manifest.find(n=>n.text==='MAKE ROOM.'),second=bundle.manifest.find(n=>n.editable.text&&n.id!==first.id);
  const initial=await store.read();await call('project');const bound=await store.read();
  const args={expected_revision:'r0',idempotency_key:'canvas-save-a',changes:[
    {element_id:first.id,text:'Direct & <safe> "source"',viewport:'desktop',styles:{'font-size':'100px','margin-left':'18px'}},
    {element_id:second.id,viewport:'mobile',styles:{'margin-top':'12px'}},
  ]};
  const saved=await call('save_canvas_changes',args);assert.equal(saved.revision_id,'r1');assert.equal(saved.audit.base_revision,'r0');
  assert.equal(saved.audit.changes.length,4);assert.equal(saved.audit.changes.find(x=>x.property==='text').before,'MAKE ROOM.');
  assert.equal(saved.audit.changes.find(x=>x.property==='font-size').viewport,'desktop');
  assert.equal(saved.audit.changes.find(x=>x.property==='font-size').operation,'font-resize');
  assert.equal(saved.audit.changes.find(x=>x.property==='margin-left').before_override,null);
  assert.equal(saved.audit.changes.find(x=>x.property==='margin-left').after_override,'18px');
  assert.equal(saved.audit.changes.find(x=>x.property==='margin-left').operation,'flow-move');
  const persisted=await store.read();assert.equal(persisted.version,bound.version+1);assert.equal(persisted.state.patches.length,0);
  assert.deepEqual(persisted.state.revisions[0],initial.state.revisions[0]);assert.equal(persisted.state.sourceFingerprint,bound.state.sourceFingerprint);
  const exported=await call('export_patch',{revision_id:'r1'});
  for(const [path,content] of Object.entries(exported.files))assert.equal(saved.file_hashes[path],createHash('sha256').update(content,'utf8').digest('hex'));
  const canonical=Object.fromEntries(Object.entries(exported.files).sort(([a],[b])=>a.localeCompare(b)));
  assert.equal(saved.revision_hash,createHash('sha256').update(JSON.stringify(canonical),'utf8').digest('hex'));
  assert.equal(exported.revision_hash,saved.revision_hash);assert.deepEqual(exported.audit,saved.audit);
  assert.equal(exported.hash_algorithm,'SHA-256');assert.equal(exported.hash_format,'json-files-v1');
  assert.ok(exported.files['src/index.html'].includes('Direct &amp; &lt;safe&gt; "source"'));
  const retried=await call('save_canvas_changes',args);assert.equal(retried.idempotent,true);assert.equal(retried.revision_hash,saved.revision_hash);
  assert.equal((await store.read()).version,persisted.version);
  await assert.rejects(()=>call('save_canvas_changes',{...args,changes:[{element_id:first.id,text:'Different'}]}),x=>x.code==='IDEMPOTENCY_CONFLICT');
  await assert.rejects(()=>call('save_canvas_changes',{...args,idempotency_key:'stale'}),x=>x.code==='REVISION_CONFLICT');
  const agent=(n,args={})=>service.invoke(n,{project_id:bundle.project.id,...args},owner,origin,{transport:'mcp'});
  const list=await agent('list_saved_changes');assert.equal(list.cursor,1);assert.equal(list.items.length,1);assert.equal(list.items[0].revision_hash,saved.revision_hash);
  assert.equal((await agent('list_saved_changes',{cursor:1})).items.length,0);
  await assert.rejects(()=>agent('list_saved_changes',{cursor:-1}),x=>x.code==='INVALID_CURSOR');
  const r=await agent('get_revision',{revision_id:'r1'});assert.deepEqual(r.edits,persisted.state.revisions[1].edits);assert.equal(r.revision_hash,saved.revision_hash);assert.equal(r.direct_save,undefined);
  assert.equal((await store.read()).version,persisted.version);
  const element=await call('get_element',{revision_id:'r1',element_id:first.id,viewport:'desktop'});assert.equal(element.overrides['font-size'],'100px');assert.equal(element.responsive.desktop['font-size'],'100px');
  assert.equal((await call('get_element',{revision_id:'r1',element_id:first.id,viewport:'mobile'})).overrides['font-size'],undefined);
});

test('save validation is all-or-nothing and rejects empty or oversized drafts',async()=>{
  const store=memoryStore(),service=makeService({...bundle,store}),n=bundle.manifest.find(n=>n.text==='MAKE ROOM.');
  const call=args=>service.invoke('save_canvas_changes',{project_id:bundle.project.id,expected_revision:'r0',idempotency_key:'validation',...args},owner,'https://editor.example',{transport:'ui'});
  await service.invoke('project',{project_id:bundle.project.id},owner,'https://editor.example');
  const before=await store.read();
  for(const args of [
    {changes:[]},
    {changes:[{element_id:n.id,text:n.text}]},
    {changes:Array.from({length:31},()=>({element_id:n.id,text:'New'}))},
    {changes:[{element_id:n.id,text:'First valid edit'},{element_id:n.id,styles:{transform:'translateX(1px)'}}]},
    {changes:[{element_id:n.id,text:'New'}],idempotency_key:''},
    {changes:[{element_id:n.id,text:'New'}],label:'x'.repeat(101)},
  ]){await assert.rejects(()=>call(args));assert.deepEqual(await store.read(),before);}
  const saved=await call({changes:Array.from({length:30},(_,i)=>({element_id:n.id,text:'Valid '+i}))});assert.equal(saved.revision_id,'r1');
});

test('undo, redo and restore append immutable user audit and preserve source fingerprints and prior hashes',async()=>{
  const store=memoryStore(),service=makeService({...bundle,store}),n=bundle.manifest.find(n=>n.text==='MAKE ROOM.');
  const call=(name,args={})=>service.invoke(name,{project_id:bundle.project.id,...args},owner,'https://editor.example',{transport:'ui'});
  const saved=await call('save_canvas_changes',{expected_revision:'r0',idempotency_key:'history-save',changes:[{element_id:n.id,text:'History safe',viewport:'mobile',styles:{'font-size':'32px'}}]});
  const before=await store.read();
  const undone=await call('undo',{expected_revision:'r1'});assert.equal(undone.audit.actor,'user');assert.equal(undone.audit.action,'undo');assert.equal(undone.audit.changes.find(x=>x.property==='text').before,'History safe');assert.equal(undone.audit.changes.find(x=>x.property==='font-size').after_override,null);
  assert.equal(undone.revision_hash,(await call('get_revision',{revision_id:'r0'})).revision_hash);
  const redone=await call('redo',{expected_revision:'r2'});assert.equal(redone.audit.action,'redo');assert.equal(redone.revision_hash,saved.revision_hash);
  const restored=await call('restore_revision',{expected_revision:'r3',revision_id:'r0'});assert.equal(restored.audit.action,'restore_revision');assert.equal(restored.audit.actor,'user');assert.equal(restored.restored_from,'r0');assert.equal(restored.deployed,false);
  const after=await store.read();assert.deepEqual(after.state.revisions.slice(0,2),before.state.revisions);assert.equal(after.state.sourceFingerprint,before.state.sourceFingerprint);
  const list=await call('list_saved_changes',{cursor:1});assert.deepEqual(list.items.map(r=>r.audit.action),['undo','redo','restore_revision']);assert.equal(list.cursor,4);
});

test('simultaneous direct saves commit once and CAS prevents losing the winning audit',async()=>{
  const worker=createWorker(bundle),e=env(),n=bundle.manifest.find(n=>n.text==='MAKE ROOM.');
  await worker.fetch(req('/api/project'),e);
  const responses=await Promise.all(['First','Second'].map((text,index)=>worker.fetch(req('/api/action',{action:'save_canvas_changes',args:{expected_revision:'r0',idempotency_key:'race-'+index,changes:[{element_id:n.id,text}]}}),e)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const project=await(await worker.fetch(req('/api/project'),e)).json();assert.equal(project.head,'r1');assert.equal(project.history.length,2);
  const list=await(await worker.fetch(req('/api/action',{action:'list_saved_changes',args:{cursor:0}}),e)).json();assert.equal(list.items.length,1);assert.equal(list.items[0].audit.changes[0].after,project.edits[n.id].text);
});

test('revision reads and export fail closed when persisted materialized bytes no longer match the saved hash',async()=>{
  const store=memoryStore(),service=makeService({...bundle,store}),n=bundle.manifest.find(n=>n.text==='MAKE ROOM.');
  const call=(name,args={})=>service.invoke(name,{project_id:bundle.project.id,...args},owner,'https://editor.example',{transport:'ui'});
  await call('save_canvas_changes',{expected_revision:'r0',idempotency_key:'hash-check',changes:[{element_id:n.id,text:'Verified content'}]});
  const damaged=await store.read();damaged.state.revisions[1].edits[n.id].text='Unexpected storage change';
  await store.save(bundle.project.id,owner,damaged.version,damaged.state);
  for(const [name,args] of [['get_revision',{revision_id:'r1'}],['export_patch',{revision_id:'r1'}],['list_saved_changes',{}]])await assert.rejects(()=>call(name,args),x=>x.code==='REVISION_HASH_MISMATCH');
  await assert.rejects(()=>service.getRevision(owner,'r1'),x=>x.code==='REVISION_HASH_MISMATCH');
});
