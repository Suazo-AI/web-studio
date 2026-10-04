import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'parse5';
import { makeManifest } from '../src/model.mjs';
import { createDocument, applyOperations, materializeDocument, validateDocument, migrateV1Document, documentDiff, MAX_NODES } from '../src/v2-model.mjs';

const source = html => ({html:`<!doctype html><html><head><title>Source</title></head><body>\n${html}\n</body></html>`,css:'/* Exact source CSS. */\nmain { display: grid; }\n'});
const fixture = source(`<main id="page">\n  <section id="first"><h1>Hello &amp; world</h1><p>First</p><img src="assets/photo.webp" alt="Picture"></section>\n  <section id="second"><p>Second</p><blockquote class="review"><p>Actual testimony</p><footer><span class="review-author">A person</span></footer></blockquote></section>\n</main>\n<script src="./original.js">originalBehavior()</script>`);
const find = (doc,label) => doc.nodes.find(n=>n.label===label || n.text===label);
const stripIds = html => html.replace(/ data-v2-id="[^"]+"/g,'');
const files = doc => materializeDocument(fixture,doc);
const walk = (root,callback) => {for(const child of root.childNodes||[]){callback(child);walk(child,callback);}};
const elements = html => {const out=[];walk(parse(html),n=>{if(n.tagName)out.push(n);});return out;};
const domIds = html => elements(html).map(n=>n.attrs.find(a=>a.name==='data-v2-id')?.value).filter(Boolean);

test('graph maps every safe source component, images, evidence and immutable offsets',()=>{
  const d=createDocument(fixture), image=d.nodes.find(n=>n.tag==='img');
  assert.equal(d.kind,'LayerDocument');assert.equal(d.version,2);assert.ok(image);assert.equal(image.editable.text,false);
  for(const n of d.nodes){assert.equal(n.id,`v2-${n.source.start.toString(36)}`);assert.equal(fixture.html.slice(n.source.start,n.source.openEnd).startsWith(`<${n.tag}`),true);if(n.parentId)assert.ok(d.nodes.find(p=>p.id===n.parentId).children.includes(n.id));}
  const review=d.nodes.find(n=>n.tag==='blockquote');assert.ok(review.lockedReason);
  assert.equal(find(d,'Actual testimony').editable.text,false);assert.equal(find(d,'A person').editable.text,false);
  assert.ok(!d.nodes.some(n=>n.tag==='script'));assert.equal(validateDocument(fixture,d),d);
});

test('unedited export is byte-for-byte source except stable IDs, preserves scripts and exact CSS',()=>{
  const d=createDocument(fixture), out=files(d);
  assert.equal(stripIds(out['src/index.html']),fixture.html);assert.equal(out['src/styles.css'],fixture.css);
  assert.equal(new Set(domIds(out['src/index.html'])).size,d.nodes.length);
  assert.match(out['src/index.html'],/originalBehavior\(\)/);
});

test('text edits allow empty strings, escape markup, are transactional, and leave source facts intact',()=>{
  const d=createDocument(fixture), n=find(d,'Hello & world'), before=JSON.stringify(d);
  const empty=applyOperations(fixture,d,[{type:'text',id:n.id,text:''}]);assert.equal(find(empty,'Hello & world').text,'');assert.match(files(empty)['src/index.html'],/<h1 data-v2-id="[^"]+"><\/h1>/);
  const escaped=applyOperations(fixture,d,[{type:'text',id:n.id,text:'<script>& "quoted"'}]);assert.match(files(escaped)['src/index.html'],/&lt;script&gt;&amp; "quoted"/);
  assert.equal(JSON.stringify(d),before);assert.equal(find(escaped,'Hello & world').source.start,n.source.start);
  assert.throws(()=>applyOperations(fixture,d,[{type:'text',id:n.id,text:'valid'},{type:'style',id:n.id,styles:{position:'fixed'}}]));assert.equal(JSON.stringify(d),before);
});

