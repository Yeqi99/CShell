import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as tcpServer } from 'node:net';
import { createServer as tlsServer, connect as tlsConnect, type TLSSocket } from 'node:tls';
import { once } from 'node:events';
import { X509Certificate } from 'node:crypto';
import { AgentRelayService, openRelayTunnel } from '../src/agent/relay';
import { AgentReverseRelayService } from '../src/agent/relay-reverse';
import { agentRelayConfigSchema } from '../src/shared/agent-relay';
import { ClientVault, createIdentity, fingerprint } from '../src/core/client/identity';

const codec = {
  encrypt: async (s: string) => Buffer.from(s).toString('base64'),
  decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
};
async function freePort() {
  const server = tcpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-relay-'));
  const identity = await createIdentity();
  const targetIdentity = await createIdentity();
  const targetSockets = new Set<TLSSocket>();
  const server = tlsServer(
    { key: targetIdentity.key, cert: targetIdentity.certificate },
    (socket) => {
      targetSockets.add(socket);
      socket.on('error', () => {});
      socket.once('close', () => targetSockets.delete(socket));
      socket.on('data', (data) => socket.write(data));
    },
  );
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const targetPort = (server.address() as { port: number }).port;
  const audit: string[] = [];
  const vault = new ClientVault(directory, codec);
  const relay = new AgentRelayService({
    vault,
    identity,
    audit: (event) => audit.push(JSON.stringify(event)),
  });
  await relay.load();
  const config = agentRelayConfigSchema.parse({
    enabled: true,
    port: await freePort(),
    targets: [{ id: 'target', host: '127.0.0.1', port: targetPort }],
  });
  const options = () => ({
    host: '127.0.0.1',
    port: config.port,
    fingerprint: fingerprint(identity.certificate),
    credential: relay.revealCredential(),
    targetId: 'target',
    signal: new AbortController().signal,
  });
  return {
    targetPort,
    relay,
    config,
    options,
    targetIdentity,
    vault,
    identity,
    audit,
    async close() {
      await relay.stop();
      for (const socket of targetSockets) socket.destroy();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(directory, { force: true, recursive: true });
    },
  };
}
function closed(socket: TLSSocket) {
  return new Promise<void>((resolve) => {
    if (socket.destroyed) resolve();
    else socket.once('close', () => resolve());
  });
}
test('relay configuration CAS rejects concurrent stale drafts before persistence or shutdown', async () => {
  const f = await fixture();
  const reverse = new AgentReverseRelayService({ vault: f.vault });
  try {
    await reverse.load();
    const expectedRevision = f.relay.status().revision;
    const results = await Promise.allSettled([
      f.relay.configure({ ...f.config, maxConnections: 2, expectedRevision }),
      f.relay.configure({ ...f.config, maxConnections: 3, expectedRevision }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(f.relay.status().config.maxConnections, 2);
    await f.relay.start();
    await assert.rejects(f.relay.configure({ ...f.config, expectedRevision }), /configuration changed/);
    assert.equal(f.relay.status().running, true);
    const revision = reverse.status().revision;
    const reverseResults = await Promise.allSettled([
      reverse.configure({ enabled: false, localPort: 22444, expectedRevision: revision }),
      reverse.configure({ enabled: false, localPort: 22445, expectedRevision: revision }),
    ]);
    assert.equal(reverseResults.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(reverse.status().config.localPort, 22444);
    const restored = new AgentReverseRelayService({ vault: f.vault });
    await restored.load();
    assert.equal(restored.status().config.localPort, 22444);
    assert.notEqual(restored.status().revision, reverse.status().revision);
    await assert.rejects(restored.configure({ enabled: false, expectedRevision: reverse.status().revision }), /configuration changed/);
    await restored.stop();
  } finally { await reverse.stop(); await f.close(); }
});
async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('Reverse relay connects outbound-only B, isolates registration/control credentials and retains B TLS identity', async () => {
  const f = await fixture();
  const reverse = new AgentReverseRelayService({ vault: f.vault });
  try {
    await f.relay.configure({ ...f.config, targets: [{ id: 'target', mode: 'reverse' }] });
    await f.relay.start();
    const registrationCredential = f.relay.registrationCredential({ targetId: 'target' });
    assert.notEqual(registrationCredential, f.relay.revealCredential());
    assert.equal(f.relay.status().config.targets[0].host, '');
    await assert.rejects(
      openRelayTunnel({ ...f.options(), operation: 'register' }),
      /unauthorized/,
    );
    await assert.rejects(
      openRelayTunnel({ ...f.options(), credential: registrationCredential }),
      /unauthorized/,
    );
    await reverse.load();
    const { signal: _signal, ...relay } = f.options();
    await reverse.configure({
      enabled: true,
      relay: { ...relay, credential: registrationCredential },
      localPort: f.targetPort,
    });
    await reverse.start();
    await until(() => reverse.status().connected);
    assert.deepEqual(f.relay.status().registeredTargets, ['target']);
    assert.ok(!JSON.stringify(reverse.status()).includes(registrationCredential));
    const outer = await openRelayTunnel(f.options());
    const inner = tlsConnect({ socket: outer, rejectUnauthorized: false });
    inner.on('error', () => {});
    await once(inner, 'secureConnect');
    assert.equal(
      new X509Certificate(inner.getPeerCertificate().raw).fingerprint256,
      fingerprint(f.targetIdentity.certificate),
    );
    const response = once(inner, 'data');
    inner.write('B only dialed A outbound');
    assert.equal((await response)[0].toString(), 'B only dialed A outbound');
    await reverse.stop();
    await closed(inner);
    await until(() => f.relay.status().registeredTargets.length === 0);
    await assert.rejects(openRelayTunnel(f.options()), /unauthorized/);
    await reverse.start();
    await until(() => reverse.status().connected);
    const live = await openRelayTunnel(f.options());
    await f.relay.rotateRegistrationCredential({ targetId: 'target' });
    await closed(live);
    await until(() => !reverse.status().connected);
    await assert.rejects(
      openRelayTunnel({
        ...f.options(),
        credential: registrationCredential,
        operation: 'register',
      }),
      /unauthorized/,
    );
  } finally {
    await reverse.stop();
    await f.close();
  }
});

test('Relay is opt-in, persists encrypted settings without auto-start and separates credentials from status', async () => {
  const f = await fixture();
  try {
    assert.equal(f.relay.status().config.enabled, false);
    await assert.rejects(f.relay.start(), /disabled/);
    await f.relay.configure(f.config);
    await f.relay.start();
    const restored = new AgentRelayService({ vault: f.vault, identity: f.identity });
    await restored.load();
    assert.equal(restored.status().running, false);
    assert.equal(restored.status().config.enabled, true);
    assert.equal(restored.revealCredential(), f.relay.revealCredential());
    assert.ok(!JSON.stringify(f.relay.status()).includes(f.relay.revealCredential()));
  } finally {
    await f.close();
  }
});

test('Relay verifies its TLS identity before credentials and tunnels independently verified end-to-end target TLS', async () => {
  const f = await fixture();
  try {
    await f.relay.configure(f.config);
    await f.relay.start();
    await assert.rejects(
      openRelayTunnel({ ...f.options(), fingerprint: fingerprint(f.targetIdentity.certificate) }),
      /identity mismatch/,
    );
    await assert.rejects(
      openRelayTunnel({ ...f.options(), credential: '0'.repeat(64) }),
      /unauthorized/,
    );
    await assert.rejects(openRelayTunnel({ ...f.options(), targetId: 'unlisted' }), /unauthorized/);
    const outer = await openRelayTunnel(f.options());
    const inner = tlsConnect({ socket: outer, rejectUnauthorized: false });
    inner.on('error', () => {});
    await once(inner, 'secureConnect');
    const observed = new X509Certificate(inner.getPeerCertificate().raw).fingerprint256;
    assert.equal(observed, fingerprint(f.targetIdentity.certificate));
    assert.notEqual(observed, fingerprint(f.identity.certificate));
    const response = once(inner, 'data');
    inner.write('target TLS remains end-to-end');
    assert.equal((await response)[0].toString(), 'target TLS remains end-to-end');
    inner.destroy();
    await closed(inner);
    assert.ok(f.audit.some((event) => event.includes('relay.open')));
    assert.ok(f.audit.every((event) => !event.includes(f.relay.revealCredential())));
  } finally {
    await f.close();
  }
});

test('Relay enforces connection, total traffic and rate bounds; cancellation and credential rotation revoke live tunnels', async () => {
  const f = await fixture();
  try {
    await f.relay.configure({ ...f.config, maxConnections: 1 });
    await f.relay.start();
    const abort = new AbortController();
    const first = await openRelayTunnel({ ...f.options(), signal: abort.signal });
    await assert.rejects(openRelayTunnel(f.options()));
    abort.abort();
    await closed(first);
    await f.relay.stop();
    await f.relay.configure({ ...f.config, maxBytesPerTunnel: 1024 });
    await f.relay.start();
    const limited = await openRelayTunnel(f.options());
    limited.write(Buffer.alloc(2048));
    await closed(limited);
    assert.ok(f.audit.some((event) => event.includes('traffic limit')));
    await f.relay.configure({ ...f.config, bytesPerSecond: 1024 });
    await f.relay.start();
    const rateLimited = await openRelayTunnel(f.options());
    rateLimited.write(Buffer.alloc(4096));
    await closed(rateLimited);
    await f.relay.configure(f.config);
    await f.relay.start();
    const before = f.options();
    const active = await openRelayTunnel(before);
    await f.relay.rotateCredential();
    await closed(active);
    await assert.rejects(openRelayTunnel(before), /unauthorized/);
    const fresh = await openRelayTunnel(f.options());
    fresh.destroy();
  } finally {
    await f.close();
  }
});

test('Relay cannot convert forwarding credentials to target authorization and configuration changes close old tunnels', async () => {
  const f = await fixture();
  try {
    await f.relay.configure(f.config);
    await f.relay.start();
    const outer = await openRelayTunnel(f.options());
    const inner = tlsConnect({
      socket: outer,
      rejectUnauthorized: true,
      ca: f.identity.certificate,
    });
    await assert.rejects(once(inner, 'secureConnect'));
    inner.destroy();
    const next = await openRelayTunnel(f.options());
    await f.relay.configure({ ...f.config, targets: [] });
    await closed(next);
    assert.equal(f.relay.status().running, false);
    await f.relay.start();
    await assert.rejects(openRelayTunnel(f.options()), /unauthorized/);
    await assert.rejects(openRelayTunnel({ ...f.options(), signal: AbortSignal.abort() }));
  } finally {
    await f.close();
  }
});


test('Account relay authorizes dynamic targets and keeps registration credentials separate from forwarding leases', async()=>{
 const f=await fixture();const registration='c'.repeat(64),lease='d'.repeat(64);let member=true;
 const relay=new AgentRelayService({vault:f.vault,identity:f.identity,authorize:async q=>member&&q.targetId==='owned'&&q.credential===(q.operation==='forward'?lease:registration)});
 const reverse=new AgentReverseRelayService({vault:f.vault});
 try{
  await relay.load();await relay.configure({...f.config,targets:[]});await relay.start();
  const options={...f.options(),targetId:'owned',credential:lease};
  await assert.rejects(openRelayTunnel({...options,targetId:'other-account'}),/unauthorized/);
  await assert.rejects(openRelayTunnel({...options,operation:'register'}),/unauthorized/);
  await reverse.load();const {signal,...endpoint}=options;
  await reverse.configure({enabled:true,relay:{...endpoint,credential:registration},localPort:f.targetPort});await reverse.start();await until(()=>reverse.status().connected);
  await assert.rejects(openRelayTunnel({...options,credential:registration}),/unauthorized/);
  const outer=await openRelayTunnel(options),inner=tlsConnect({socket:outer,rejectUnauthorized:false});inner.on('error',()=>{});await once(inner,'secureConnect');
  assert.equal(new X509Certificate(inner.getPeerCertificate().raw).fingerprint256,fingerprint(f.targetIdentity.certificate));
  const response=once(inner,'data');inner.write('account reverse tunnel');assert.equal((await response)[0].toString(),'account reverse tunnel');inner.destroy();
  member=false;await assert.rejects(openRelayTunnel(options),/unauthorized/);
 }finally{await reverse.stop();await relay.stop();await f.close();}
});
