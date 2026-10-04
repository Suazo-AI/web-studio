import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM,VirtualConsole} from 'jsdom';
import {createDocument} from '../src/v2-model.mjs';
import {initialState,makeManifest} from '../src/model.mjs';
import {makeV2Service} from '../src/v2-service.mjs';
import {v2CanvasBridge} from '../src/v2-canvas-bridge.mjs';

const snapshot={html:'<!doctype html><html><head></head><body><main><p>A</p><p>B</p><p>C</p></main></body></html>',css:''};
const uiHTML=await readFile('ui/v2.html','utf8');
const uiJS=await readFile('ui/v2.js','utf8');
const runtime=(await build({stdin:{contents:"export {applyOperations} from './src/v2-model.mjs'; export {v2Preview} from './src/v2-preview.mjs';",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'V2',write:false})).outputFiles[0].text;
async function openUI(overrides={}){
 const dom=new JSDOM(uiHTML,{url:'https://synthetic-editor.test/v2',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()}),w=dom.window;
 w.structuredClone=x=>w.JSON.parse(w.JSON.stringify(x));w.crypto.randomUUID=()=>crypto.randomUUID();w.ResizeObserver=class{observe(){}};
 const state={project:{id:'synthetic-review',name:'Synthetic Review'},sourceFingerprint:'synthetic-fingerprint',head:'v2-r0',document:createDocument(snapshot),canUndo:false,canRedo:false,history:[{id:'v2-r0'}],snapshot,assets:{},fonts:['Arial'],...overrides};
 w.fetch=async()=>({ok:true,json:async()=>w.JSON.parse(JSON.stringify(state))});w.eval(runtime);
 await w.eval('(async()=>{'+uiJS.replace(/^import[^\n]+\n/,'const {applyOperations,v2Preview}=V2;\n')+';window.review={get pending(){return pending;},get data(){return data;},get nonce(){return nonce;},get doc(){return documentState;},get selected(){return selected;},get clipboard(){return clipboard;},flush,select,command};})()');
 const d=w.document;
 const message=(data,nonce=w.review.nonce)=>w.dispatchEvent(new w.MessageEvent('message',{source:d.querySelector('#canvas').contentWindow,data:w.JSON.parse(JSON.stringify({project_id:state.project.id,nonce,...data}))}));
 return {dom,w,d,message,select:text=>w.review.select(w.review.doc.nodes.find(n=>n.text===text).id)};
}
function bridge(options={}){
 const dom=new JSDOM('<!doctype html><body><main data-v2-id="v2-main"><p data-v2-id="v2-b">B</p><p data-v2-id="v2-a">A</p><p data-v2-id="v2-c">C</p></main></body>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,posts=[];
 w.postMessage=x=>posts.push(x);w.scrollTo=()=>{};
 const scope={nonce:'synthetic-review',project_id:'synthetic-review',viewport:'desktop',nodes:[{id:'v2-main',parentId:null,children:['v2-b','v2-a','v2-c'],editable:{text:false},layout:{mode:'flow'}},...['a','b','c'].map(id=>({id:'v2-'+id,parentId:'v2-main',children:[],editable:{text:true},layout:Object.hasOwn(options,'layout')?options.layout:{mode:'flow'},text:id.toUpperCase()}))]};
 w.eval(`(${v2CanvasBridge.toString()})(${JSON.stringify(scope)})`);
 return {dom,w,d:w.document,posts};
}
function pointer(ui,el,type,y){const e=new ui.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:20,clientY:y});Object.defineProperty(e,'pointerId',{value:1});el.dispatchEvent(e);}

