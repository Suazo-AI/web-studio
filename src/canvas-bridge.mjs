// Runs only inside the opaque, script-restricted preview. It never saves or calls an agent.
export function canvasBridge(scope, properties, textIds) {
  const editableText = new Set(textIds), originals = new Map(), logicalText = new Map(), allowed = new Set(properties);
  let chosen = null, enabled = false, editing = null, gesture = null, ticking = false;
  const send = (type, data = {}) => parent.postMessage({type, ...scope, ...data}, '*');
  const node = id => /^el-\d+$/.test(id || '') ? document.querySelector(`[data-ve-id="${id}"]`) : null;
  const safeText = text => typeof text === 'string' && text.length > 0 && text.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  const validStyle = (key, value) => allowed.has(key) && typeof value === 'string' && (key === 'font-family' ? /^(Anton|Barlow|Barlow Condensed|Arial|Georgia)$/.test(value) : key.includes('color') ? /^#[\da-f]{6}$/i.test(value) : key === 'font-weight' ? /^(400|500|600|700|800|900)$/.test(value) : key === 'line-height' ? /^(1(?:\.\d{1,2})?|2(?:\.0{1,2})?)$/.test(value) : /^\d+(\.\d{1,2})?px$/.test(value) && parseFloat(value) <= (key === 'font-size' ? 220 : key === 'letter-spacing' ? 20 : 160));
  for (const el of document.querySelectorAll('[data-ve-id]')) { originals.set(el.dataset.veId, el.textContent); logicalText.set(el.dataset.veId, el.textContent.trim()); }
  const overlay = document.createElement('div'); overlay.id = 've-controls'; overlay.hidden = true;
  overlay.innerHTML = '<div class="ve-toolbar" role="toolbar" aria-label="Editar elemento"><button type="button" data-command="edit" title="Editar texto (doble clic o Enter)">Texto</button><button type="button" data-command="left" aria-label="Mover a la izquierda">←</button><button type="button" data-command="up" aria-label="Mover arriba">↑</button><button type="button" data-command="down" aria-label="Mover abajo">↓</button><button type="button" data-command="right" aria-label="Mover a la derecha">→</button><button type="button" data-command="smaller" aria-label="Reducir texto">A−</button><button type="button" data-command="larger" aria-label="Aumentar texto">A+</button></div><button type="button" class="ve-move" data-handle="move" aria-label="Arrastrar para mover dentro del flujo" title="Mover · flechas para ajustar">✥</button><button type="button" class="ve-resize" data-handle="resize" aria-label="Arrastrar para cambiar tamaño de texto" title="Tamaño de texto">↘</button>';
  document.body.append(overlay);
  function geometry() {
    const el = node(chosen); if (!el || !enabled) {overlay.hidden = true; return;}
    const r = el.getBoundingClientRect(); overlay.hidden = false;
    Object.assign(overlay.style, {left:r.left+'px', top:r.top+'px', width:r.width+'px', height:r.height+'px'});
    overlay.classList.toggle('ve-near-top', r.top < 42);
    overlay.querySelector('[data-command="edit"]').hidden = !editableText.has(chosen);
    overlay.querySelector('.ve-resize').hidden = !editableText.has(chosen);
    for (const b of overlay.querySelectorAll('[data-command="smaller"],[data-command="larger"]')) b.hidden = !editableText.has(chosen);
  }
  function refresh() {if(ticking)return;ticking=true;requestAnimationFrame(()=>{ticking=false;geometry();});}
  function select(id, scroll=false) {
    const el=node(id);if(!el)return;
    if (chosen !== id) finishText();
    document.querySelector('[data-ve-selected]')?.removeAttribute('data-ve-selected');chosen=id;el.setAttribute('data-ve-selected','');
    if(scroll)el.scrollIntoView({block:'center'});
    const cs=getComputedStyle(el),styles={};for(const p of properties)styles[p]=cs.getPropertyValue(p);
    geometry();send('ve:selected',{element_id:id,styles});
  }
  function change(styles, transaction = crypto.randomUUID(), text) {
    const el=node(chosen);if(!enabled||!el)return;
    if(styles)for(const [p,v] of Object.entries(styles))if(validStyle(p,v))el.style.setProperty(p,v);
    if(text !== undefined && safeText(text))el.textContent=text;
    send('ve:change',{element_id:chosen,...(styles?{styles}:{}),...(text!==undefined?{text}:{}),transaction});refresh();
  }
  function finishText(cancel=false) {
    if(!editing)return;const session=editing;editing=null;const el=node(session.id);el.removeAttribute('contenteditable');el.removeAttribute('role');el.removeAttribute('aria-label');
    const text=el.textContent;
    if(cancel||!safeText(text)){el.textContent=session.beforeDOM;if(session.changed)send('ve:change',{element_id:session.id,text:session.before,transaction:session.transaction});}else if(session.changed)logicalText.set(session.id,text);
    refresh();
  }
  function startText() {
    if(!enabled||!editableText.has(chosen))return;finishText();const el=node(chosen);editing={id:chosen,before:logicalText.get(chosen),beforeDOM:el.textContent,changed:false,transaction:crypto.randomUUID()};
    el.setAttribute('contenteditable','plaintext-only');el.setAttribute('role','textbox');el.setAttribute('aria-label','Texto del elemento');el.focus();
    const selection=getSelection(),range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);refresh();
  }
  function limits(el) {
    const cs=getComputedStyle(el),parentStyle=getComputedStyle(el.parentElement);
    const width=el.parentElement.clientWidth-(parseFloat(parentStyle.paddingLeft)||0)-(parseFloat(parentStyle.paddingRight)||0);
    // Margins keep the element in normal document flow, and reserve room for readable content.
    const minContent=Math.min(el.getBoundingClientRect().width, Math.max(48,(parseFloat(cs.fontSize)||16)*2));
    return {left:parseFloat(cs.marginLeft)||0,top:parseFloat(cs.marginTop)||0,font:parseFloat(cs.fontSize)||16,maxLeft:Math.max(0,Math.min(160,width-minContent))};
  }
  const px=n=>Math.round(n*100)/100+'px',clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function moved(start,dx,dy){return {'margin-left':px(clamp(start.left+dx,0,start.maxLeft)),'margin-top':px(clamp(start.top+dy,0,160))};}
  function cancelGesture() {
    if(!gesture)return;const g=gesture;gesture=null;g.el.style.cssText=g.before;refresh();send('ve:gesture',{active:false});
  }
  function begin(event,mode) {
    if(!enabled||editing||event.button!==0||!node(chosen))return;
    const el=node(chosen);finishText();gesture={el,mode,pointer:event.pointerId,x:event.clientX,y:event.clientY,before:el.style.cssText,start:limits(el),styles:null,target:event.target};
    event.target.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();send('ve:gesture',{active:true});
  }
  overlay.addEventListener('pointerdown',e=>{const handle=e.target.closest('[data-handle]');if(handle)begin(e,handle.dataset.handle);});
  document.addEventListener('pointerdown',e=>{if(overlay.contains(e.target)||editing)return;const el=e.target.closest('[data-ve-id]');if(el?.dataset.veId===chosen)begin(e,'move');});
  document.addEventListener('pointermove',e=>{const g=gesture;if(!g||e.pointerId!==g.pointer)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;if(Math.hypot(dx,dy)<3&&!g.styles)return;g.styles=g.mode==='resize'?{'font-size':px(clamp(g.start.font+(dx+dy)/2,8,220))}:moved(g.start,dx,dy);for(const [p,v]of Object.entries(g.styles))g.el.style.setProperty(p,v);refresh();e.preventDefault();});
  document.addEventListener('pointerup',e=>{if(!gesture||e.pointerId!==gesture.pointer)return;const g=gesture;gesture=null;if(g.styles)change(g.styles);send('ve:gesture',{active:false});});
  document.addEventListener('pointercancel',cancelGesture);
  document.addEventListener('lostpointercapture',()=>{if(gesture)cancelGesture();});
  overlay.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const command=e.target.closest('[data-command]')?.dataset.command;if(!command)return;if(command==='edit'){startText();return;}finishText();const start=limits(node(chosen));if(command==='smaller'||command==='larger')change({'font-size':px(clamp(start.font+(command==='larger'?2:-2),8,220))});else change(moved(start,command==='left'?-4:command==='right'?4:0,command==='up'?-4:command==='down'?4:0));});
  document.addEventListener('click',e=>{if(overlay.contains(e.target)||editing?.id===e.target.closest('[data-ve-id]')?.dataset.veId)return;e.preventDefault();e.stopPropagation();const el=e.target.closest('[data-ve-id]');if(el)select(el.dataset.veId);},true);
  document.addEventListener('dblclick',e=>{if(overlay.contains(e.target))return;const el=e.target.closest('[data-ve-id]');if(el){select(el.dataset.veId);startText();e.preventDefault();}},true);
  document.addEventListener('input',e=>{if(editing&&e.target===node(editing.id)){const value=e.target.textContent;editing.changed=true;if(safeText(value))send('ve:change',{element_id:editing.id,text:value,transaction:editing.transaction});refresh();}});
  document.addEventListener('beforeinput',e=>{if(editing&&e.inputType==='insertParagraph')e.preventDefault();});
  document.addEventListener('paste',e=>{if(!editing)return;e.preventDefault();const text=e.clipboardData.getData('text/plain').replace(/[\r\n]+/g,' ');const selection=getSelection();if(!selection.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();range.insertNode(document.createTextNode(text));selection.collapseToEnd();node(editing.id).dispatchEvent(new Event('input',{bubbles:true}));});
  document.addEventListener('drop',e=>e.preventDefault(),true);
  document.addEventListener('focusout',e=>{if(editing&&e.target===node(editing.id))finishText();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(gesture)cancelGesture();else finishText(true);e.preventDefault();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){send('ve:shortcut',{command:'save'});e.preventDefault();return;}
    if(editing){if(e.key==='Enter'){finishText();e.preventDefault();}return;}
    if((e.ctrlKey||e.metaKey)&&['z','y','s'].includes(e.key.toLowerCase())){send('ve:shortcut',{command:e.key.toLowerCase()==='s'?'save':e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo'});e.preventDefault();return;}
    if(!enabled||!chosen)return;
    if(e.key==='Enter'&&!overlay.contains(e.target)){startText();e.preventDefault();}
    if(e.target.matches('[data-handle]')&&e.key.startsWith('Arrow')){const start=limits(node(chosen)),step=e.shiftKey?10:1;if(e.target.dataset.handle==='resize')change({'font-size':px(clamp(start.font+(['ArrowLeft','ArrowUp'].includes(e.key)?-step:step),8,220))});else change(moved(start,e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));e.preventDefault();}
  });
  document.addEventListener('submit',e=>e.preventDefault(),true);
  addEventListener('blur',cancelGesture);addEventListener('scroll',refresh,true);addEventListener('resize',refresh);new ResizeObserver(refresh).observe(document.body);
  addEventListener('message',e=>{
    const d=e.data;if(e.source!==parent||!d||d.nonce!==scope.nonce||d.revision_id!==scope.revision_id||d.project_id!==scope.project_id)return;
    if(d.type==='ve:flush'){finishText();send('ve:flushed',{request_id:d.request_id});}
    if(d.type==='ve:select')select(d.element_id,!!d.scroll);
    if(d.type==='ve:configure'){enabled=d.editable===true;if(!enabled){cancelGesture();finishText();}geometry();}
    if(d.type==='ve:sync'&&d.edits&&typeof d.edits==='object'){
      cancelGesture();finishText();for(const [id,text]of originals){const el=node(id);el.style.cssText='';if(editableText.has(id)){el.textContent=text;logicalText.set(id,text.trim());}}
      for(const [id,edit]of Object.entries(d.edits)){const el=node(id);if(!el||!edit)continue;if(editableText.has(id)&&safeText(edit.text)){el.textContent=edit.text;logicalText.set(id,edit.text);}for(const [p,v]of Object.entries(edit.styles||{}))if(validStyle(p,v))el.style.setProperty(p,v);}
      if(chosen)select(chosen);refresh();
    }
  });
  send('ve:ready');
}
