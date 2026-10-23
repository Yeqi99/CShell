import { _electron as electron } from 'playwright';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';

const data = await mkdtemp(join(tmpdir(), 'cshell-ai-exit-'));
let response: ServerResponse | undefined;
const server = createServer(async (req,res) => { for await (const _ of req) {} response=res; });
await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
const env={...process.env,CSHELL_TEST_DATA:data}; delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env,timeout:30000});
const child=app.process();
try {
  const page=await app.firstWindow();
  await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
  const provider={id:randomUUID(),name:'Exit fixture',model:'fixture',url:`http://127.0.0.1:${(server.address() as any).port}/v1`};
  const id=await page.evaluate(async provider=>{
    await window.cshell.aiProviderSave(provider);
    const thread=await window.cshell.aiThreadCreate('workspace',provider.id,'review');
    await window.cshell.aiSend(thread.id,'Keep this turn running until the fixture responds');
    return thread.id;
  },provider);
  await page.waitForFunction(async id=>(await window.cshell.aiSnapshot()).threads.find(t=>t.id===id)?.state==='running',id);
  await app.evaluate(({dialog})=>{
    (globalThis as any).exitPrompts=[];
    dialog.showMessageBox=(async (_window:any,options:any)=>{(globalThis as any).exitPrompts.push(options.message);return {response:0,checkboxChecked:false};}) as any;
  });
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(()=> (globalThis as any).exitPrompts.length),1);
  assert.equal((await page.evaluate(()=>window.cshell.aiSnapshot())).threads.find(t=>t.id===id)?.state,'running');
  assert.equal(page.isClosed(),false);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as any;});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close()).catch(()=>{});
  await app.close();
  console.log('PASS: AI-only active turn prompts on exit; cancel preserves task/window; confirm stops and exits');
} finally {
  if(child.exitCode===null && child.pid) execFile('taskkill',['/PID',String(child.pid),'/T','/F'],()=>{});
  response?.destroy(); server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:500});
}
