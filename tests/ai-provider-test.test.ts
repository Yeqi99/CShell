import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { testAiProvider } from '../src/core/ai-provider-test';

test('provider probe tests the requested model and streamed completion without tools or user context', async () => {
  let status = 200;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(req.headers.authorization, 'Bearer fixture');
    assert.equal(body.model, 'chosen-model');
    assert.equal(body.stream, true);
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with OK only.' }]);
    res.writeHead(status, { 'content-type': 'text/event-stream' });
    res.end(
      status === 200
        ? 'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        : 'private diagnostic never exposed',
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const p = {
      url: `http://127.0.0.1:${(server.address() as any).port}/v1`,
      model: 'chosen-model',
      key: 'fixture',
    };
    const result = await testAiProvider(p);
    assert.equal(result.streaming, true);
    assert.notEqual(result.firstTokenMs, null);
    status = 401;
    await assert.rejects(testAiProvider(p), /HTTP 401 · 请检查 API Key/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
