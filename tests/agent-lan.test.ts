import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { NetworkInterfaceInfo } from 'node:os';
import { AgentLanDirectory, AgentLanService } from '../src/core/agent-lan';
import { agentLanAnnouncementSchema, lanRegistrationSchema, type AgentLanSource } from '../src/shared/agent-lan';
import { AgentLanEnrollment } from '../src/desktop/agent-lan-enrollment';
import { createIdentity, fingerprint } from '../src/core/client/identity';
const interfaces = () => ({ lan: [{ address: '192.168.42.1', netmask: '255.255.255.0', family: 'IPv4', internal: false } as NetworkInterfaceInfo] });
const announce = () => ({ protocol: 'cshell-agent-lan-1', deviceId: randomUUID(), name: '机房01', room: '机房', port: 24443, fingerprint: Array(32).fill('AB').join(':'), version: '0.8.10' });
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
test('LAN schema prohibits credential/grant fields and does not enable by default', () => {
  assert.equal(lanRegistrationSchema.parse({ name: '机房' }).enabled, false);
  for (const extra of [{ password: '123456' }, { privateKey: 'key' }, { permissions: ['all'] }, { host: '8.8.8.8' }]) assert.equal(agentLanAnnouncementSchema.safeParse({ ...announce(), ...extra }).success, false);
});
test('directory accepts actual same subnet only, is bounded/rate limited, expires and rejects identity mutation', () => {
  const directory = new AgentLanDirectory(interfaces), a = announce();
  assert.equal(directory.accept(bytes(a), '192.168.43.2', 1000), false);
  assert.equal(directory.accept(bytes(a), '192.168.42.2', 1000), true);
  assert.equal(directory.accept(bytes({ ...a, fingerprint: Array(32).fill('CD').join(':') }), '192.168.42.2', 1001), false);
  assert.equal(directory.accept(Buffer.alloc(1025), '192.168.42.2', 1001), false);
  for (let i = 0; i < 20; i++) directory.accept(bytes(announce()), '192.168.42.2', 1002);
  assert(directory.list(1002).length <= 8);assert.equal(directory.list(10003).length, 0);
  for (let i = 0; i < 150; i++) directory.accept(bytes(announce()), '192.168.42.' + (i + 2), 20000);
  assert.equal(directory.list(20000).length, 128);directory.clear();assert.equal(directory.list().length, 0);
});
test('service remains entirely off until explicit enable and does not advertise secrets', async () => {
  const service = new AgentLanService(interfaces);
  assert.deepEqual(service.status(), { enabled: false, advertising: false, sources: [], error: null });
  await service.setDiscovery(false);await service.setAdvertisement(null);assert.equal(service.status().advertising, false);await service.dispose();
});
test('batch identity preparation sends no password; confirmation pins certificate and is one-shot', async () => {
  const identity = await createIdentity();let pairs = 0, probes = 0;
  const source: AgentLanSource = { ...announce(), id: identity.id, deviceId: identity.id, address: '192.168.42.2', fingerprint: fingerprint(identity.certificate), lastSeen: Date.now() };
  const info = { protocol: 1 as const, deviceId: identity.id, name: '机房01', host: source.address, port: source.port, certificate: identity.certificate };
  const service = new AgentLanEnrollment({ sources: () => [source], enabled: () => true, probe: async () => { probes++;return info; },
    pair: async (actual, password) => { assert.equal(actual.certificate, identity.certificate);assert.equal(password, '123456');pairs++;return { protocol: 1, deviceId: identity.id, name: '机房01', host: source.address, port: source.port, fingerprint: source.fingerprint }; } });
  const prepared = await service.prepare([source.id]);assert.equal(probes, 1);assert.equal(pairs, 0);
  await assert.rejects(service.confirm({ token: prepared.token, confirmed: true, fingerprints: [], password: '123456' }), /确认列表/);assert.equal(pairs, 0);
  const request = { token: prepared.token, confirmed: true as const, fingerprints: [{ id: source.id, fingerprint: source.fingerprint }], password: '123456' };
  assert.equal((await service.confirm(request)).devices.length, 1);assert.equal(pairs, 1);
  await assert.rejects(service.confirm(request), /过期/);assert.equal(pairs, 1);
});
test('spoofed announcement, offline source and disabled extension never receive shared password', async () => {
  const identity = await createIdentity();let enabled = true, pairs = 0;
  let sources: AgentLanSource[] = [{ ...announce(), id: identity.id, deviceId: identity.id, address: '192.168.42.2', lastSeen: Date.now() }];
  const service = new AgentLanEnrollment({ sources: () => sources, enabled: () => enabled,
    probe: async () => ({ protocol: 1, deviceId: identity.id, name: 'machine', host: sources[0].address, port: sources[0].port, certificate: identity.certificate }),
    pair: async () => { pairs++;throw Error('Must not pair'); } });
  const rejected = await service.prepare([identity.id]);assert.equal(rejected.candidates.length, 0);assert.equal(rejected.failures.length, 1);
  sources[0].fingerprint = fingerprint(identity.certificate);
  const ready = await service.prepare([identity.id]);sources = [];
  const result = await service.confirm({ token: ready.token, confirmed: true, fingerprints: ready.candidates.map(s => ({ id: s.id, fingerprint: s.fingerprint })), password: '123456' });
  assert.equal(result.devices.length, 0);assert.equal(result.failures.length, 1);assert.equal(pairs, 0);
  enabled = false;await assert.rejects(service.prepare([identity.id]), /启用/);service.clear();
});
