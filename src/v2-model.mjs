import { parse, parseFragment, serialize } from 'parse5';
import { EditorError, FONT_FAMILIES, PROPERTIES, VIEWPORTS, VIEWPORT_MEDIA, availableFonts } from './model.mjs';

/** A source-bound JSON layer graph. Source bytes remain authoritative; this is not an HTML editor. */
export const DOCUMENT_VERSION = 2;
export const MAX_NODES = 500;
export const MAX_OPERATIONS = 100;
export const MAX_POSITION = 4096;
export const MAX_MATERIALIZED_HTML = 4_000_000;
export { EditorError, PROPERTIES, VIEWPORTS, VIEWPORT_MEDIA };
const fail = (code, message) => { throw new EditorError(code, message); };
const copy = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const escapeText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttr = value => escapeText(value).replaceAll('"', '&quot;');
const SAFE_TAGS = new Set(('main section article aside header footer nav div h1 h2 h3 h4 h5 h6 p span figure figcaption blockquote address dl dt dd a strong b em i u s small time ul ol li pre code abbr bdi bdo cite data del dfn ins kbd mark q rp rt ruby samp sub sup var wbr br hr img picture source table caption colgroup col tbody thead tfoot tr td th details summary button label meter progress').split(' '));
const VOID_TAGS = new Set(['br', 'wbr', 'hr', 'img', 'source', 'col']);
const PHRASING = new Set(('a abbr b bdi bdo br button cite code data del dfn em i img ins kbd label mark meter progress q ruby rp rt s samp small span strong sub sup time u var wbr').split(' '));
const PHRASING_PARENTS = new Set(('p h1 h2 h3 h4 h5 h6 span a strong b em i u s small time pre code abbr bdi bdo cite data del dfn ins kbd mark q rp rt ruby samp sub sup var button label summary').split(' '));
const STRUCTURAL = new Set(['li','dt','dd','caption','colgroup','col','thead','tbody','tfoot','tr','td','th','source','summary','figcaption','rt','rp']);
const REVIEW = /(?:^|[\s_-])(?:reviews?|testimonials?|review-author|review-date|rating-summary|source-note)(?:$|[\s_-])/i;
const NODE_KEYS = ['id','sourceId','parentId','children','tag','label','source','editable','lockedReason','text','textChanged','styles','responsive','layout','responsiveLayout','deleted','copyOf'];
const DOC_KEYS = ['kind','version','roots','nodes','nextId'];
const ID = /^v2-(?:[0-9a-z]{1,10}|copy-[1-9][0-9]{0,6})$/;

