import { test,expect } from '@playwright/test';
const field=prop=>`[data-prop="${prop}"]`;
test('desktop source-backed edit, saved reload, undo reload, redo, responsive and export',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#status')).toContainText('Guardado');
 const data=await page.request.get('/api/project').then(r=>r.json());const n=data.manifest.find(x=>x.text==='MAKE ROOM.');
 await page.locator(`[data-id="${n.id}"]`).click();await expect(page.locator('#text-edit')).toBeVisible();
 const preview=page.frameLocator('#preview');await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toBeVisible();
 await page.screenshot({path:'test-results/before-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Móvil',exact:true}).click();await expect(preview.locator('.hero')).toHaveCSS('grid-template-columns',/^\d+(?:\.\d+)?px$/);await expect(page.locator(field('font-size'))).toHaveValue('44');await page.screenshot({path:'test-results/before-mobile-preview.png',fullPage:true});await page.getByRole('button',{name:'Escritorio',exact:true}).click();
 await page.locator('#text-edit').fill('ESTILO DE PRUEBA.');await page.locator(field('font-family')).selectOption('Arial');await page.locator(field('font-size')).fill('76');await page.locator(field('padding-top')).fill('16');await page.locator(field('color')).fill('#b9eed7');
 await page.getByRole('button',{name:'Revisar cambios',exact:true}).click();await expect(page.locator('#review-dialog')).toBeVisible();await expect(page.locator('#diff-list')).toContainText('ESTILO DE PRUEBA.');await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();await expect(page.locator('#status')).toContainText('Guardado');
 await page.reload();await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveText('ESTILO DE PRUEBA.');await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveCSS('color','rgb(185, 238, 215)');await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveCSS('font-family','Arial');await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveCSS('padding-top','16px');await page.screenshot({path:'test-results/after-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Móvil',exact:true}).click();await page.screenshot({path:'test-results/after-mobile-preview.png',fullPage:true});await page.getByRole('button',{name:'Escritorio',exact:true}).click();
 await page.getByRole('button',{name:'Deshacer',exact:true}).click();await expect(page.locator('#status')).toContainText('Guardado');await page.reload();await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveText('MAKE ROOM.');
 await page.getByRole('button',{name:'Rehacer',exact:true}).click();await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveText('ESTILO DE PRUEBA.');
 await page.getByRole('button',{name:'Móvil',exact:true}).click();await expect(page.locator('#preview')).toHaveCSS('width','390px');
 await page.screenshot({path:'test-results/editor-mobile-preview.png',fullPage:true});
 await page.getByRole('button',{name:'Escritorio',exact:true}).click();await page.getByRole('button',{name:'Deshacer',exact:true}).click();await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveText('MAKE ROOM.');
 await page.screenshot({path:'test-results/editor-desktop.png',fullPage:true});
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar cambios'}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/source-draft-r\d+\.json/);
 expect(errors).toEqual([]);
});
test('opaque preview cannot access parent and spoofed selection ignored',async({page})=>{
 await page.goto('/');await expect(page.locator('#status')).toContainText('Guardado');
 await expect.poll(()=>page.frames().some(f=>f.url().includes('/preview?'))).toBeTruthy();const frame=page.frames().find(f=>f.url().includes('/preview?'));
 const result=await frame.evaluate(()=>{try{return parent.document.title}catch{return 'blocked'}});expect(result).toBe('blocked');
 await page.evaluate(()=>postMessage({type:'ve:selected',project_id:'studio-demo',revision_id:'r0',element_id:'el-1',nonce:'bad'},'*'));
 await expect(page.locator('#selection-empty')).toBeVisible();
 const source=await page.request.get('/api/project').then(r=>r.json());const before=source.head;
 await frame.locator('.call-action').click();await expect.poll(async()=>await page.request.get('/api/project').then(r=>r.json()).then(x=>x.head)).toBe(before);expect(page.url()).toBe('http://127.0.0.1:4177/');
});
test('narrow shell remains usable without page-level horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('#status')).toContainText('Guardado');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Móvil',exact:true}).click();await page.getByRole('tab',{name:'Gusto'}).click();await expect(page.getByRole('button',{name:'Descargar web-taste.md'})).toBeVisible();
 await page.screenshot({path:'test-results/editor-mobile-shell.png',fullPage:true});
});

