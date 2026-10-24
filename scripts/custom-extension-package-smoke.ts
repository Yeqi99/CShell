import {_electron as electron} from 'playwright';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const root=await mkdtemp(join(tmpdir(),'cshell-custom-package-'));
const path=join(root,'example.cshellext');await writeFile(path,JSON.stringify({format:'cshell-extension-1',manifest:{protocol:1,id:'example.test',version:'1.0.0',name:'Import fixture',description:'isolated declarative fixture',publisher:'Test',provider:'snippets',permissions:['terminal.input'],commands:[{label:'Inspect',text:'pwd'}]},files:[]}));
const app=await electron.launch({executablePath:process.env.CSHELL_EXECUTABLE!,env:{...process.env,CSHELL_TEST_DATA:join(root,'app'),CSHELL_TEST_START_GATE:'1',LOCALAPPDATA:root},timeout:60000});
try{
 await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
 const page=app.context().pages()[0]??await app.context().waitForEvent('page',{timeout:60000});await page.waitForFunction(()=>!!window.cshell);
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path);
 const before=await page.evaluate(()=>window.cshell.plugins());
 const preview=await page.evaluate(()=>window.cshell.pluginImportPreview());assert(preview);assert.equal(preview.manifest.id,'example.test');assert.deepEqual(await page.evaluate(()=>window.cshell.plugins()),before);
 await page.evaluate(token=>window.cshell.pluginImportApply(token),preview.token);
 const installed=await page.evaluate(()=>window.cshell.plugins());assert.equal(installed.find(p=>p.manifest.id==='example.test')?.enabled,false);
 await assert.rejects(page.evaluate(token=>window.cshell.pluginImportApply(token),preview.token));
 await page.evaluate(()=>window.cshell.pluginToggle('example.test',true));assert.equal((await page.evaluate(()=>window.cshell.plugins())).find(p=>p.manifest.id==='example.test')?.enabled,true);
 await page.evaluate(()=>window.cshell.pluginRemove('example.test'));assert(!(await page.evaluate(()=>window.cshell.plugins())).some(p=>p.manifest.id==='example.test'));
 console.log('PASS real packaged file-picker IPC, read-only preview, one-use confirmation, disabled import, enable and remove');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
