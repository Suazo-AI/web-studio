import { test,expect } from '@playwright/test';
const field=prop=>`[data-prop="${prop}"]`;
test('desktop source-backed edit, saved reload, undo reload, redo, responsive and export',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#status')).toContainText('Guardado');
 const data=await page.request.get('/api/project').then(r=>r.json());const n=data.manifest.find(x=>x.text==='MAKE ROOM.');
 await page.locator(`[data-id="${n.id}"]`).click();await expect(page.locator('#text-edit')).toBeVisible();
 const preview=page.frameLocator('#preview');await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toBeVisible();
 await page.locator('#text-edit').fill('ESTILO DE PRUEBA.');await page.locator(field('font-family')).selectOption('Barlow Condensed');await page.locator(field('font-size')).fill('76');await page.locator(field('padding-top')).fill('16');await page.locator(field('color')).fill('#b9eed7');
 await page.getByRole('button',{name:'Revisar cambios',exact:true}).click();await expect(page.locator('#review-dialog')).toBeVisible();await expect(page.locator('#diff-list')).toContainText('ESTILO DE PRUEBA.');await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();await expect(page.locator('#status')).toContainText('Guardado');
 await page.reload();await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveText('ESTILO DE PRUEBA.');await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveCSS('color','rgb(185, 238, 215)');await expect(preview.locator(`[data-ve-id="${n.id}"]`)).toHaveCSS('padding-top','16px');
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