async function resetDraft(page){const p=await page.request.get('/api/project').then(r=>r.json());if(p.head!=='r0')await page.request.post('/api/action',{data:{action:'restore_revision',args:{revision_id:'r0',expected_revision:p.head}}});await page.goto('/');await expect(page.locator('#status')).toContainText('Guardado');return p.manifest.find(n=>n.text==='MAKE ROOM.');}
async function canvasPoint(page,locator){const r=await locator.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}),f=await page.locator('#preview').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,cssWidth:parseFloat(el.style.width)}}),scale=f.width/f.cssWidth;return {x:f.x+(r.x+r.width/2)*scale,y:f.y+(r.y+r.height/2)*scale,scale};}
async function clickInFrame(page,locator,clickCount=1){await locator.scrollIntoViewIfNeeded();const p=await canvasPoint(page,locator);await page.mouse.click(p.x,p.y,{clickCount});}
async function dragInFrame(page,locator,dx,dy){const p=await canvasPoint(page,locator);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+dx*p.scale,p.y+dy*p.scale,{steps:8});await page.mouse.up();}
test('direct canvas text, flow drag, size handles, multi-step undo, Save and exact audit',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const n=await resetDraft(page),preview=page.frameLocator('#preview'),text=preview.locator(`[data-ve-id="${n.id}"]`);
 await clickInFrame(page,text);await expect(preview.locator('#ve-controls')).toBeVisible();await page.screenshot({path:'test-results/direct-before-desktop.png',fullPage:true});
 await clickInFrame(page,text,2);await expect(text).toHaveAttribute('contenteditable','plaintext-only');await text.fill('DIRECT CANVAS.');await text.press('Enter');await expect(page.locator('#text-edit')).toHaveValue('DIRECT CANVAS.');
 const originalFont=await text.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 await dragInFrame(page,preview.getByRole('button',{name:'Arrastrar para mover dentro del flujo'}),24,18);await expect.poll(()=>text.evaluate(el=>parseFloat(getComputedStyle(el).marginLeft))).toBeGreaterThan(20);
 const left=await text.evaluate(el=>parseFloat(getComputedStyle(el).marginLeft));
 await dragInFrame(page,preview.getByRole('button',{name:'Arrastrar para cambiar tamaño de texto'}),18,14);await expect.poll(()=>text.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(originalFont+10);
 const font=await text.evaluate(el=>getComputedStyle(el).fontSize);
 await page.getByRole('button',{name:'Deshacer',exact:true}).click();await expect(text).toHaveCSS('font-size',originalFont+'px');await page.getByRole('button',{name:'Deshacer',exact:true}).click();await expect(text).toHaveCSS('margin-left','0px');await page.getByRole('button',{name:'Rehacer',exact:true}).click();await expect(text).toHaveCSS('margin-left',left+'px');await page.getByRole('button',{name:'Rehacer',exact:true}).click();await expect(text).toHaveCSS('font-size',font);
 await page.getByRole('button',{name:'Móvil',exact:true}).click();await expect(text).toHaveCSS('font-size','44px');await expect(text).toHaveCSS('margin-left','0px');await page.screenshot({path:'test-results/direct-before-mobile.png',fullPage:true});
 await clickInFrame(page,text);await clickInFrame(page,preview.getByRole('button',{name:'Aumentar texto',exact:true}));await expect(text).toHaveCSS('font-size','46px');await page.screenshot({path:'test-results/direct-after-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Guardar',exact:true}).click();await expect(page.locator('#status')).toContainText('cambios registrados');await expect(page.locator('#review-dialog')).not.toBeVisible();
 const p=await page.request.get('/api/project').then(r=>r.json()),r=p.history.at(-1);expect(r.revision_hash).toMatch(/^[a-f0-9]{64}$/);expect(r.audit.changes.some(c=>c.property==='text'&&c.after==='DIRECT CANVAS.')).toBeTruthy();expect(r.audit.changes.some(c=>c.viewport==='desktop'&&c.property==='margin-left')).toBeTruthy();expect(r.audit.changes.some(c=>c.viewport==='mobile'&&c.property==='font-size')).toBeTruthy();
 await page.reload();await expect(text).toHaveText('DIRECT CANVAS.');await expect(text).toHaveCSS('font-size',font);await expect(text).toHaveCSS('margin-left',left+'px');await page.screenshot({path:'test-results/direct-after-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Móvil',exact:true}).click();await expect(text).toHaveCSS('font-size','46px');await page.getByRole('button',{name:'Deshacer',exact:true}).click();await expect(text).toHaveText('MAKE ROOM.');await page.reload();await expect(text).toHaveText('MAKE ROOM.');expect(errors).toEqual([]);
});
test('gesture cancellation, plain text injection safety, read-only comparison and viewport isolation',async({page})=>{
 const n=await resetDraft(page),preview=page.frameLocator('#preview'),text=preview.locator(`[data-ve-id="${n.id}"]`);await clickInFrame(page,text);const handle=preview.getByRole('button',{name:'Arrastrar para mover dentro del flujo'}),point=await canvasPoint(page,handle);await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+60*point.scale,point.y+40*point.scale,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await expect(text).toHaveCSS('margin-left','0px');await expect(page.locator('#save')).toBeDisabled();
 await clickInFrame(page,text,2);await text.fill('<img src=x onerror=alert(1)>');await text.press('Enter');await expect(text.locator('img')).toHaveCount(0);await page.getByRole('button',{name:'Ver original',exact:true}).click();await expect(text).toHaveText('MAKE ROOM.');await page.getByRole('button',{name:'Móvil',exact:true}).click();await expect(text).toHaveText('MAKE ROOM.');await expect(preview.locator('#ve-controls')).not.toBeVisible();await page.getByRole('button',{name:'Volver al borrador',exact:true}).click();await expect(text).toHaveText('<img src=x onerror=alert(1)>');await clickInFrame(page,text);await clickInFrame(page,preview.getByRole('button',{name:'Texto',exact:true}));await text.fill('CANCEL THIS');await text.press('Escape');await expect(text).toHaveText('<img src=x onerror=alert(1)>');
});
test('scrolled canvas stays aligned and keyboard move controls work at mobile width',async({page})=>{
 await page.setViewportSize({width:390,height:844});await resetDraft(page);await page.getByRole('button',{name:'Móvil',exact:true}).click();const preview=page.frameLocator('#preview'),text=preview.getByText('One canvas',{exact:true});await text.scrollIntoViewIfNeeded();await clickInFrame(page,text);const selected=preview.locator('[data-ve-selected]');await expect(preview.locator('#ve-controls')).toBeVisible();const geometry=await selected.evaluate(el=>{const a=el.getBoundingClientRect(),b=document.querySelector('#ve-controls').getBoundingClientRect();return {x:Math.abs(a.x-b.x),y:Math.abs(a.y-b.y)}});expect(geometry.x).toBeLessThan(2);expect(geometry.y).toBeLessThan(2);await clickInFrame(page,preview.getByRole('button',{name:'Mover a la derecha',exact:true}));await expect(selected).toHaveCSS('margin-left','4px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/direct-mobile-scrolled.png',fullPage:true});
});
