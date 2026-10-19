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
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let pulls = 0, cancelled = false;
  let wake: (() => void) | undefined, requestSignal: AbortSignal | undefined;
  const abort = () => { if (!cancelled) controller.error(requestSignal!.reason); };
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull() { pulls++; wake?.(); wake = undefined; },
    cancel() { cancelled = true; requestSignal?.removeEventListener('abort', abort); },
  }, { highWaterMark: 0 });
  const waitForPull = async (after: number) => { if (pulls <= after) await new Promise<void>(resolve => { wake = resolve; }); };
  const transport: typeof fetch = async (_url, init) => {
    requestSignal = init!.signal!;
    requestSignal.addEventListener('abort', abort, { once: true });
    if (requestSignal.aborted) abort();
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  return {
    transport, ready: () => waitForPull(0), cancelled: () => cancelled,
    enqueue: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    async activity(text: string) {
      const before = pulls;
      controller.enqueue(new TextEncoder().encode(text));
      // highWaterMark=0: the next pull occurs after readAiResponse consumed this
      // chunk and reset its idle deadline, not merely after it was enqueued.
      await waitForPull(before);
    },
  };
}
test('active reasoning survives idle window; finish does not wait for socket closure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = controlledStream();
  const reply = requestAiReply('https://fixture.invalid', {}, new AbortController().signal, () => {}, { idleMs: 150, totalMs: 1500 }, stream.transport);
  await stream.ready();
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(100);
    await stream.activity('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n');
  }
  stream.enqueue(done); // Leave the producer open; finish_reason must cancel it.
  assert.equal((await reply).content, 'ok');
  assert.equal(stream.cancelled(), true);
});
test('silent base returns actionable timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = controlledStream();
  const rejected = assert.rejects(requestAiReply('https://fixture.invalid', {}, new AbortController().signal, () => {}, { idleMs: 80, totalMs: 1000 }, stream.transport), /模型基座.*未返回数据/);
  await stream.ready(); t.mock.timers.tick(80); await rejected;
});
test('received activity resets idle deadline but subsequent silence still expires', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = controlledStream();
  const rejected = assert.rejects(requestAiReply('https://fixture.invalid', {}, new AbortController().signal, () => {}, { idleMs: 150, totalMs: 1500 }, stream.transport), /模型响应中断.*没有收到数据/);
  await stream.ready(); t.mock.timers.tick(100);
  await stream.activity(': heartbeat\n\n');
  t.mock.timers.tick(150); await rejected;
});
test('endless active stream remains bounded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = controlledStream();
  const rejected = assert.rejects(requestAiReply('https://fixture.invalid', {}, new AbortController().signal, () => {}, { idleMs: 150, totalMs: 280 }, stream.transport), /本轮响应超过/);
  await stream.ready();
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(60); await stream.activity(': heartbeat\n\n'); }
  t.mock.timers.tick(40); await rejected;
});
test('user cancellation preserves its reason', async () => {
  const stream = controlledStream(), c = new AbortController(), reason = new Error('user stopped');
  const rejected = assert.rejects(requestAiReply('https://fixture.invalid', {}, c.signal, () => {}, { idleMs: 15000, totalMs: 30000 }, stream.transport), e => e === reason);
  await stream.ready(); c.abort(reason); await rejected;
});
test('real HTTP streamed finish completes while the server socket stays open', { timeout: 10000 }, async () => {
  await server((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(done); // Deliberately do not res.end().
  }, async url => {
    const result = await requestAiReply(url, {}, new AbortController().signal, () => {}, { idleMs: 15000, totalMs: 30000 });
    assert.equal(result.content, 'ok');
  });
});

