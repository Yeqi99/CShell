import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { AgentBrowserNetwork } from '../src/agent/browser-network';
import { agentBrowserStream } from '../src/core/agent-browser-stream';
test('agent browser tunnel binds ownership, verifies write order and transports bytes', async () => {
  const server = createServer((s) => s.pipe(s));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  let permitted = true;
  const network = new AgentBrowserNetwork(() => permitted);
  const port = (server.address() as any).port;
  try {
    const opened = (await network.call('browser.open', { host: '127.0.0.1', port }, 'a')) as any;
    await assert.rejects(network.call('browser.read', opened, 'b'));
    await assert.rejects(
      network.call('browser.write', { id: opened.id, sequence: 2, data: 'aGk=' }, 'a'),
    );
    await network.call('browser.write', { id: opened.id, sequence: 0, data: 'aGk=' }, 'a');
    const read = (await network.call('browser.read', opened, 'a')) as any;
    assert.equal(Buffer.from(read.data, 'base64').toString(), 'hi');
    await network.call('browser.close', opened, 'a');
    const stream = await agentBrowserStream((m, p) => network.call(m, p, 'a'), '127.0.0.1', port);
    const data = new Promise<Buffer>((r, j) => {
      stream.once('data', r);
      stream.once('error', j);
    });
    stream.write(Buffer.from('encrypted transport fixture'));
    assert.equal((await data).toString(), 'encrypted transport fixture');
    stream.destroy();
    permitted = false;
    await assert.rejects(network.call('browser.status', {}, 'a'));
  } finally {
    network.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
