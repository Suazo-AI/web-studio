import { parse, serialize } from 'parse5';
import { materialize, walk, PROPERTIES } from './model.mjs';
import { canvasBridge } from './canvas-bridge.mjs';
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
  // The preview bridge and its controls are never included in exported source.
  css+=`\n[data-ve-id]{cursor:crosshair}[data-ve-selected]{outline:2px solid #68ecc5!important;outline-offset:-2px;cursor:grab}[contenteditable]{cursor:text;touch-action:auto;outline:2px solid #68ecc5!important}html{scroll-behavior:auto}button,input,select{pointer-events:none}
#ve-controls{position:fixed;z-index:2147483647;border:2px solid #68ecc5;pointer-events:none;box-sizing:border-box}#ve-controls[hidden]{display:none}#ve-controls button{all:initial;box-sizing:border-box;font:12px Arial;color:#14271f;background:#b9eed7;border:1px solid #315f4a;cursor:pointer;pointer-events:auto;text-align:center;touch-action:none;min-width:28px;height:28px;line-height:26px}#ve-controls button:focus-visible{outline:3px solid #fff;outline-offset:2px}#ve-controls button[hidden]{display:none}#ve-controls .ve-toolbar{position:absolute;left:0;bottom:100%;display:flex;white-space:nowrap;max-width:calc(100vw - 12px)}#ve-controls.ve-near-top .ve-toolbar{bottom:auto;top:100%}#ve-controls .ve-move{position:absolute;left:50%;top:100%;margin-left:-14px;cursor:move}#ve-controls .ve-resize{position:absolute;right:-9px;bottom:-9px;width:24px;min-width:24px;height:24px;line-height:22px;cursor:nwse-resize}`;
  const bridge=`(${canvasBridge.toString()})(${JSON.stringify(scope)},${JSON.stringify(PROPERTIES)},${JSON.stringify(manifest.filter(n=>n.editable.text).map(n=>n.id))});`;
  const csp=`default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${scope.nonce}'; connect-src 'none'; form-action 'none'; base-uri 'none'`;
  return serialize(doc).replace('</head>',`<meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><style>${css.replace(/<\/style/gi,'<\\/style')}</style></head>`).replace('</body>',`<script nonce="${esc(scope.nonce)}">${bridge}</script></body>`);
}