test('V2 review: flow drag uses current child order after an earlier reorder',()=>{
 const ui=bridge();try{for(const [id,y]of [['b',0],['a',100],['c',200]])ui.d.querySelector(`[data-v2-id="v2-${id}"]`).getBoundingClientRect=()=>({y,height:100});
  const el=ui.d.querySelector('[data-v2-id="v2-c"]');for(const [type,y]of [['pointerdown',220],['pointermove',80],['pointerup',80]])pointer(ui,el,type,y);
  assert.equal(ui.posts.find(p=>p.type==='v2:operation')?.operation.index,1);
 }finally{ui.dom.window.close();}
});
test('V2 review: inline Save is prevented, commits text and reaches the parent',()=>{
 const ui=bridge();try{const el=ui.d.querySelector('[data-v2-id="v2-a"]');el.dispatchEvent(new ui.w.MouseEvent('dblclick',{bubbles:true,cancelable:true}));el.textContent='EDITING';ui.posts.length=0;
  const key=new ui.w.KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true});el.dispatchEvent(key);
  assert.equal(key.defaultPrevented,true);assert.ok(ui.posts.some(p=>p.type==='v2:save-text'&&p.operation.text==='EDITING'));
 }finally{ui.dom.window.close();}
});
test('V2 review: empty inline text commits on blur and field Delete stays native',()=>{
 const ui=bridge();try{const el=ui.d.querySelector('[data-v2-id="v2-a"]');el.dispatchEvent(new ui.w.MouseEvent('dblclick',{bubbles:true,cancelable:true}));el.textContent='';ui.posts.length=0;
  const key=new ui.w.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true});el.dispatchEvent(key);assert.equal(key.defaultPrevented,false);assert.equal(ui.posts.some(p=>p.type==='v2:operation'),false);
  el.dispatchEvent(new ui.w.FocusEvent('focusout',{bubbles:true}));assert.equal(ui.posts.find(p=>p.type==='v2:operation').operation.text,'');assert.equal(el.hasAttribute('data-v2-empty'),true);
 }finally{ui.dom.window.close();}
});
test('V2 review: cut pastes after the last sibling without counting its removed slot',async()=>{
 const ui=await openUI();try{ui.select('A');ui.d.querySelector('#cut').click();ui.select('C');ui.d.querySelector('#paste').click();
  assert.equal(ui.w.review.pending.length,1,ui.d.querySelector('#status').textContent);const d=ui.w.review.doc,byId=new Map(d.nodes.map(n=>[n.id,n]));assert.equal(d.nodes[0].children.map(id=>byId.get(id).text).join(','),'B,C,A');
 }finally{ui.dom.window.close();}
});
test('V2 review: duplicate paste ignores earlier deleted sibling tombstones',async()=>{
 const ui=await openUI();try{ui.select('B');ui.d.querySelector('#delete').click();ui.select('A');ui.d.querySelector('#copy').click();ui.select('C');ui.d.querySelector('#paste').click();
  assert.equal(ui.w.review.pending.length,2,ui.d.querySelector('#status').textContent);const d=ui.w.review.doc,byId=new Map(d.nodes.map(n=>[n.id,n]));assert.equal(d.nodes[0].children.map(id=>byId.get(id)).filter(n=>!n.deleted).map(n=>n.text).join(','),'A,C,A');
 }finally{ui.dom.window.close();}
});
test('V2 review: viewport switch waits for the previous frame text commit',async()=>{
 const ui=await openUI();try{ui.select('A');const id=ui.w.review.selected,oldNonce=ui.w.review.nonce;ui.message({type:'v2:editing',active:true});
  ui.d.querySelector('#canvas').contentWindow.postMessage=message=>{if(message.type==='v2:commit-text')setTimeout(()=>{ui.message({type:'v2:editing',active:false},oldNonce);ui.message({type:'v2:flushed',requestId:message.requestId,operation:{type:'text',id,text:''}},oldNonce);},0);};
  ui.d.querySelector('[data-view="mobile"]').click();await new Promise(r=>setTimeout(r,40));
  assert.equal(ui.w.review.doc.nodes.find(n=>n.id===id).text,'');assert.equal(ui.w.review.pending.length,1);
 }finally{ui.dom.window.close();}
});
test('V2 review: Save replay must not silently adopt another tab’s newer head',async()=>{
 let row={version:0,state:initialState()};const store={async read(){return structuredClone(row)},async save(_key,_owner,version,state){assert.equal(version,row.version);row={version:version+1,state:structuredClone(state)}}};
 const service=makeV2Service({snapshot,manifest:makeManifest(snapshot.html),project:{id:'synthetic-review',name:'Synthetic Review'},provenance:{commit:'synthetic',files:{}},assets:{},store});
 const initial=await service.invoke('load',{},'synthetic-owner'),id=initial.document.nodes.find(n=>n.text==='A').id;
 const request={expected_revision:initial.head,operations:[{type:'text',id,text:'FIRST'}],idempotency_key:'synthetic-replay-key'};
 const first=await service.invoke('save',request,'synthetic-owner');await service.invoke('save',{expected_revision:first.head,operations:[{type:'text',id,text:'OTHER TAB'}],idempotency_key:'synthetic-other-key'},'synthetic-owner');
 await assert.rejects(()=>service.invoke('save',request,'synthetic-owner'),e=>e.code==='REVISION_CONFLICT');
});
test('V2 review: edits during saved Undo cannot disappear from the pending view',async()=>{
 const ui=await openUI({head:'v2-r1',canUndo:true,history:[{id:'v2-r0'},{id:'v2-r1'}]});
 try{let resolveUndo,started;const start=new Promise(resolve=>started=resolve);
  ui.w.fetch=async()=>{started();return new Promise(resolve=>resolveUndo=resolve)};
  ui.d.querySelector('#undo').click();await start;ui.select('A');const id=ui.w.review.selected,input=ui.d.querySelector('#text');input.value='LOCAL DURING UNDO';input.dispatchEvent(new ui.w.Event('change',{bubbles:true}));
  const response=JSON.parse(JSON.stringify(ui.w.review.data));response.head='v2-r2';response.canUndo=false;response.canRedo=true;
  resolveUndo({ok:true,json:async()=>ui.w.JSON.parse(JSON.stringify(response))});await new Promise(resolve=>setTimeout(resolve,30));
  if(ui.w.review.pending.length)assert.equal(ui.w.review.doc.nodes.find(n=>n.id===id).text,'LOCAL DURING UNDO','Pending operations must be visible after history responses');
 }finally{ui.dom.window.close();}
});
test('V2 review: inherited absolute and fixed positions cannot silently convert on drag',()=>{
 for(const position of ['absolute','fixed']){const ui=bridge({layout:null});try{const el=ui.d.querySelector('[data-v2-id="v2-a"]');el.style.cssText=`position:${position};left:100px;top:20px`;const before=el.style.cssText;
   for(const [type,y]of [['pointerdown',20],['pointermove',40],['pointerup',40]])pointer(ui,el,type,y);
   assert.equal(ui.posts.some(p=>p.type==='v2:operation'),false,position);assert.ok(ui.posts.some(p=>p.type==='v2:blocked'));assert.equal(el.style.cssText,before);
  }finally{ui.dom.window.close();}}
 const authored=bridge({layout:{mode:'free',x:100,y:20}});try{const el=authored.d.querySelector('[data-v2-id="v2-a"]');el.style.cssText='position:absolute;left:100px;top:20px';
  for(const [type,y]of [['pointerdown',20],['pointermove',40],['pointerup',40]])pointer(authored,el,type,y);
  assert.equal(authored.posts.find(p=>p.type==='v2:operation')?.operation.y,40);assert.equal(authored.posts.some(p=>p.type==='v2:blocked'),false);
 }finally{authored.dom.window.close();}
});
test('V2 review: source-position inspector and keyboard nudge require explicit layout choice',async()=>{
 const ui=await openUI();try{ui.select('A');const id=ui.w.review.selected;
  for(const position of ['absolute','fixed']){ui.message({type:'v2:select',id,computed:{position,left:'100px',top:'20px',fontFamily:'Arial',fontSize:'18px',color:'rgb(1, 2, 3)'}});
   assert.equal(ui.d.querySelector('#layout').value,'source');assert.equal(ui.d.querySelector('#coords').hidden,true);assert.equal(ui.d.querySelector('#font').value,'Arial');assert.equal(ui.d.querySelector('#size').value,'18');assert.equal(ui.d.querySelector('#color').value,'#010203');
   ui.d.body.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(ui.w.review.pending.length,0);assert.match(ui.d.querySelector('#status').textContent,/Elegí Libre/);
  }
  const layout=ui.d.querySelector('#layout');layout.value='free';layout.dispatchEvent(new ui.w.Event('change',{bubbles:true}));assert.equal(ui.w.review.pending.length,1);
  ui.d.body.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(ui.w.review.pending.length,2);assert.equal(ui.w.review.doc.nodes.find(n=>n.id===id).responsiveLayout.desktop.y,21);
 }finally{ui.dom.window.close();}
});
