import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { visualToolSource } from '../src/core/visual-tools';
import { visualCapabilities, browserInteractInput } from '../src/shared/visual-tools';
import { DesktopAutomation, type DesktopAutomationHost } from '../src/core/desktop-automation';
import { withMcpImage } from '../src/core/mcp-images';
import type { DesktopViewEvent } from '../src/shared/desktop-view';

test('visual contributions remain scoped, revoked sources invalidate approval, and long actions recheck grants', async () => {
  const registry = new ConnectionRegistry(() => ({ id: 'scope', group: '' })),
    id = randomUUID();
  const connection = {
    target: {
      providerId: 'cshell.client',
      resourceId: 'machine',
      identity: 'fingerprint',
      label: 'machine',
    },
    tools: [],
  };
  registry.register({
    id: 'cshell.client',
    version: '1.0.0',
    capabilities: [],
    resolve: () => connection,
  });
  registry.bind(id, 'cshell.client');
  let allowed = true,
    called = 0;
  const unregister = registry.registerToolSource(
    'cshell.visual',
    visualCapabilities,
    visualToolSource({
      browser: async (_id, _action, _input, _signal, guard) => {
        called++;
        allowed = false;
        guard?.();
        return {};
      },
      desktop: async () => ({}),
    }),
  );
  assert.equal(registry.tools(id).length, 10);
  const pending = registry.prepare(id, 'browser_open', { url: 'https://example.test' });
  await assert.rejects(
    pending.execute(() => allowed, new AbortController().signal),
    /revoked/,
  );
  assert.equal(called, 1);
  allowed = true;
  const stale = registry.prepare(id, 'desktop_status', {});
  unregister();
  await assert.rejects(
    stale.execute(() => true, new AbortController().signal),
    /approval expired/,
  );
  assert.equal(registry.tools(id).length, 0);
  assert.throws(() =>
    browserInteractInput.parse({ action: 'evaluate', tabId: id, code: 'process.exit()' }),
  );
});

function desktopFixture(mode: 'frame' | 'reconnect' | 'revoked' = 'frame') {
  const listeners = new Set<(event: DesktopViewEvent) => void>(),
    inputs: unknown[] = [],
    state = { stops: 0, releases: 0, allowed: true };
  const host: DesktopAutomationHost = {
    validate: () => {
      if (!state.allowed) throw Error('revoked');
    },
    start: async (input) => {
      queueMicrotask(() => {
        if (mode === 'revoked') state.allowed = false;
        for (const listener of listeners)
          listener(
            mode === 'reconnect'
              ? {
                  id: input.id,
                  type: 'state',
                  state: 'reconnecting',
                  control: false,
                  attempt: 1,
                  delayMs: 500,
                }
              : {
                  id: input.id,
                  type: 'frame',
                  key: true,
                  sequence: '1',
                  timestamp: 1,
                  data: new Uint8Array([1]),
                },
          );
      });
      return { control: input.control, generation: 1 };
    },
    stop: async () => {
      state.stops++;
    },
    input: (_id, value) => inputs.push(value),
    release: () => {
      state.releases++;
    },
    ack: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    status: async () => ({ enabled: true }),
    decode: async () => ({
      dataBase64: Buffer.from([255, 216, 255, 217]).toString('base64'),
      width: 640,
      height: 480,
    }),
  };
  return { host, inputs, state, listeners, tools: new DesktopAutomation(host) };
}
test('desktop capture returns bounded image only, then closes its private view', async () => {
  const f = desktopFixture();
  const result = (await f.tools.invoke(
    'machine',
    'capture',
    {},
    new AbortController().signal,
  )) as any;
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.width, 640);
  assert.equal(f.state.stops, 1);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.inputs.length, 0);
  assert.equal('ticket' in result, false);
});
test('desktop input is atomic and released; disconnect or grant revocation never replays input', async () => {
  const f = desktopFixture();
  await f.tools.invoke(
    'machine',
    'interact',
    { action: 'key', code: 46, modifiers: [29] },
    new AbortController().signal,
  );
  assert.deepEqual(f.inputs, [
    { kind: 'key', code: 29, down: true },
    { kind: 'key', code: 46, down: true },
    { kind: 'key', code: 46, down: false },
    { kind: 'key', code: 29, down: false },
  ]);
  assert.equal(f.state.stops, 1);
  assert.equal(f.state.releases, 1);
  for (const mode of ['reconnect', 'revoked'] as const) {
    const g = desktopFixture(mode);
    await assert.rejects(
      g.tools.invoke(
        'machine',
        'interact',
        { action: 'click', x: 0.5, y: 0.5 },
        new AbortController().signal,
      ),
    );
    assert.equal(g.inputs.length, 0);
    assert.equal(g.state.stops, 1);
  }
});
test('MCP images are attached without embedding base64 into text, while REST results stay unchanged', () => {
  const image = {
    mimeType: 'image/jpeg',
    dataBase64: Buffer.from([255, 216, 255, 217]).toString('base64'),
    width: 640,
    height: 480,
    target: 'machine',
    frameId: '1',
  };
  const raw = { content: [{ type: 'text' as const, text: JSON.stringify(JSON.stringify(image)) }] };
  const result = withMcpImage(raw);
  assert.equal(result.content.length, 2);
  assert.equal(result.content[1].type, 'image');
  assert.equal(result.content[0].type, 'text');
  assert.ok(!JSON.stringify(result.content[0]).includes(image.dataBase64));
  assert.ok(raw.content[0].text.includes(image.dataBase64));
  assert.equal(
    withMcpImage({
      content: [{ type: 'text', text: JSON.stringify({ ...image, dataBase64: 'not-an-image' }) }],
    }).content.length,
    1,
  );
});


test('desktop automation keeps authenticated view alive until every input acknowledgment',async()=>{
 const f=desktopFixture();let acknowledge!:()=>void;let reached!:()=>void;const queued=new Promise<void>(r=>{reached=r;});
 f.host.input=()=>new Promise<void>(r=>{acknowledge=r;reached();});
 const task=f.tools.invoke('machine','interact',{action:'move',x:.2,y:.3},new AbortController().signal);
 await queued;assert.equal(f.state.stops,0);assert.equal(f.state.releases,0);
 acknowledge();await task;assert.equal(f.state.stops,1);assert.equal(f.state.releases,1);
 const failed=desktopFixture();let attempts=0;failed.host.input=async()=>{attempts++;throw Error('input rejected');};
 await assert.rejects(failed.tools.invoke('machine','interact',{action:'click',x:.2,y:.3},new AbortController().signal),/input rejected/);
 assert.equal(attempts,1);assert.equal(failed.state.stops,1);
});