function plain(value, code = 'INVALID_DOCUMENT') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code, 'Se esperaba un objeto simple');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__','prototype','constructor'].includes(key) || !Object.getOwnPropertyDescriptor(value,key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value,key))) fail(code, 'Objeto no permitido');
  }
  return value;
}
function exact(value, allowed, required = [], code = 'INVALID_DOCUMENT') {
  plain(value, code);
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !own(value,key))) fail(code, 'Campos inválidos o faltantes');
}
function array(value, max, code = 'INVALID_DOCUMENT') {
  if (!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype || value.length > max || Reflect.ownKeys(value).length!==value.length+1 || Object.keys(value).length !== value.length || Object.keys(value).some((key,i) => key !== String(i) || !('value' in Object.getOwnPropertyDescriptor(value,key)))) fail(code, 'Lista inválida o demasiado grande');
}
function validId(id) { if (typeof id !== 'string' || !ID.test(id)) fail('INVALID_ID','Identificador inválido'); }
function snapshotCheck(snapshot) {
  if (!snapshot || typeof snapshot.html !== 'string' || typeof snapshot.css !== 'string' || snapshot.html.length > 2_000_000 || snapshot.css.length > 2_000_000) fail('INVALID_SOURCE','Fuente inválida o demasiado grande');
}
function sourceTree(snapshot) {
  snapshotCheck(snapshot);
  const tree = parse(snapshot.html, { sourceCodeLocationInfo: true });
  const nodes = [], ast = new Map();
  const body = tree.childNodes.find(n=>n.tagName==='html')?.childNodes.find(n=>n.tagName==='body');
  function visit(parent, parentId = null, locked = false) {
    for (const child of parent?.childNodes || []) {
      if (!child.tagName) continue;
      if (child.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !SAFE_TAGS.has(child.tagName)) continue;
      const loc = child.sourceCodeLocation;
      // Parser-created wrappers have no source range; retain their children in the nearest mapped parent.
      if (!loc?.startTag) { visit(child, parentId, locked); continue; }
      if (nodes.length >= MAX_NODES) fail('NODE_LIMIT',`Máximo ${MAX_NODES} capas`);
      const attrs = Object.fromEntries(child.attrs.map(a=>[a.name,a.value]));
      const evidence = locked || child.tagName === 'blockquote' || REVIEW.test(`${attrs.class||''} ${attrs.id||''}`) || attrs['itemprop']==='reviewBody' || attrs['itemtype']?.includes('schema.org/Review');
      const leaf = !(child.childNodes || []).some(n=>n.tagName);
      const text = leaf ? (child.childNodes || []).filter(n=>n.nodeName==='#text').map(n=>n.value).join('').trim() : null;
      const id = `v2-${loc.startTag.startOffset.toString(36)}`;
      const node = {
        id, sourceId:id, parentId, children:[], tag:child.tagName,
        label:(attrs.id || attrs.class?.split(/\s+/)[0] || attrs.alt || text?.slice(0,60) || child.tagName).slice(0,120),
        source:{ file:'src/index.html', start:loc.startTag.startOffset, end:loc.endOffset, openEnd:loc.startTag.endOffset, closeStart:loc.endTag?.startOffset ?? loc.endOffset, line:loc.startLine },
        editable:{text:leaf && !VOID_TAGS.has(child.tagName) && child.tagName!=='time' && !evidence, styles:[...PROPERTIES]},
        lockedReason:evidence ? 'El texto de las reseñas y sus atribuciones es evidencia; la capa puede moverse o eliminarse.' : null,
        text, textChanged:false, styles:{}, responsive:{}, layout:null, responsiveLayout:{}, deleted:false, copyOf:null,
      };
      nodes.push(node); ast.set(id,child);
      if (parentId) nodes.find(n=>n.id===parentId).children.push(id);
      visit(child,id,!!evidence);
    }
  }
  visit(body);
  // Implied close tags can be zero-width, but overlapping source ranges cannot be safely moved.
  const byId = new Map(nodes.map(n=>[n.id,n]));
  for (const n of nodes) {
    if (n.source.end < n.source.openEnd || n.source.closeStart < n.source.openEnd) fail('UNSUPPORTED_SOURCE','Rangos de fuente ambiguos');
    let end = n.source.openEnd;
    for (const id of n.children) { const c = byId.get(id); if (c.source.start < end || c.source.end > n.source.closeStart) fail('UNSUPPORTED_SOURCE','Rangos de fuente superpuestos'); end = c.source.end; }
  }
  const roots=nodes.filter(n=>!n.parentId).map(n=>n.id);
  let rootEnd=0;for(const id of roots){const n=byId.get(id);if(n.source.start<rootEnd)fail('UNSUPPORTED_SOURCE','La reparación del HTML produce rangos raíz superpuestos');rootEnd=n.source.end;}
  const bodyStart=body?.sourceCodeLocation?.startTag?.endOffset ?? (roots.length?byId.get(roots[0]).source.start:snapshot.html.length);
  const bodyEnd=body?.sourceCodeLocation?.endTag?.startOffset ?? body?.sourceCodeLocation?.endOffset ?? (roots.length?byId.get(roots.at(-1)).source.end:bodyStart);
  return { nodes, roots, ast, bodyStart, bodyEnd };
}
export function createDocument(snapshot) {
  const {nodes,roots} = sourceTree(snapshot);
  return {kind:'LayerDocument',version:DOCUMENT_VERSION,roots,nodes,nextId:1};
}
function stylesCheck(styles, fonts) {
  plain(styles, 'INVALID_STYLE');
  for (const [key,value] of Object.entries(styles)) {
    if (!PROPERTIES.includes(key) || typeof value !== 'string') fail('INVALID_STYLE','Propiedad no permitida');
    let valid = false;
    if (key === 'font-family') valid = fonts.includes(value) && FONT_FAMILIES.includes(value);
    else if (key === 'font-weight') valid = /^(400|500|600|700|800|900)$/.test(value);
    else if (key.includes('color')) valid = /^#[0-9a-fA-F]{6}$/.test(value);
    else if (key === 'line-height') valid = /^(?:1(?:\.\d{1,2})?|2(?:\.0{1,2})?)$/.test(value);
    else { const m = value.match(/^(\d{1,3}(?:\.\d{1,2})?)px$/); if(m) { const n=Number(m[1]); valid = n>=0 && n<=(key==='font-size'?220:key==='letter-spacing'?20:160); } }
    if (!valid) fail('INVALID_STYLE',`Valor inválido para ${key}`);
  }
}
function textCheck(text) {
  if (typeof text !== 'string' || text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail('INVALID_TEXT','Texto inválido o demasiado largo');
}
function layoutCheck(layout) {
  exact(layout,['mode','x','y'],['mode'],'INVALID_LAYOUT');
  if (!['flow','free'].includes(layout.mode)) fail('INVALID_LAYOUT','Modo de posición inválido');
  for (const key of ['x','y']) if (own(layout,key) && (typeof layout[key]!=='number' || !Number.isFinite(layout[key]) || Math.abs(layout[key])>MAX_POSITION || Math.abs(Math.round(layout[key]*100)-layout[key]*100)>1e-7)) fail('INVALID_LAYOUT','Posición fuera del límite');
  if (layout.mode==='flow' && (own(layout,'x')||own(layout,'y'))) fail('INVALID_LAYOUT','La posición de flujo no admite coordenadas');
  if (layout.mode==='free' && (!own(layout,'x')||!own(layout,'y'))) fail('INVALID_LAYOUT','La posición libre requiere x e y');
}
function responsiveCheck(value, check) {
  plain(value);
  for (const [viewport, settings] of Object.entries(value)) { if (!VIEWPORTS.includes(viewport)) fail('INVALID_VIEWPORT','Vista inválida'); check(settings); }
}
function immutableEqual(a,b) {
  if(a===b)return true;
  if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return false;
  if(Array.isArray(b)){array(a,MAX_NODES);return a.length===b.length&&a.every((v,i)=>immutableEqual(v,b[i]));}
  plain(a);const keys=Object.keys(b);return Object.keys(a).length===keys.length&&keys.every(k=>own(a,k)&&immutableEqual(a[k],b[k]));
}
function descendants(node, byId, output = []) { for(const id of node.children) { const child=byId.get(id); output.push(child); descendants(child,byId,output); } return output; }
function activeChildren(node, byId) { return node.children.filter(id=>!byId.get(id).deleted); }
function assertChild(parent, node, byId) {
  const tag=parent?.tag, child=node.tag;
  if (parent && (VOID_TAGS.has(tag) || parent.deleted)) fail('INVALID_PARENT','La capa no admite hijos');
  if (tag==='ul'||tag==='ol') { if(child!=='li') fail('INVALID_PARENT','Las listas solo admiten elementos de lista'); }
  else if(tag==='dl') { if(!['dt','dd','div'].includes(child)) fail('INVALID_PARENT','Contenido inválido para una lista de definiciones'); }
  else if(tag==='table') { if(!['caption','colgroup','thead','tbody','tfoot','tr'].includes(child)) fail('INVALID_PARENT','Contenido inválido para una tabla'); }
  else if(['thead','tbody','tfoot'].includes(tag)) { if(child!=='tr') fail('INVALID_PARENT','La sección de tabla solo admite filas'); }
  else if(tag==='tr') { if(!['td','th'].includes(child)) fail('INVALID_PARENT','Las filas solo admiten celdas'); }
  else if(tag==='colgroup') { if(child!=='col') fail('INVALID_PARENT','El grupo solo admite columnas'); }
  else if(tag==='picture') { if(!['source','img'].includes(child)) fail('INVALID_PARENT','La imagen adaptable solo admite imágenes y fuentes'); }
  else if(PHRASING_PARENTS.has(tag)) { if(!PHRASING.has(child) && !(tag==='ruby'&&['rp','rt'].includes(child))) fail('INVALID_PARENT','Este elemento solo admite contenido en línea'); }
  else if(STRUCTURAL.has(child) && !((child==='figcaption'&&tag==='figure')||(child==='summary'&&tag==='details')||(['dt','dd'].includes(child)&&tag==='div'&&parent.parentId&&byId.get(parent.parentId)?.tag==='dl'))) fail('INVALID_PARENT','Elemento estructural fuera de su contenedor');
  if(child==='main' && parent && tag!=='div') fail('INVALID_PARENT','El contenido principal requiere un contenedor neutro');
  const subtree=[node,...descendants(node,byId)];
  for(let ancestor=parent; ancestor; ancestor=ancestor.parentId ? byId.get(ancestor.parentId):null) {
    if(ancestor.tag==='a' && subtree.some(n=>['a','button','label'].includes(n.tag))) fail('INVALID_PARENT','No se pueden anidar controles o enlaces');
    if(ancestor.tag==='button' && subtree.some(n=>['a','button','label','details'].includes(n.tag))) fail('INVALID_PARENT','No se pueden anidar controles');
  }
}
function assertChildOrder(parent,byId) {
  const children=activeChildren(parent,byId).map(id=>byId.get(id)),tags=children.map(n=>n.tag);
  const unique=tag=>{if(tags.filter(t=>t===tag).length>1)fail('INVALID_PARENT','Solo se permite un elemento estructural de este tipo');};
  if(parent.tag==='table') {
    for(const tag of ['caption','thead','tfoot'])unique(tag);
    const rank={caption:0,colgroup:1,thead:2,tbody:3,tr:3,tfoot:4};
    if(tags.some((tag,i)=>!own(rank,tag)||(i>0&&rank[tag]<rank[tags[i-1]]))||(tags.includes('tbody')&&tags.includes('tr')))fail('INVALID_PARENT','Orden de tabla inválido');
  }
  if(parent.tag==='picture') {unique('img');if(tags.some((tag,i)=>!['source','img'].includes(tag)||(tag==='img'&&i!==tags.length-1)))fail('INVALID_PARENT','Orden de fuentes de imagen inválido');}
  if(parent.tag==='details'){unique('summary');if(tags.includes('summary')&&tags[0]!=='summary')fail('INVALID_PARENT','El resumen debe ser el primer elemento');}
  if(parent.tag==='figure'){unique('figcaption');const at=tags.indexOf('figcaption');if(at>0&&at!==tags.length-1)fail('INVALID_PARENT','El pie debe estar al principio o al final');}
}
function nodeLayoutCheck(node,layout) {
  layoutCheck(layout);
  if(['source','col','colgroup','thead','tbody','tfoot','tr','td','th'].includes(node.tag)&&layout.mode==='free')fail('INVALID_LAYOUT','Este elemento estructural no admite posición libre');
}
function validateAgainst(snapshot, document, fonts) {
  exact(document,DOC_KEYS,DOC_KEYS);
  if(document.kind!=='LayerDocument'||document.version!==DOCUMENT_VERSION) fail('INVALID_DOCUMENT','Versión de documento no compatible');
  array(document.nodes,MAX_NODES); array(document.roots,MAX_NODES);
  if(!Number.isSafeInteger(document.nextId)||document.nextId<1||document.nextId>1_000_000) fail('INVALID_DOCUMENT','Contador de capas inválido');
  const baseline=createDocument(snapshot), sources=new Map(baseline.nodes.map(n=>[n.id,n])), byId=new Map();
  for(const n of document.nodes) {
    exact(n,NODE_KEYS,NODE_KEYS); validId(n.id); validId(n.sourceId);
    if(byId.has(n.id)) fail('INVALID_DOCUMENT','Capas duplicadas'); byId.set(n.id,n);
    const source=sources.get(n.sourceId); if(!source) fail('INVALID_DOCUMENT','Capa sin correspondencia con la fuente');
    for(const key of ['tag','label','source','editable','lockedReason']) if(!immutableEqual(n[key],source[key])) fail('INVALID_DOCUMENT','Metadatos de fuente alterados');
    if(n.id===n.sourceId) { if(n.copyOf!==null) fail('INVALID_DOCUMENT','Origen de copia inválido'); }
    else { if(!/^v2-copy-[1-9][0-9]{0,6}$/.test(n.id)||Number(n.id.slice(8))>=document.nextId||n.copyOf!==n.sourceId) fail('INVALID_DOCUMENT','Identidad de copia inválida'); }
    if(n.parentId!==null) validId(n.parentId);
    array(n.children,MAX_NODES); n.children.forEach(validId);
    if(typeof n.deleted!=='boolean'||typeof n.textChanged!=='boolean') fail('INVALID_DOCUMENT','Estado inválido');
    if(n.textChanged) { if(!source.editable.text) fail('LOCKED_TEXT','Texto de fuente protegido'); textCheck(n.text); }
    else if(n.text!==source.text) fail('INVALID_DOCUMENT','Texto sin operación registrada');
    stylesCheck(n.styles,fonts); responsiveCheck(n.responsive,s=>stylesCheck(s,fonts));
    if(n.layout!==null) nodeLayoutCheck(n,n.layout); responsiveCheck(n.responsiveLayout,l=>nodeLayoutCheck(n,l));
  }
  if(baseline.nodes.some(n=>!byId.has(n.id))) fail('INVALID_DOCUMENT','Las capas eliminadas deben conservar una marca de eliminación');
  const refs=new Map();
  function record(id,parentId) { validId(id); if(!byId.has(id)||refs.has(id)||byId.get(id).parentId!==parentId) fail('INVALID_DOCUMENT','Relación de capas inválida'); refs.set(id,parentId); }
  document.roots.forEach(id=>record(id,null));
  for(const n of document.nodes) for(const id of n.children) record(id,n.id);
  if(refs.size!==document.nodes.length) fail('INVALID_DOCUMENT','Capa desconectada');
  const seen=new Set(), path=new Set();
  function visit(id,ancestorDeleted=false) { if(path.has(id)) fail('INVALID_DOCUMENT','Ciclo de capas'); const n=byId.get(id); path.add(id); seen.add(id); if(ancestorDeleted&&!n.deleted)fail('INVALID_DOCUMENT','Descendiente de capa eliminada'); for(const child of n.children)visit(child,ancestorDeleted||n.deleted); path.delete(id); }
  document.roots.forEach(id=>visit(id));
  if(seen.size!==document.nodes.length)fail('INVALID_DOCUMENT','Ciclo o capa desconectada');
  let estimatedBytes=snapshot.html.length-baseline.roots.reduce((sum,id)=>sum+sources.get(id).source.end-sources.get(id).source.start,0);
  for(const n of document.nodes)if(!n.deleted){
    const source=sources.get(n.sourceId);
    estimatedBytes+=source.source.end-source.source.start-source.children.reduce((sum,id)=>sum+sources.get(id).source.end-sources.get(id).source.start,0)+64;
    if(n.textChanged)estimatedBytes+=escapeText(n.text).length-(source.source.closeStart-source.source.openEnd);
  }
  if(estimatedBytes>MAX_MATERIALIZED_HTML)fail('OUTPUT_LIMIT','La duplicación supera el límite del documento exportable');
  for(const n of document.nodes) {
    const source=sources.get(n.sourceId);
    // Original source is retained even if its HTML was unusual. New parent relationships must be safe.
    if(!n.deleted && (n.copyOf || n.parentId!==source.parentId)) assertChild(n.parentId?byId.get(n.parentId):null,n,byId);
    if(!n.deleted&&(n.copyOf||!immutableEqual(n.children,source.children)||n.children.some(id=>byId.get(id).deleted)))assertChildOrder(n,byId);
  }
  return {baseline,sources,byId};
}
export function validateDocument(snapshot,document,{fontChoices=availableFonts(snapshot.css)}={}) { validateAgainst(snapshot,document,fontChoices); return document; }

export function applyOperations(snapshot,document,operations,{fontChoices=availableFonts(snapshot.css)}={}) {
  validateAgainst(snapshot,document,fontChoices);
  array(operations,MAX_OPERATIONS,'INVALID_OPERATIONS');
  if(!operations.length)fail('INVALID_OPERATIONS','La lista de operaciones está vacía');
  const next=copy(document), byId=new Map(next.nodes.map(n=>[n.id,n]));
  const get=id=>{ validId(id); const n=byId.get(id); if(!n||n.deleted)fail('UNKNOWN_ELEMENT','Capa desconocida o eliminada');return n; };
  const list=parent=>parent?parent.children:next.roots;
  function place(n,parentId,index) {
    const parent=parentId===null?null:get(parentId);
    if(n.id===parentId||descendants(n,byId).some(d=>d.id===parentId))fail('CYCLE','Una capa no puede contenerse a sí misma');
    assertChild(parent,n,byId);
    if(!Number.isSafeInteger(index)||index<0)fail('INVALID_INDEX','Índice inválido');
    const old=list(n.parentId?byId.get(n.parentId):null), target=list(parent);
    const position=old.indexOf(n.id); if(position>=0)old.splice(position,1);
    const active=target.filter(id=>!byId.get(id).deleted);
    if(index>active.length)fail('INVALID_INDEX','Índice fuera del contenedor');
    const anchor=active[index]; target.splice(anchor ? target.indexOf(anchor):target.length,0,n.id); n.parentId=parentId;
  }
  for(const op of operations) {
    plain(op,'INVALID_OPERATION');
    if(typeof op.type!=='string')fail('INVALID_OPERATION','Operación inválida');
    const keys={text:['type','id','text'],style:['type','id','styles','viewport'],layout:['type','id','mode','x','y','viewport'],move:['type','id','parentId','index'],delete:['type','id'],duplicate:['type','id','parentId','index'],copy:['type','id','parentId','index']}[op.type];
    if(!keys)fail('INVALID_OPERATION','Operación no permitida');
    exact(op,keys,['type','id'],'INVALID_OPERATION');
    const n=get(op.id);
    if(own(op,'viewport')&&!VIEWPORTS.includes(op.viewport))fail('INVALID_VIEWPORT','Vista inválida');
    if(op.type==='text') {
      if(!own(op,'text'))fail('INVALID_OPERATION','Falta el texto'); textCheck(op.text);
      if(!n.editable.text||activeChildren(n,byId).length)fail('LOCKED_TEXT','Texto no editable'); n.text=op.text;n.textChanged=true;
    } else if(op.type==='style') {
      if(!own(op,'styles'))fail('INVALID_OPERATION','Faltan los estilos'); stylesCheck(op.styles,fontChoices); if(!Object.keys(op.styles).length)fail('INVALID_STYLE','Estilos vacíos');
      if(op.viewport)n.responsive[op.viewport]={...(n.responsive[op.viewport]||{}),...op.styles};else n.styles={...n.styles,...op.styles};
    } else if(op.type==='layout') {
      const value=Object.fromEntries(['mode','x','y'].filter(key=>own(op,key)).map(key=>[key,op[key]])); nodeLayoutCheck(n,value);
      if(op.viewport)n.responsiveLayout[op.viewport]=value;else n.layout=value;
    } else if(op.type==='move') {
      if(!own(op,'parentId')||!own(op,'index'))fail('INVALID_OPERATION','Falta contenedor o índice'); place(n,op.parentId,op.index);
    } else if(op.type==='delete') {
      for(const d of [n,...descendants(n,byId)])d.deleted=true;
    } else {
      const active=[n,...descendants(n,byId)].filter(d=>!d.deleted);
      if(next.nodes.length+active.length>MAX_NODES)fail('NODE_LIMIT',`Máximo ${MAX_NODES} capas`);
      const mapping=new Map(active.map(d=>[d.id,`v2-copy-${next.nextId++}`]));
      const parentId=own(op,'parentId')?op.parentId:n.parentId;
      const parent=parentId===null?null:get(parentId);
      const index=own(op,'index')?op.index:(parentId===n.parentId?list(parent).filter(id=>!byId.get(id).deleted).indexOf(n.id)+1:list(parent).filter(id=>!byId.get(id).deleted).length);
      for(const d of active) {
        const duplicate={...copy(d),id:mapping.get(d.id),copyOf:d.sourceId,parentId:d===n?null:mapping.get(d.parentId),children:d.children.filter(id=>mapping.has(id)).map(id=>mapping.get(id)),deleted:false};
        next.nodes.push(duplicate);byId.set(duplicate.id,duplicate);
      }
      const root=byId.get(mapping.get(n.id));place(root,parentId,index);
    }
  }
  validateAgainst(snapshot,next,fontChoices);
  return next;
}

function addLayerAttribute(raw,id) {
  // Scan only the source start tag; quoted attributes and unquoted URL slashes stay untouched.
  let pos=raw.search(/[\s/>]/), insertion=raw.lastIndexOf('>');const removals=[];
  while(pos<raw.length) {
    const start=pos;while(/\s/.test(raw[pos]||'')&&pos<raw.length)pos++;
    if(raw[pos]==='>')break;
    if(raw[pos]==='/'&&raw[pos+1]==='>'){insertion=pos;break;}
    const nameStart=pos;while(pos<raw.length&&!/[\s=/>]/.test(raw[pos]))pos++;
    if(pos===nameStart){pos++;continue;}
    const name=raw.slice(nameStart,pos).toLowerCase();while(/\s/.test(raw[pos]||'')&&pos<raw.length)pos++;
    if(raw[pos]==='=') {
      pos++;while(/\s/.test(raw[pos]||'')&&pos<raw.length)pos++;
      const quote=raw[pos];if(quote==='"'||quote==="'"){pos++;while(pos<raw.length&&raw[pos]!==quote)pos++;if(raw[pos]===quote)pos++;}
      else while(pos<raw.length&&!/[\s>]/.test(raw[pos]))pos++;
    }
    if(name==='data-v2-id')removals.push({start,end:pos});
  }
  let result=raw.slice(0,insertion)+` data-v2-id="${id}"`+raw.slice(insertion);
  for(const range of removals.reverse())result=result.slice(0,range.start)+result.slice(range.end);
  return result;
}
function safeAsset(value) {
  return typeof value==='string' && /^(?:\.\/|\/)?assets\/[A-Za-z0-9_.\/-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(value) && !value.split('/').includes('..');
}
function sanitizeCopy(html,copyId) {
  const fragment=parseFragment(html), ids=new Map();
  function collect(node) { for(const n of node.childNodes||[]) { const id=n.attrs?.find(a=>a.name==='id')?.value; if(id)ids.set(id,`${id}--${copyId}`);collect(n); } }
  collect(fragment);
  function clean(parent) {
    parent.childNodes=(parent.childNodes||[]).filter(n=>!n.tagName||SAFE_TAGS.has(n.tagName));
    for(const n of parent.childNodes) {
      if(n.attrs)n.attrs=n.attrs.filter(a=>!a.name.startsWith('on')&&!['style','action','formaction','form','srcdoc','target','download','ping','autofocus','contenteditable','name','is','slot','xmlns'].includes(a.name)).flatMap(a=>{
        if(a.name==='id')return [{name:a.name,value:ids.get(a.value)}];
        if(['href','xlink:href'].includes(a.name))return a.value.startsWith('#')&&ids.has(a.value.slice(1))?[{name:'href',value:'#'+ids.get(a.value.slice(1))}]:[];
        if(['src','poster','background'].includes(a.name))return safeAsset(a.value)?[a]:[];
        if(a.name==='srcset') {const values=a.value.split(',').map(v=>v.trim().split(/\s+/));return values.length&&values.every(([url,size,...extra])=>safeAsset(url)&&!extra.length&&(!size||/^(?:\d{1,4}w|[1-4](?:\.\d)?x)$/.test(size)))?[a]:[];}
        if(['aria-labelledby','aria-describedby','aria-controls','aria-owns','for','headers'].includes(a.name)){const mapped=a.value.split(/\s+/).map(v=>ids.get(v)).filter(Boolean);return mapped.length?[{name:a.name,value:mapped.join(' ')}]:[];}
        return [a];
      });
      if(n.tagName==='button'){n.attrs=n.attrs.filter(a=>a.name!=='type');n.attrs.push({name:'type',value:'button'});}
      clean(n);
    }
  }
  clean(fragment);return serialize(fragment);
}
export function materializeDocument(snapshot,document) {
  const {baseline,byId,sources}=validateAgainst(snapshot,document,availableFonts(snapshot.css));
  const originalChildren=new Map(baseline.nodes.map(n=>[n.id,n.children]));
  function renderRegion(start,end,original,current,editedText) {
    let cursor=start,out='',slot=0;const live=current.filter(id=>!byId.get(id).deleted);
    if(editedText!==undefined) return escapeText(editedText)+live.map(id=>render(id)).join('');
    // Keep an LCS of source-backed children in their exact original slots. Deletion alone must
    // not move a surviving sibling across source whitespace, comments, or unmapped content.
    const sourceIds=live.map(id=>byId.get(id).sourceId), dp=Array.from({length:original.length+1},()=>new Uint16Array(live.length+1));
    for(let i=original.length-1;i>=0;i--)for(let j=live.length-1;j>=0;j--)dp[i][j]=original[i]===sourceIds[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
    const anchors=new Map();let i=0,j=0;
    while(i<original.length&&j<live.length){if(original[i]===sourceIds[j]){anchors.set(original[i],j);i++;j++;}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}
    for(const id of original) {
      const source=sources.get(id);out+=snapshot.html.slice(cursor,source.source.start);
      if(anchors.has(id)){const target=anchors.get(id);while(slot<=target)out+=render(live[slot++]);}
      cursor=source.source.end;
    }
    out+=snapshot.html.slice(cursor,end);
    while(slot<live.length)out+=render(live[slot++]);
    return out;
  }
  function render(id) {
    const n=byId.get(id),s=n.source;
    let html=addLayerAttribute(snapshot.html.slice(s.start,s.openEnd),n.id);
    if(!VOID_TAGS.has(n.tag))html+=renderRegion(s.openEnd,s.closeStart,originalChildren.get(n.sourceId),n.children,n.textChanged?n.text:undefined)+snapshot.html.slice(s.closeStart,s.end);
    // Sanitize once per copied root. Descendants remain source-backed and receive independent layer IDs.
    if(n.copyOf&&(!n.parentId||!byId.get(n.parentId).copyOf))html=sanitizeCopy(html,n.id);
    return html;
  }
  const {bodyStart,bodyEnd}=sourceTree(snapshot);
  const html=snapshot.html.slice(0,bodyStart)+renderRegion(bodyStart,bodyEnd,baseline.roots,document.roots)+snapshot.html.slice(bodyEnd);
  const rule=(id,styles)=>`[data-v2-id="${id}"] {\n${Object.entries(styles).map(([k,v])=>`  ${k}: ${k==='font-family'?`"${v}"`:v};`).join('\n')}\n}\n`;
  const layoutStyles=(l,isAnchor)=>l.mode==='free'?{position:'absolute',left:`${l.x}px`,top:`${l.y}px`}:{position:isAnchor?'relative':'static',left:'auto',top:'auto'};
  let overrides='';const responsive=Object.fromEntries(VIEWPORTS.map(v=>[v,'']));
  const anchors=new Set(), responsiveAnchors=Object.fromEntries(VIEWPORTS.map(v=>[v,new Set()]));
  const active=document.nodes.filter(n=>!n.deleted);
  for(const n of active) {
    if(n.layout?.mode==='free')anchors.add(n.parentId);
    for(const viewport of VIEWPORTS)if((n.responsiveLayout[viewport]||n.layout)?.mode==='free')responsiveAnchors[viewport].add(n.parentId);
  }
  for(const n of active) {
    if(Object.keys(n.styles).length)overrides+=rule(n.id,n.styles);
    if(n.layout)overrides+=rule(n.id,layoutStyles(n.layout,anchors.has(n.id)));
    for(const viewport of VIEWPORTS) {
      if(Object.keys(n.responsive[viewport]||{}).length)responsive[viewport]+=rule(n.id,n.responsive[viewport]);
      if(n.responsiveLayout[viewport])responsive[viewport]+=rule(n.id,layoutStyles(n.responsiveLayout[viewport],responsiveAnchors[viewport].has(n.id)));
    }
  }
  const anchorRules=(ids,viewport)=>[...ids].filter(id=>!id||(viewport?(byId.get(id).responsiveLayout[viewport]||byId.get(id).layout):byId.get(id).layout)?.mode!=='free').map(id=>id?`[data-v2-id="${id}"] { position: relative; }\n`:'body { position: relative; }\n').join('');
  // Effective parent layouts are respected across viewports, including nested free layers.
  overrides=anchorRules(anchors)+overrides;
  for(const viewport of VIEWPORTS) {
    const scoped=anchorRules(responsiveAnchors[viewport],viewport)+responsive[viewport];
    if(scoped)overrides+=`@media ${VIEWPORT_MEDIA[viewport]} {\n${scoped}}\n`;
  }
  return {'src/index.html':html,'src/styles.css':snapshot.css+(overrides?'\n/* Editor V2 source-backed draft overrides. Human review required. */\n'+overrides:'')};
}

/** Explicit migration: match immutable source offsets; never mutate the old manifest or edits. */
export function migrateV1(snapshot,manifest,edits,{fontChoices=availableFonts(snapshot.css),idMap}={}) {
  array(manifest,MAX_NODES,'INVALID_MIGRATION');plain(edits,'INVALID_MIGRATION');
  for(const entry of manifest){plain(entry,'INVALID_MIGRATION');plain(entry.source,'INVALID_MIGRATION');}
  if(idMap!==undefined)plain(idMap,'INVALID_MIGRATION');
  let document=createDocument(snapshot);const operations=[];
  for(const [id,edit] of Object.entries(edits)) {
    const legacy=manifest.find(n=>n.id===id);if(!legacy)fail('INVALID_MIGRATION','Elemento anterior desconocido');
    exact(edit,['text','styles','responsive'],[],'INVALID_MIGRATION');
    const explicit=idMap?.[id];
    const matches=document.nodes.filter(n=>explicit?n.id===explicit:n.source.openEnd===legacy.source?.start&&n.tag===legacy.tag&&(legacy.source.end===undefined||n.source.closeStart===legacy.source.end));
    if(matches.length!==1)fail('INVALID_MIGRATION','No se pudo establecer una correspondencia exacta de fuente');
    const node=matches[0];if(explicit && (node.source.openEnd!==legacy.source?.start||node.tag!==legacy.tag||(legacy.source.end!==undefined&&node.source.closeStart!==legacy.source.end)))fail('INVALID_MIGRATION','El mapa explícito no coincide con la fuente');
    if(own(edit,'text'))operations.push({type:'text',id:node.id,text:edit.text});
    if(own(edit,'styles')&&Object.keys(plain(edit.styles,'INVALID_MIGRATION')).length)operations.push({type:'style',id:node.id,styles:edit.styles});
    if(own(edit,'responsive')){plain(edit.responsive,'INVALID_MIGRATION');for(const [viewport,styles]of Object.entries(edit.responsive))operations.push({type:'style',id:node.id,viewport,styles});}
  }
  for(let offset=0;offset<operations.length;offset+=MAX_OPERATIONS)document=applyOperations(snapshot,document,operations.slice(offset,offset+MAX_OPERATIONS),{fontChoices});
  return document;
}
export const migrateV1Document=migrateV1;
export function documentDiff(before,after) {
  const previous=new Map(before.nodes.map(n=>[n.id,n])), changes=[];
  for(const n of after.nodes) {
    const old=previous.get(n.id);
    if(!old){changes.push({element_id:n.id,operation:'duplicate',source_id:n.sourceId,parent_id:n.parentId});continue;}
    for(const [key,operation]of [['text','text-edit'],['deleted','delete'],['parentId','reparent'],['children','reorder'],['styles','style-edit'],['responsive','responsive-style'],['layout','layout-edit'],['responsiveLayout','responsive-layout']])if(!immutableEqual(old[key],n[key]))changes.push({element_id:n.id,label:n.label,operation,property:key,before:copy(old[key]),after:copy(n[key])});
  }
  if(!immutableEqual(before.roots,after.roots))changes.push({element_id:null,operation:'reorder',property:'roots',before:[...before.roots],after:[...after.roots]});
  return changes;
}
