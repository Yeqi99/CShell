import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentBrowserStream } from '../src/core/agent-browser-stream';

test('closing a browser upload while a chunk is in flight stops remaining chunks', async () => {
  let release!: () => void;
  let started!: () => void;
  const inflight = new Promise<void>(r => { release = r; });
  const firstWrite = new Promise<void>(r => { started = r; });
  const writes: number[] = [];
  let closes = 0;
  const stream = await agentBrowserStream(async (method, params: any) => {
    if (method === 'browser.open') return { id: 'upload' };
    if (method === 'browser.write') {
      writes.push(params.sequence);
      if (writes.length === 1) { started(); await inflight; }
      return {};
    }
    if (method === 'browser.close') { closes++; return {}; }
    throw Error('Unexpected call ' + method);
  }, 'upload.example', 443);
  stream.on('error', () => {});
  const completed = new Promise<Error | null | undefined>(r => stream.write(Buffer.alloc(3 * 65536), r));
  await firstWrite;
  stream.destroy();
  release();
  const error = await completed;
  assert.deepEqual(writes, [0], 'No further upload chunks after closing');
  assert.equal(closes, 1);
  assert(error, 'Cancelled upload must not report successful completion');
});

test('normal browser uploads retain chunk ordering and payload', async () => {
  const payload = Buffer.alloc(150000, 37);
  const chunks: Buffer[] = [];
  const sequences: number[] = [];
  const stream = await agentBrowserStream(async (method, params: any) => {
    if (method === 'browser.open') return { id: 'normal' };
    if (method === 'browser.write') { sequences.push(params.sequence); chunks.push(Buffer.from(params.data, 'base64')); }
    return {};
  }, 'upload.example', 443);
  try {
    await new Promise<void>((resolve, reject) => stream.write(payload, e => e ? reject(e) : resolve()));
    assert.deepEqual(sequences, [0, 1, 2]);
    assert.deepEqual(Buffer.concat(chunks), payload);
  } finally { stream.destroy(); }
});
