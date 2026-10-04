import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {JSDOM,VirtualConsole} from 'jsdom';
import {createWorker} from '../src/worker.mjs';
const bundle=JSON.parse(await readFile('.local/bundle.json','utf8'));
assert.equal(bundle.project.id,'studio-demo');
const html=await readFile('ui/index.html','utf8'),script=await readFile('ui/editor.js','utf8');
const leaf=bundle.manifest.find(n=>n.text==='MAKE ROOM.');
function backend(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE editor_projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,version INTEGER NOT NULL,state_json TEXT NOT NULL,updated_at TEXT NOT NULL)');
 const DB={prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}};}};
 const worker=createWorker(bundle),env={EDITOR_OWNER_USER_ID:'review-owner',DB};
 return {async fetch(path,opts={}){return worker.fetch(new Request('https://editor.test'+path,{...opts,headers:{...opts.headers,'oai-authenticated-user-id':'review-owner'}}),env);},async action(action,args){const response=await this.fetch('/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,args})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}};
}
async function until(condition){for(let i=0;i<200;i++){if(condition())return;await new Promise(r=>setTimeout(r,5));}throw Error('DOM condition not reached');}
async function open(api,path='/'){
 const vc=new VirtualConsole();const dom=new JSDOM(html,{url:'https://editor.test'+path,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;w.fetch=(...args)=>api.fetch(...args);w.crypto.randomUUID=()=>crypto.randomUUID();w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};w.eval(script+"\nwindow.reviewGetChanges=changesToSave;");await until(()=>/Guardado|Viendo/.test(w.document.querySelector('#status').textContent));return {dom,w,d:w.document};
}
const click=(ui,s)=>ui.d.querySelector(s).click();
function input(ui,s,value){const e=ui.d.querySelector(s);e.dispatchEvent(new ui.w.Event('focus'));e.value=value;e.dispatchEvent(new ui.w.Event('input',{bubbles:true}));}
function bridgeReady(ui){const frame=ui.d.querySelector('#preview'),url=new URL(frame.src),posts=[];frame.contentWindow.postMessage=data=>posts.push(data);ui.w.dispatchEvent(new ui.w.MessageEvent('message',{origin:'null',source:frame.contentWindow,data:{type:'ve:ready',project_id:bundle.project.id,revision_id:url.searchParams.get('revision'),nonce:url.searchParams.get('nonce')}}));return posts;}

test('review: resizing original comparison must never apply draft edits to original frame',async()=>{
 const api=backend(),ui=await open(api);try{click(ui,`[data-id="${leaf.id}"]`);input(ui,'#text-edit','UNSAVED ORIGINAL CHECK');click(ui,'#compare');const posts=bridgeReady(ui);ui.w.dispatchEvent(new ui.w.Event('resize'));await new Promise(r=>setTimeout(r,40));assert.equal(posts.some(p=>p.type==='ve:sync'&&p.edits[leaf.id]?.text==='UNSAVED ORIGINAL CHECK'),false);}finally{ui.dom.window.close();}
});
test('review: historical desktop-only styles must not become global on mobile',async()=>{
 const api=backend();await api.action('save_canvas_changes',{expected_revision:'r0',idempotency_key:'review-historic',changes:[{element_id:leaf.id,viewport:'desktop',styles:{'font-size':'101px'}}]});const ui=await open(api,'/?revision=r1');try{const posts=bridgeReady(ui);click(ui,'[data-width="390"]');await new Promise(r=>setTimeout(r,750));const latest=posts.filter(p=>p.type==='ve:sync').at(-1);assert.ok(latest);assert.equal(latest.edits[leaf.id]?.styles?.['font-size'],undefined);}finally{ui.dom.window.close();}
});
test('review: comment refresh must not silently rebase stale text edits over unseen saved text',async()=>{
 const api=backend(),ui=await open(api);try{click(ui,`[data-id="${leaf.id}"]`);input(ui,'[data-prop="font-size"]','76');let advanced=false;const fetch=api.fetch.bind(api);api.fetch=async(path,opts={})=>{const response=await fetch(path,opts);if(path==='/api/action'&&JSON.parse(opts.body).action==='add_feedback'&&!advanced){advanced=true;await api.action('save_canvas_changes',{expected_revision:'r0',idempotency_key:'review-concurrent',changes:[{element_id:leaf.id,text:'EXTERNAL SAVED TEXT'}]});}return response;};input(ui,'#comment','A synthetic review comment');click(ui,'#add-comment');await until(()=>ui.d.querySelector('#status').textContent.includes('conservan su revisión base'));const changes=ui.w.reviewGetChanges();assert.equal(changes.some(c=>c.element_id===leaf.id&&c.text==='MAKE ROOM.'),false,JSON.stringify(changes));click(ui,'#save');await until(()=>ui.d.querySelector('#status').textContent.includes('Tus ajustes siguen aquí'));const saved=await(await api.fetch('/api/project')).json();assert.equal(saved.head,'r1');assert.equal(saved.edits[leaf.id].text,'EXTERNAL SAVED TEXT');assert.equal(ui.d.querySelector('[data-prop="font-size"]').value,'76');}finally{ui.dom.window.close();}
});

import {canvasBridge} from '../src/canvas-bridge.mjs';
import {PROPERTIES} from '../src/model.mjs';
function isolatedBridge(){
 const dom=new JSDOM('<!doctype html><body><main><h1 data-ve-id="el-1">Synthetic heading</h1><p data-ve-id="el-2">Second synthetic item</p></main></body>',{url:'https://preview.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,posts=[];
 w.crypto.randomUUID=()=>crypto.randomUUID();w.ResizeObserver=class{observe(){}};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLElement.prototype.setPointerCapture=()=>{};w.postMessage=data=>posts.push(data);
 const scope={nonce:'review-nonce',project_id:'studio-demo',revision_id:'r0'};
 w.eval(`(${canvasBridge.toString()})(${JSON.stringify(scope)},${JSON.stringify(PROPERTIES)},["el-1","el-2"]);`);
 const message=data=>w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{...scope,...data}}));
 message({type:'ve:configure',editable:true});message({type:'ve:select',element_id:'el-1'});
 return {dom,w,d:w.document,posts,message};
}
function pointer(ui,target,type,point={}){const event=new ui.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,...point});Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event);}
test('review: pointercancel restores exact pregesture style and sends no draft change',()=>{
 const ui=isolatedBridge();try{const n=ui.d.querySelector('[data-ve-id="el-1"]');n.style.marginTop='7px';ui.posts.length=0;pointer(ui,n,'pointerdown',{clientX:10,clientY:10});pointer(ui,n,'pointermove',{clientX:40,clientY:50});assert.equal(n.style.marginTop,'47px');pointer(ui,n,'pointercancel');assert.equal(n.style.marginTop,'7px');assert.equal(ui.posts.some(x=>x.type==='ve:change'),false);assert.equal(ui.posts.at(-1).active,false);}finally{ui.dom.window.close();}
});
test('review: inline editing save shortcut must prevent browser default and reach parent',()=>{
 const ui=isolatedBridge();try{ui.d.querySelector('[data-command="edit"]').click();const n=ui.d.querySelector('[data-ve-id="el-1"]');assert.equal(n.getAttribute('contenteditable'),'plaintext-only');ui.posts.length=0;const e=new ui.w.KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true});n.dispatchEvent(e);assert.equal(e.defaultPrevented,true);assert.equal(ui.posts.some(x=>x.type==='ve:shortcut'&&x.command==='save'),true);}finally{ui.dom.window.close();}
});
test('review: inline pasted markup stays literal and cancel restores original text',()=>{
 const ui=isolatedBridge();try{ui.d.querySelector('[data-command="edit"]').click();const n=ui.d.querySelector('[data-ve-id="el-1"]'),e=new ui.w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(e,'clipboardData',{value:{getData:()=>'<img src=x onerror=alert(1)>\nmarkup'}});n.dispatchEvent(e);assert.equal(n.textContent,'<img src=x onerror=alert(1)> markup');assert.equal(n.querySelector('img'),null);n.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(n.textContent,'Synthetic heading');assert.equal(n.hasAttribute('contenteditable'),false);}finally{ui.dom.window.close();}
});
test('review: resize handle keyboard arrows change font size rather than position',()=>{
 const ui=isolatedBridge();try{const handle=ui.d.querySelector('[data-handle="resize"]'),n=ui.d.querySelector('[data-ve-id="el-1"]');n.style.fontSize='40px';handle.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(n.style.fontSize,'41px');assert.equal(n.style.marginTop,'');}finally{ui.dom.window.close();}
});
