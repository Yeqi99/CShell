import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { probeNetwork } from '../src/core/network-probe';
import { registerNetworkDiagnostics } from '../src/desktop/network-diagnostics';
import { agentCapability } from '../src/shared/agent';

test('TCP probe measures real handshakes without application payload and reports refusal as missing', async () => {
  let connections = 0, bytes = 0;
  const server = createServer(socket => { connections++; socket.on('data', data => { bytes += data.length; }); socket.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const result = await probeNetwork({ host: '127.0.0.1', port, samples: 3 }, new AbortController().signal);
    assert.equal(result.failed, 0);
    assert.equal(connections, 3);
    assert.equal(bytes, 0);
    assert.ok(result.minimumMs! >= 0);
    assert.ok(result.maximumMs! >= result.minimumMs!);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  const failed = await probeNetwork({ host: '127.0.0.1', port, samples: 2 }, new AbortController().signal);
  assert.equal(failed.failed, 2);
  assert.equal(failed.averageMs, null);
  assert.ok(failed.samples.every(sample => sample.elapsedMs === null && sample.error));
});

test('probe rejects excessive work and an aborted operation before opening a socket', async () => {
  for (const input of [{ host: 'localhost', port: 22, samples: 9 }, { host: 'localhost', port: 0 }, { host: 'localhost/x', port: 22 }]) {
    await assert.rejects(probeNetwork(input, new AbortController().signal));
  }
  const controller = new AbortController(); controller.abort(new Error('cancelled fixture'));
  await assert.rejects(probeNetwork({ host: 'localhost', port: 22 }, controller.signal), /cancelled fixture/);
  assert.equal(agentCapability('network.probe'), 'http.send');
});

test('remote source failure never falls back locally; cancellation reaches the selected source', async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const profile = { id: randomUUID(), name: 'Target', host: '127.0.0.1', port: 22, protocol: 'ssh' };
  let calls = 0;
  const dispose = registerNetworkDiagnostics((name, fn) => handlers.set(name, fn), {
    snapshot: () => ({ profiles: [profile] }), profile: () => profile,
  } as any, {} as any, {
    list: () => [{ deviceId: 'fixture', name: 'Source' }],
    call: async (_device: string, request: any, signal: AbortSignal) => {
      calls++; assert.equal(request.method, 'network.probe');
      if (calls === 1) throw new Error('remote permission denied');
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  } as any, { activeTargets: () => [] } as any);
  try {
    await assert.rejects(handlers.get('network:probe')!({ id: randomUUID(), source: 'agent:fixture', target: profile.id }), /remote permission denied/);
    const id = randomUUID();
    const pending = handlers.get('network:probe')!({ id, source: 'agent:fixture', target: profile.id });
    handlers.get('network:probe-cancel')!(id);
    await assert.rejects(pending, /已取消/);
    await assert.rejects(handlers.get('network:probe')!({ id: randomUUID(), source: 'ssh:closed', target: profile.id }), /来源连接/);
    assert.equal(calls, 2);
  } finally { dispose(); }
});