test('review content cannot change, but the evidence subtree can move and delete',()=>{
  const d=createDocument(fixture), review=d.nodes.find(n=>n.tag==='blockquote'), first=find(d,'first'), testimony=find(d,'Actual testimony');
  assert.throws(()=>applyOperations(fixture,d,[{type:'text',id:testimony.id,text:'Fake testimony'}]),e=>e.code==='LOCKED_TEXT');
  const moved=applyOperations(fixture,d,[{type:'move',id:review.id,parentId:first.id,index:0}]);assert.equal(moved.nodes.find(n=>n.id===review.id).parentId,first.id);
  const deleted=applyOperations(fixture,moved,[{type:'delete',id:review.id}]);assert.equal(deleted.nodes.length,d.nodes.length);assert.ok(deleted.nodes.find(n=>n.id===testimony.id).deleted);assert.ok(deleted.nodes.find(n=>n.id===review.id).children.length);
  assert.doesNotMatch(files(deleted)['src/index.html'],/Actual testimony|A person|<blockquote/);assert.equal(files(d)['src/index.html'].includes('Actual testimony'),true);
});

test('move supports parent changes and flow ordering, rejects cycles and HTML-invalid placement',()=>{
  const d=createDocument(fixture), first=find(d,'first'), second=find(d,'second'), p=find(d,'First');
  const moved=applyOperations(fixture,d,[{type:'move',id:p.id,parentId:second.id,index:0}]);
  assert.equal(moved.nodes.find(n=>n.id===p.id).parentId,second.id);assert.equal(moved.nodes.find(n=>n.id===second.id).children[0],p.id);
  assert.throws(()=>applyOperations(fixture,d,[{type:'move',id:first.id,parentId:p.id,index:0}]),e=>e.code==='CYCLE');
  assert.throws(()=>applyOperations(fixture,d,[{type:'move',id:second.id,parentId:p.id,index:0}]),e=>e.code==='INVALID_PARENT');
  assert.throws(()=>applyOperations(fixture,d,[{type:'move',id:p.id,parentId:first.id,index:100}]),e=>e.code==='INVALID_INDEX');
  const reordered=applyOperations(fixture,d,[{type:'move',id:second.id,parentId:find(d,'page').id,index:0}]);
  const html=files(reordered)['src/index.html'];assert.ok(html.indexOf('id="second"')<html.indexOf('id="first"'));
  assert.ok(documentDiff(d,reordered).some(change=>change.operation==='reorder'));
});

test('responsive explicit free positioning accepts bounded signed decimals and preserves source CSS',()=>{
  const d=createDocument(fixture), n=find(d,'First');
  const moved=applyOperations(fixture,d,[{type:'layout',id:n.id,mode:'free',x:-24.5,y:4096,viewport:'desktop'},{type:'layout',id:n.id,mode:'flow',viewport:'mobile'},{type:'style',id:n.id,styles:{'font-size':'30px',color:'#abcdef'},viewport:'tablet'}]);
  const css=files(moved)['src/styles.css'];assert.ok(css.startsWith(fixture.css));assert.match(css,/left: -24.5px;/);assert.match(css,/top: 4096px;/);assert.match(css,/position: absolute;/);assert.match(css,/@media \(max-width: 767px\)/);assert.match(css,/position: static;/);
  for(const op of [{mode:'free',x:4097,y:0},{mode:'free',x:0,y:NaN},{mode:'free',x:0},{mode:'flow',x:0},{mode:'absolute'},{mode:'free',x:'1',y:0}])assert.throws(()=>applyOperations(fixture,d,[{type:'layout',id:n.id,...op}]));
});

