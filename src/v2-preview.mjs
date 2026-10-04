import {parse,serialize} from 'parse5';
import {materializeDocument} from './v2-model.mjs';
import {v2CanvasBridge} from './v2-canvas-bridge.mjs';
export function v2Preview(snapshot,document,assets,scope){
 const files=materializeDocument(snapshot,document),root=parse(files['src/index.html']);
 const forbidden=new Set(['script','style','iframe','object','embed','dialog','form','base','link','noscript','meta','template','svg','math']);
 function clean(node){node.childNodes=(node.childNodes||[]).filter(n=>!forbidden.has(n.tagName));for(const n of node.childNodes){if(n.attrs)n.attrs=n.attrs.filter(a=>!a.name.startsWith('on')&&!['href','action','formaction','srcdoc','style','target','download','ping','contenteditable','autofocus'].includes(a.name)).map(a=>{if(['src','poster'].includes(a.name))return {name:a.name,value:assets[a.value.replace(/^\.\//,'')]?.data||''};if(a.name==='srcset')return {name:a.name,value:''};return a;});clean(n);}}clean(root);
 let css=files['src/styles.css'].replace(/url\(['"]?(.*?)['"]?\)/g,(_m,path)=>`url("${assets[path.replace(/^\.\//,'')]?.data||''}")`).replace(/@import[^;]+;/gi,'');
 css+='\n[data-v2-id]{cursor:default;touch-action:pan-y}[data-v2-selected]{outline:2px solid #c9f26c!important;outline-offset:2px;cursor:move}[data-v2-empty]{min-width:24px;min-height:1em}[data-v2-empty]::before{content:"Texto vacío";opacity:.35;font:12px Arial;pointer-events:none}[contenteditable]{cursor:text;min-width:24px;min-height:1em}[contenteditable]::before{content:none}html{scroll-behavior:auto}button,input,select,textarea{pointer-events:none}';
 const data={...scope,roots:document.roots,nodes:document.nodes.filter(n=>!n.deleted).map(n=>({id:n.id,parentId:n.parentId,children:n.children,editable:n.editable,layout:n.responsiveLayout?.[scope.viewport]||n.layout||{mode:'flow'},text:n.text}))};
 const bridge=`(${v2CanvasBridge.toString()})(${JSON.stringify(data).replace(/</g,'\\u003c')});`;
 const scriptNonce=scope.cspNonce||scope.nonce;
 const csp=`default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; connect-src 'none'; form-action 'none'; base-uri 'none'`;
 return serialize(root).replace('</head>',`<meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css.replace(/<\/style/gi,'<\\/style')}</style></head>`).replace('</body>',`<script nonce="${scriptNonce}">${bridge}</script></body>`);
}
