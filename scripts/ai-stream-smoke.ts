import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'cshell-stream-ui-'));
let finish: (() => void) | undefined;
let calls = 0;
const api = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  calls++;
  assert.equal(body.stream, true);
  res.setHeader('content-type', 'text/event-stream');
  res.write(
    'data: ' +
      JSON.stringify({ choices: [{ index: 0, delta: { content: '<think>PRIVATE_REASONING</think>正在逐字回复' } }] }) +
      '\n\n',
  );
  finish = () =>
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [{ index: 0, delta: { content: '，已完成。' }, finish_reason: 'stop' }],
        }) +
        '\n\ndata: [DONE]\n\n',
    );
});
await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
const env = { ...process.env, CSHELL_TEST_DATA: directory, CSHELL_TEST_START_GATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.CSHELL_EXECUTABLE
    ? { executablePath: process.env.CSHELL_EXECUTABLE, args: [] }
    : { args: ['.'] }),
  env,
});
await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'AI 智能体' });
  const provider = {
    id: crypto.randomUUID(),
    name: 'Stream fixture',
    model: 'test',
    url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
  };
  await page.evaluate((p) => window.cshell.aiProviderSave(p, 'fixture-only'), provider);
  await panel.getByLabel('发送给智能体').waitFor({ state: 'visible' });
  await panel.getByLabel('发送给智能体').fill('测试流式显示');
  await panel.getByRole('button', {name:'发送',exact:true}).click();
  // The server deliberately holds the response open until visible partial text is verified.
  await panel.getByText('正在逐字回复', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.cshell.aiSnapshot())).threads[0].state, 'running');
  await panel.getByRole('button', { name: '停止 AI' }).waitFor();
  assert(!await panel.innerText().then(text=>text.includes('PRIVATE_REASONING')));
  finish!();
  await panel.getByText('正在逐字回复，已完成。', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '停止 AI' }).waitFor({ state: 'hidden' });
  const log=panel.locator('.agent-messages');
  await log.locator('.agent-message-body').evaluate(el=>{const late=document.createElement('div');late.style.height='1800px';el.append(late);});
  await page.waitForFunction(()=>{const el=document.querySelector('.agent-messages')!;return el.scrollHeight-el.clientHeight-el.scrollTop < 3;});
  await log.evaluate(el=>{el.scrollTop=0;});
  await panel.getByRole('button',{name:'回到最新消息'}).waitFor();
  await panel.getByLabel('发送给智能体').fill('测试停止');
  await panel.getByRole('button', {name:'发送',exact:true}).click();
  await panel.getByText('正在逐字回复', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '停止 AI' }).click();
  await panel.getByRole('button', {name:'停止 AI'}).waitFor({state:'hidden'});
  assert.notEqual((await page.evaluate(()=>window.cshell.aiSnapshot())).threads[0].state, 'running');
  finish!();
  assert.equal(calls, 2);
  assert(await log.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<60));
  await panel.getByRole('button',{name:'继续任务',exact:true}).click();
  await panel.getByRole('button',{name:'停止 AI'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.agent-running')!==null);
  await untilRequest();
  finish!();
  await panel.getByRole('button',{name:'停止 AI'}).waitFor({state:'hidden'});
  async function untilRequest(){for(let i=0;i<100 && calls<3;i++)await new Promise(r=>setTimeout(r,20));assert.equal(calls,3);}
  const alternate = {...provider,id:crypto.randomUUID(),name:'Second fixture',model:'second'};
  await page.evaluate(p=>window.cshell.aiProviderSave(p,'fixture-only'),alternate);
  await panel.getByRole('button',{name:'新建 AI 会话'}).click();
  await panel.getByRole('button',{name:'AI 基座与模型'}).click();
  await page.getByRole('button',{name:/Second fixture/}).click();
  await panel.getByLabel('发送给智能体').fill('并行任务 A');
  await panel.getByRole('button',{name:'发送',exact:true}).click();
  await panel.getByText('正在逐字回复',{exact:true}).waitFor();
  const finishA = finish!;
  await panel.getByRole('button',{name:'新建 AI 会话'}).click();
  assert.match(await panel.getByRole('button',{name:'AI 基座与模型'}).innerText(),/Second fixture/);
  await panel.getByLabel('发送给智能体').fill('并行任务 B');
  await panel.getByRole('button',{name:'发送',exact:true}).click();
  await panel.getByText('正在逐字回复',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'会话记录',exact:true}).click();
  await panel.locator('.agent-history-state[data-state="running"]').nth(1).waitFor();
  const tasks = (await page.evaluate(()=>window.cshell.aiSnapshot())).threads.filter(t=>t.state==='running');
  assert.equal(tasks.length,2);
  assert(tasks.every(t=>t.providerId===alternate.id));
  await panel.getByRole('button',{name:/并行任务 B.*正在执行/}).click();
  await panel.getByRole('button',{name:'停止 AI'}).click();
  await panel.getByRole('button',{name:'停止 AI'}).waitFor({state:'hidden'});
  assert.equal((await page.evaluate(()=>window.cshell.aiSnapshot())).threads.find(t=>t.title==='并行任务 A')?.state,'running');
  finishA();
  await page.evaluate((id) => window.cshell.aiProviderDelete(id), provider.id);
  assert.equal((await page.evaluate(()=>window.cshell.aiSnapshot())).providers.some(p=>p.id===provider.id),false);
  console.log(
    'PASS: partial reply visible before stream closes; thinking hidden; resume verified; two parallel streams visible in history; selected model retained; stopping one leaves the other running',
  );
} catch(error) {
 await mkdir('test-results',{recursive:true});
 const page=await app.firstWindow();await page.screenshot({path:'test-results/stream-failure.png'});
 console.log('Fixture requests:', calls);
 throw error;
} finally {
  finish?.();
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
  await app.close().catch(()=>{});
  await new Promise<void>((r) => api.close(() => r()));
  await rm(directory, { recursive: true, force: true });
}