test('duplicate/copy only source-backed subtrees, sanitizes active content and remaps internal references',()=>{
  const s=source(`<section id="card" class="card" onclick="run()" style="background:url(https://evil.test/a)"><h2 id="title">Card</h2><a href="#title" aria-labelledby="title outside">Read</a><a href="javascript:evil()">Bad</a><img src="https://evil.test/tracker" onerror="run()"><img src="assets/local.webp"><script>evil()</script><form><input value="secret"></form><iframe src="https://evil.test"></iframe><button type="submit" form="outside">Go</button></section>`);
  const d=createDocument(s), n=find(d,'card'), copied=applyOperations(s,d,[{type:'duplicate',id:n.id}]);
  const root=copied.nodes.find(n=>n.copyOf&&n.parentId===null);assert.ok(root.id.startsWith('v2-copy-'));
  const html=materializeDocument(s,copied)['src/index.html'];
  const originalEnd=html.indexOf('</section>')+'</section>'.length, clone=html.slice(originalEnd,html.lastIndexOf('</section>')+'</section>'.length);
  assert.doesNotMatch(clone,/onclick|onerror|style=|javascript:|https:\/\/evil|<script|<form|<input|<iframe|form=|type="submit"/);
  assert.match(clone,/src="assets\/local.webp"/);assert.match(clone,new RegExp(`id="title--${root.id}"`));assert.match(clone,new RegExp(`href="#title--${root.id}"`));assert.doesNotMatch(clone,/aria-labelledby="[^"]*outside/);assert.match(clone,/type="button"/);
  const ids=domIds(html);assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,copied.nodes.filter(n=>!n.deleted).length);
  assert.ok(html.indexOf(`data-v2-id="${root.id}"`)<html.indexOf('</body>'));
  const other=applyOperations(s,copied,[{type:'copy',id:root.id,parentId:null,index:0}]);assert.equal(new Set(other.nodes.map(n=>n.id)).size,other.nodes.length);
});

test('source offset IDs never collide with copy IDs, including a literal c1 source offset',()=>{
  const start='<!doctype html><html><body>',html=start+' '.repeat(433-start.length)+'<p>At c1</p></body></html>',s={html,css:''};
  const d=createDocument(s);assert.equal(d.nodes[0].id,'v2-c1');const out=applyOperations(s,d,[{type:'duplicate',id:d.nodes[0].id}]);assert.equal(out.nodes.at(-1).id,'v2-copy-1');
});

test('malformed operations, arbitrary HTML/CSS and prototype pollution fail closed',()=>{
  const d=createDocument(fixture), id=find(d,'First').id;
  const bad=[null,[],{type:'script',id},{type:'text',id,text:'ok',html:'<img>'},{type:'text',id},{type:'style',id,styles:{background:'url(https://evil.test)'}},{type:'style',id,styles:{color:'#fff'}},{type:'style',id,styles:{'font-size':'221px'}},{type:'style',id,styles:{'margin-top':'-1px'}},{type:'style',id,styles:{'font-family':'untrusted'}},{type:'style',id,styles:{color:'#ffffff'},viewport:'wide'},{type:'move',id,parentId:null,index:-1},{type:'delete',id:'__proto__'},{type:'delete',id:'v2-'+'x'.repeat(100)},{type:'duplicate',id,html:'arbitrary'},{type:'text',id,text:'a\u0000b'},Object.assign(Object.create({evil:true}),{type:'delete',id}),JSON.parse(`{"type":"delete","id":"${id}","__proto__":{"polluted":true}}`),{type:'style',id,styles:JSON.parse('{"__proto__":{"polluted":true}}')}];
  for(const op of bad)assert.throws(()=>applyOperations(fixture,d,[op]),`Must reject ${JSON.stringify(op)}`);
  assert.equal({}.polluted,undefined);assert.throws(()=>applyOperations(fixture,d,[]));assert.throws(()=>applyOperations(fixture,d,Array(101).fill({type:'text',id,text:'x'})));
});

test('tampered persisted documents reject unknown keys, dangling nodes, altered source, cycles and revived deleted descendants',()=>{
  const base=createDocument(fixture), p=find(base,'First'), section=find(base,'first');
  for(const mutate of [d=>{d.evil=true;},d=>{d.nodes[0].source.start++;},d=>{d.nodes[0].tag='script';},d=>{d.nodes[0].styles={background:'url(evil)'};},d=>{d.nodes[0].children.push('v2-xxxx');},d=>{d.nodes[0].parentId=d.nodes[0].id;},d=>{d.nodes.splice(1,1);},d=>{d.nodes.find(n=>n.id===p.id).text='unregistered';},d=>{d.nodes.find(n=>n.id===section.id).deleted=true;}]){const d=structuredClone(base);mutate(d);assert.throws(()=>materializeDocument(fixture,d));}
  const extra=structuredClone(base);extra.nodes.push({...structuredClone(p),id:'v2-copy-1',copyOf:p.id});assert.throws(()=>validateDocument(fixture,extra));
});

