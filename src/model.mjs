import { parse, serialize } from 'parse5';
export const PROPERTIES = ['font-family','font-size','font-weight','line-height','letter-spacing','color','background-color','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','gap','border-radius'];
export class EditorError extends Error { constructor(code, message, status=400){ super(message); this.code=code; this.status=status; } }
export function fail(code,message,status=400){ throw new EditorError(code,message,status); }
export const clone = value=>JSON.parse(JSON.stringify(value));
const allowedTags = new Set(['main','section','div','h1','h2','h3','p','span','figure','figcaption','blockquote','address','dl','dt','dd','a','strong','time']);
const blockedTags = new Set(['script','style','dialog','form','nav','template','noscript','svg','iframe','object']);
const escapeText = value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function walk(root,visit,path='',blocked=false) {
  for(const child of root.childNodes||[]) {
    if(!child.tagName) continue;
    const peers=(root.childNodes||[]).filter(x=>x.tagName===child.tagName);
    const selector=path ? `${path} > ${child.tagName}:nth-of-type(${peers.indexOf(child)+1})` : child.tagName;
    const deny=blocked||blockedTags.has(child.tagName)||child.attrs?.some(x=>x.name==='hidden');
    visit(child,selector,deny); walk(child,visit,selector,deny);
  }
}
export function makeManifest(html) {
  const nodes=[]; const root=parse(html,{sourceCodeLocationInfo:true});
  walk(root,(n,selector,blocked)=>{
    if(blocked||!allowedTags.has(n.tagName)||!n.sourceCodeLocation?.startTag||!selector.startsWith('html > body')) return;
    const attrs=Object.fromEntries(n.attrs.map(a=>[a.name,a.value]));
    if(attrs['aria-hidden']==='true'||(attrs.class||'').includes('sr-only')||(attrs.class||'').includes('skip-link'))return;
    const textNodes=(n.childNodes||[]).filter(x=>x.nodeName==='#text');
    const leaf=!(n.childNodes||[]).some(x=>x.tagName);
    const raw=textNodes.map(x=>x.value).join('');
    const text=raw.trim();
    const id=`el-${nodes.length+1}`;
    const p=nodes.filter(x=>selector.startsWith(x.selector+' > ')).at(-1);
    const isQuote=!!(selector.includes('blockquote')||(attrs.class||'').match(/review-author|review-date|rating-summary|source-note/)||p?.lockedReason);
    const editableText=leaf&&!!text&&n.tagName!=='time'&&!isQuote;
    nodes.push({id,tag:n.tagName,selector,label:attrs.id||attrs.class?.split(' ')[0]||text.slice(0,38)||n.tagName,parentId:p?.id||null,depth:selector.split(' > ').length-3,text:editableText?text:null,source:{file:'src/index.html',line:n.sourceCodeLocation.startLine,start:n.sourceCodeLocation.startTag.endOffset,end:n.sourceCodeLocation.endTag?.startOffset},editable:{text:editableText,styles:PROPERTIES},lockedReason:isQuote?'Las reseñas y sus atribuciones son evidencia; su texto no se edita aquí.':null});
  });
  return nodes;
}
export function validateChange(change,manifest) {
  if(!change||typeof change!=='object'||Array.isArray(change))fail('INVALID_CHANGE','Cambio inválido');
  const keys=Object.keys(change); if(keys.some(k=>!['element_id','text','styles'].includes(k)))fail('INVALID_CHANGE','Campo de cambio no permitido');
  const node=manifest.find(x=>x.id===change.element_id); if(!node)fail('UNKNOWN_ELEMENT','Elemento desconocido');
  const out={element_id:node.id};
  if('text' in change){ if(!node.editable.text||typeof change.text!=='string'||change.text.length<1||change.text.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(change.text))fail('INVALID_TEXT','Texto no editable o fuera del límite');out.text=change.text; }
  if('styles' in change){
    if(!change.styles||typeof change.styles!=='object'||Array.isArray(change.styles))fail('INVALID_STYLE','Estilos inválidos');
    out.styles={};
    for(const [key,value] of Object.entries(change.styles)) {
      if(!PROPERTIES.includes(key)||typeof value!=='string')fail('INVALID_STYLE','Propiedad no permitida');
      let valid=false;
      if(key==='font-family')valid=['Anton','Barlow','Barlow Condensed','Arial','Georgia'].includes(value);
      else if(key==='font-weight')valid=/^(400|500|600|700|800|900)$/.test(value);
      else if(key.includes('color'))valid=/^#[0-9a-fA-F]{6}$/.test(value);
      else if(key==='line-height')valid=/^(?:1(?:\.\d{1,2})?|2(?:\.0{1,2})?)$/.test(value);
      else {const m=value.match(/^(\d+(?:\.\d{1,2})?)px$/); if(m){const n=Number(m[1]);valid=n>=0&&n<=(key==='font-size'?220:key==='letter-spacing'?20:160);}}
      if(!valid)fail('INVALID_STYLE',`Valor inválido para ${key}`);
      out.styles[key]=value;
    }
  }
  if(!('text' in out)&&!Object.keys(out.styles||{}).length)fail('EMPTY_CHANGE','El cambio está vacío');
  return out;
}
export function mergeChanges(edits,changes,manifest){
  if(!Array.isArray(changes)||!changes.length||changes.length>30)fail('INVALID_CHANGES','Se admiten de 1 a 30 cambios');
  const next=clone(edits);
  for(const c of changes.map(x=>validateChange(x,manifest))){next[c.element_id]??={};if('text'in c)next[c.element_id].text=c.text;if(c.styles)next[c.element_id].styles={...(next[c.element_id].styles||{}),...c.styles};}
  return next;
}
export function materialize(snapshot,manifest,edits) {
  let html=snapshot.html;
  const replacements=[]; let overrides='';
  for(const [id,edit] of Object.entries(edits)) {
    const n=manifest.find(x=>x.id===id); if(!n)fail('UNKNOWN_ELEMENT','Revisión con elemento desconocido');
    if('text'in edit)replacements.push({start:n.source.start,end:n.source.end,text:escapeText(edit.text)});
    if(Object.keys(edit.styles||{}).length)overrides+=`${n.selector} {\n${Object.entries(edit.styles).map(([k,v])=>`  ${k}: ${k==='font-family'?`"${v}"`:v};`).join('\n')}\n}\n`;
  }
  for(const r of replacements.sort((a,b)=>b.start-a.start))html=html.slice(0,r.start)+r.text+html.slice(r.end);
  return {'src/index.html':html,'src/styles.css':snapshot.css+(overrides?'\n/* Visual editor draft overrides. Review before integration. */\n'+overrides:'')};
}
export function diffSummary(manifest,before,after){
  const diff=[];for(const node of manifest){const a=before[node.id]||{},b=after[node.id]||{};if(('text'in a||'text'in b)&&(a.text??node.text)!==(b.text??node.text))diff.push({element_id:node.id,label:node.label,file:'src/index.html',line:node.source.line,property:'text',before:a.text??node.text,after:b.text??node.text});for(const k of PROPERTIES)if(a.styles?.[k]!==b.styles?.[k])diff.push({element_id:node.id,label:node.label,file:'src/styles.css',property:k,before:a.styles?.[k]??'(fuente original)',after:b.styles?.[k]??'(fuente original)'});}return diff;
}
export function initialState(){return {head:'r0',revisions:[{id:'r0',parent:null,createdAt:new Date().toISOString(),label:'Fuente congelada',edits:{}}],patches:[],feedback:[],feedbackCursor:0,tasteProposals:[],undoStack:[],redoStack:[]};}
export function revision(state,id){const r=state.revisions.find(x=>x.id===id);if(!r)fail('UNKNOWN_REVISION','Revisión desconocida',404);return r;}
export function checkRevision(state,id){if(state.head!==id)fail('REVISION_CONFLICT',`La revisión actual es ${state.head}. Recargá antes de guardar.`,409);}
export function commitRevision(state,edits,label){if(state.revisions.length>=100)fail('REVISION_LIMIT','Límite de 100 revisiones: exportá y revisá este proyecto antes de continuar',409);const next={id:`r${state.revisions.length}`,parent:state.head,createdAt:new Date().toISOString(),label,edits:clone(edits)};state.revisions.push(next);state.head=next.id;return next;}
