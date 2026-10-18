import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { requestAiReply } from '../src/core/ai-request';

async function server(handler: RequestListener, run: (url: string) => Promise<void>) {
  const s = createServer(handler);
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${(s.address() as any).port}`); }
  finally { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); }
}
const done = 'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n';
test('active reasoning survives idle window; finish does not wait for socket closure', async () => {
  await server((_req, res) => {
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    const tick = setInterval(() => res.write('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n'), 30);
    const finish = setTimeout(() => { clearInterval(tick); res.write(done); }, 280);
    res.on('close', () => {clearInterval(tick);clearTimeout(finish);});
  }, async url => {
    const result = await requestAiReply(url, {}, new AbortController().signal, () => {}, {idleMs:150,totalMs:1500});
    assert.equal(result.content, 'ok');
  });
});
test('silent base returns actionable timeout', async () => {
  await server(() => {}, async url => {
    await assert.rejects(requestAiReply(url, {}, new AbortController().signal, () => {}, {idleMs:80,totalMs:1000}), /模型基座.*未返回数据/);
  });
});
test('endless active stream remains bounded', async () => {
  await server((_req, res) => {
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    const tick=setInterval(() => res.write(': heartbeat\n\n'),20);
    res.on('close',()=>clearInterval(tick));
  }, async url => {
    await assert.rejects(requestAiReply(url, {}, new AbortController().signal, () => {}, {idleMs:150,totalMs:280}), /本轮响应超过/);
  });
});
test('user cancellation preserves its reason', async () => {
  await server(() => {}, async url => {
    const c=new AbortController(); const reason=new Error('user stopped');
    const timer=setTimeout(()=>c.abort(reason),40);
    try { await assert.rejects(requestAiReply(url, {}, c.signal, () => {}, {idleMs:500,totalMs:1000}), e=>e===reason); }
    finally {clearTimeout(timer);}
  });
});