test('node limits count tombstones and duplicated descendants',()=>{
  assert.throws(()=>createDocument(source('<p>x</p>'.repeat(MAX_NODES+1))),e=>e.code==='NODE_LIMIT');
  const s=source('<div><span>x</span></div>'.repeat(250)),d=createDocument(s);
  assert.equal(d.nodes.length,MAX_NODES);assert.throws(()=>applyOperations(s,d,[{type:'duplicate',id:d.nodes[0].id}]),e=>e.code==='NODE_LIMIT');
  const deleted=applyOperations(s,d,[{type:'delete',id:d.nodes[0].id}]);assert.throws(()=>applyOperations(s,deleted,[{type:'duplicate',id:d.nodes[2].id}]),e=>e.code==='NODE_LIMIT');
});

test('v1 migration uses exact source offsets, respects locks and does not mutate old edits',()=>{
  const manifest=makeManifest(fixture.html), n=manifest.find(n=>n.text==='First'), edits={[n.id]:{text:'Migrated',styles:{color:'#aabbcc'},responsive:{mobile:{'font-size':'24px'}}}}, original=JSON.stringify({manifest,edits});
  const d=migrateV1Document(fixture,manifest,edits);assert.match(files(d)['src/index.html'],/>Migrated<\/p>/);assert.match(files(d)['src/styles.css'],/font-size: 24px/);assert.equal(JSON.stringify({manifest,edits}),original);
  const shifted=structuredClone(manifest);shifted.find(x=>x.id===n.id).source.start++;
  assert.throws(()=>migrateV1Document(fixture,shifted,edits),e=>e.code==='INVALID_MIGRATION');
  assert.throws(()=>migrateV1Document(fixture,manifest,{unknown:{text:'No'}}),e=>e.code==='INVALID_MIGRATION');
});

test('synthetic public source covers all safe nodes without including private project data',async()=>{
  const s={html:await readFile(new URL('../examples/studio-demo/snapshot/src/index.html',import.meta.url),'utf8'),css:await readFile(new URL('../examples/studio-demo/snapshot/src/styles.css',import.meta.url),'utf8')};
  const d=createDocument(s), n=d.nodes.find(n=>n.text==='MAKE ROOM.');assert.ok(n);const out=materializeDocument(s,d);assert.equal(stripIds(out['src/index.html']),s.html);assert.equal(out['src/styles.css'],s.css);
  const changed=applyOperations(s,d,[{type:'text',id:n.id,text:''},{type:'duplicate',id:n.id},{type:'layout',id:n.id,mode:'free',x:-20,y:15,viewport:'mobile'}]);assert.ok(materializeDocument(s,changed)['src/index.html'].includes('data-v2-id="v2-copy-1"'));
});

test('deletion preserves untouched sibling bytes, comments, whitespace and active source behavior',()=>{
  const s=source('<section>\n<!-- before A --><p>A</p>\n<!-- between --><p>B</p>\n<script>keep()</script>\n<p>C</p>\n</section>'),d=createDocument(s),n=find(d,'A');
  const deleted=applyOperations(s,d,[{type:'delete',id:n.id}]);
  assert.equal(stripIds(materializeDocument(s,deleted)['src/index.html']),s.html.replace('<p>A</p>',''));
});

test('start-tag injection respects quoted attribute text, URL slashes and reserved ID replacement',()=>{
  const s=source('<p title="literal data-v2-id=keep" data-v2-id="old" data-v2-id="duplicate">X</p><img src=assets/a.webp/><br/>'),d=createDocument(s),html=materializeDocument(s,d)['src/index.html'];
  const parsed=elements(html),p=parsed.find(n=>n.tagName==='p'),img=parsed.find(n=>n.tagName==='img');
  assert.equal(p.attrs.find(a=>a.name==='title').value,'literal data-v2-id=keep');assert.equal(p.attrs.filter(a=>a.name==='data-v2-id').length,1);assert.equal(img.attrs.find(a=>a.name==='src').value,'assets/a.webp/');
  assert.equal(domIds(html).length,d.nodes.length);assert.doesNotMatch(html,/data-v2-id="old"|data-v2-id="duplicate"/);
});

