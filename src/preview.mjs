import { parse, serialize } from 'parse5';
import { materialize, walk, PROPERTIES } from './model.mjs';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
export function previewHTML(snapshot,manifest,edits,assets,scope){
  const files=materialize(snapshot,manifest,edits); const doc=parse(files['src/index.html']);
  const nodesBySelector=new Map(manifest.map(x=>[x.selector,x]));
  walk(doc,(node,selector)=>{const entry=nodesBySelector.get(selector);if(entry)node.attrs.push({name:'data-ve-id',value:entry.id});});
  const forbidden=new Set(['script','iframe','object','embed','dialog','form','base','link','noscript','meta']);
  function clean(node){
    node.childNodes=(node.childNodes||[]).filter(n=>!forbidden.has(n.tagName));
    for(const n of node.childNodes){
      if(n.tagName==='template') {n.tagName='div';n.nodeName='div';n.childNodes=n.content?.childNodes||[];delete n.content;}
      if(n.attrs)n.attrs=n.attrs.filter(a=>!a.name.startsWith('on')&&!['href','action','formaction','srcdoc','style','target','download','ping'].includes(a.name)).map(a=>{
        if(a.name==='src')return {name:'src',value:assets[a.value.replace(/^\.\//,'')]?.data||''};
        if(a.name==='srcset') {const first=a.value.split(',')[0].trim().split(/\s+/)[0];return {name:'srcset',value:assets[first.replace(/^\.\//,'')]?.data||''};}
        return a;
      });
      clean(n);
    }
  }
  clean(doc);
  let css=files['src/styles.css'].replace(/url\(['"]?(.*?)['"]?\)/g,(_m,path)=>`url("${assets[path.replace(/^\.\//,'')]?.data||''}")`);
  // Preview-only outline; source exports contain no editor bridge or control overrides.
  css+='\n[data-ve-id]{cursor:crosshair}[data-ve-selected]{outline:2px solid #68ecc5!important;outline-offset:-2px}html{scroll-behavior:auto}button,input,select{pointer-events:none}';
  const bridge=`(()=>{const scope=${JSON.stringify(scope)};const allowed=${JSON.stringify(PROPERTIES)};let chosen=null;function select(id,scroll=false){const el=document.querySelector('[data-ve-id="'+id+'"]');if(!el)return;document.querySelector('[data-ve-selected]')?.removeAttribute('data-ve-selected');el.setAttribute('data-ve-selected','');chosen=id;if(scroll)el.scrollIntoView({block:'center'});const cs=getComputedStyle(el),r=el.getBoundingClientRect(),styles={};for(const p of allowed)styles[p]=cs.getPropertyValue(p);parent.postMessage({type:'ve:selected',...scope,element_id:id,styles,geometry:{x:r.x,y:r.y,width:r.width,height:r.height}},'*');}document.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const el=e.target.closest('[data-ve-id]');if(el)select(el.dataset.veId);},true);document.addEventListener('submit',e=>e.preventDefault(),true);addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='ve:select'||e.data?.nonce!==scope.nonce||e.data?.revision_id!==scope.revision_id||e.data?.project_id!==scope.project_id)return;if(/^el-\\d+$/.test(e.data.element_id))select(e.data.element_id,!!e.data.scroll);});parent.postMessage({type:'ve:ready',...scope},'*');})();`;
  const csp=`default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${scope.nonce}'; connect-src 'none'; form-action 'none'; base-uri 'none'`;
  return serialize(doc).replace('</head>',`<meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><style>${css.replace(/<\/style/gi,'<\\/style')}</style></head>`).replace('</body>',`<script nonce="${esc(scope.nonce)}">${bridge}</script></body>`);
}