test('table/list/details semantics and persisted structural layouts are validated',()=>{
  const s=source('<ul><li>A</li><li>B</li></ul><table><caption>Caption</caption><tr><td>Cell</td></tr></table><details><summary>Summary</summary><p>Body</p></details>'),d=createDocument(s);
  const li=find(d,'A'),td=find(d,'Cell'),summary=find(d,'Summary'),details=d.nodes.find(n=>n.tag==='details');
  assert.throws(()=>applyOperations(s,d,[{type:'move',id:li.id,parentId:null,index:0}]),e=>e.code==='INVALID_PARENT');
  assert.throws(()=>applyOperations(s,d,[{type:'move',id:summary.id,parentId:details.id,index:1}]),e=>e.code==='INVALID_PARENT');
  assert.throws(()=>applyOperations(s,d,[{type:'duplicate',id:summary.id}]),e=>e.code==='INVALID_PARENT');
  const copyTable=applyOperations(s,d,[{type:'duplicate',id:d.nodes.find(n=>n.tag==='table').id}]);assert.match(materializeDocument(s,copyTable)['src/index.html'],/<td data-v2-id="v2-copy-/);
  const forged=structuredClone(d);forged.nodes.find(n=>n.id===td.id).layout={mode:'free',x:0,y:0};assert.throws(()=>materializeDocument(s,forged),e=>e.code==='INVALID_LAYOUT');
});

test('nested free layers and explicit flow containers keep correct responsive containing blocks',()=>{
  const d=createDocument(fixture),parent=find(d,'first'),child=find(d,'First');
  const positioned=applyOperations(fixture,d,[{type:'layout',id:parent.id,mode:'free',x:0.29,y:15},{type:'layout',id:child.id,mode:'free',x:-3,y:5,viewport:'mobile'},{type:'layout',id:parent.id,mode:'flow',viewport:'tablet'}]);
  const css=files(positioned)['src/styles.css'];
  const mobile=css.slice(css.indexOf('@media (max-width: 767px)'));
  assert.doesNotMatch(mobile,new RegExp(`\\[data-v2-id="${parent.id}"\\] \\{ position: relative`));assert.match(css,/left: 0.29px/);
  const flow=applyOperations(fixture,d,[{type:'layout',id:parent.id,mode:'flow'},{type:'layout',id:child.id,mode:'free',x:1,y:2}]);
  assert.match(files(flow)['src/styles.css'],new RegExp(`\\[data-v2-id="${parent.id}"\\] \\{\\n  position: relative;`));
});

test('nested prototype/accessor spoofing cannot impersonate immutable source metadata',()=>{
  const d=createDocument(fixture),forged=structuredClone(d),expected=forged.nodes[0].source;
  forged.nodes[0].source={...expected,start:0,toJSON(){return expected;}};assert.throws(()=>materializeDocument(fixture,forged));
  const n=find(d,'First'),ops=[];Object.defineProperty(ops,'0',{enumerable:true,get(){return{type:'delete',id:n.id};}});assert.throws(()=>applyOperations(fixture,d,ops));
});

test('duplication amplification is bounded before materializing source blobs',()=>{
  const s=source(`<section><script>${'x'.repeat(900000)}</script><p>Small visible layer</p></section>`),d=createDocument(s),id=d.nodes[0].id;
  assert.throws(()=>applyOperations(s,d,Array.from({length:4},()=>({type:'duplicate',id}))),e=>e.code==='OUTPUT_LIMIT');
  assert.equal(d.nodes.length,2);
});

test('parser-repaired overlapping root ranges fail closed rather than corrupting source export',()=>{
  assert.throws(()=>createDocument(source('<table><div>Fostered source</div><tr><td>Cell</td></tr></table>')),e=>e.code==='UNSUPPORTED_SOURCE');
});
