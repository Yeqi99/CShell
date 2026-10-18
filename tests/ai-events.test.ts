import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AiEventService, type AiEventHost } from '../src/core/ai-events';
import { aiEventRuleSchema, type AiPluginEvent } from '../src/shared/ai-events';

const codec = { encrypt: async (s: string) => Buffer.from(s).toString('base64'), decrypt: async (s: string) => Buffer.from(s, 'base64').toString() };
const now = 1800000000000;
const rule = (changes = {}) => aiEventRuleSchema.parse({ id: randomUUID(), name: 'test', source: 'wechat', eventType: 'message', threadId: randomUUID(), prompt: 'Answer briefly', enabled: true, cooldownSeconds: 0, ...changes });
const event = (id = randomUUID(), changes = {}): AiPluginEvent => ({ id, source: 'wechat', type: 'message', accountId: 'account', senderId: 'friend', conversationId: 'friend', isSelf: false, isGroup: false, occurredAt: now, payload: { text: 'hello' }, ...changes });
const settle = async (predicate: () => boolean) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.ok(predicate(), 'condition did not settle'); };
async function setup(execute: AiEventHost['execute'] = async () => {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-events-')); const path = join(dir, 'state');
  let authorized = true;
  const host: AiEventHost = { sources: () => [{ id: 'wechat', name: 'WeChat', available: true, eventTypes: [{ id: 'message', name: 'Message' }] }], authorize: () => authorized, execute };
  const service = new AiEventService({ path, codec, host, now: () => now }); await service.init();
  return { service, path, host, revoke: () => { authorized = false; }, cleanup: async () => { await service.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('strict configuration defaults to disabled and self events never trigger by default', async () => {
  assert.equal(rule({ enabled: undefined }).enabled, false);
  assert.throws(() => rule({ grantAll: true }));
  const fixture = await setup();
  try { await fixture.service.save(rule()); assert.equal((await fixture.service.ingest(event(undefined, { isSelf: true }))).accepted, 0); assert.equal(fixture.service.runs().length, 0); }
  finally { await fixture.cleanup(); }
});

test('same-thread runs serialize while independent threads run concurrently; duplicate ingestion once', async () => {
  const started: string[] = []; const releases: (() => void)[] = [];
  const fixture = await setup(async ({ rule }) => { started.push(rule.threadId); await new Promise<void>(resolve => releases.push(resolve)); });
  try {
    const a = rule(), b = rule(); await fixture.service.save(a); await fixture.service.save(b);
    const e = event(); const results = await Promise.all([fixture.service.ingest(e), fixture.service.ingest(e)]);
    assert.equal(results.reduce((n, r) => n + r.accepted, 0), 2);
    await settle(() => started.length === 2); assert.equal(new Set(started).size, 2);
    await fixture.service.ingest(event()); await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(started.length, 2);
    releases.splice(0).forEach(release => release()); await settle(() => started.length === 4);
    releases.splice(0).forEach(release => release()); await settle(() => fixture.service.runs().every(run => run.status === 'completed'));
  } finally { releases.forEach(release => release()); await fixture.cleanup(); }
});

test('revocation aborts active and cancels queued work without executing it', async () => {
  let calls = 0;
  const fixture = await setup(async ({ signal }) => { calls++; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); });
  try {
    await fixture.service.save(rule()); await fixture.service.ingest(event()); await settle(() => calls === 1);
    await fixture.service.ingest(event()); fixture.revoke(); await fixture.service.revalidate();
    await settle(() => fixture.service.runs().every(run => run.status === 'cancelled'));
    assert.equal(calls, 1);
  } finally { await fixture.cleanup(); }
});

test('hourly/day and token reservations stop calls, failed/unknown outcomes consume budget', async () => {
  let calls = 0; const fixture = await setup(async () => { calls++; throw new Error('unknown remote result'); });
  try {
    await fixture.service.save(rule({ maxRunsPerHour: 3, reservedTokensPerRun: 4096, maxReservedTokensPerDay: 4096 }));
    await fixture.service.ingest(event()); await settle(() => calls === 1 && fixture.service.runs()[0].status === 'failed');
    assert.equal((await fixture.service.ingest(event())).accepted, 0); assert.match(fixture.service.runs()[0].reason!, /token/);
    assert.equal(calls, 1);
  } finally { await fixture.cleanup(); }
});

test('hourly hard cap persists across restart and disabled subscription cannot execute', async () => {
  let calls = 0; const fixture = await setup(async () => { calls++; });
  try {
    const limited = rule({ maxRunsPerHour: 1 }); await fixture.service.save(limited);
    await fixture.service.ingest(event()); await settle(() => fixture.service.runs()[0].status === 'completed');
    await fixture.service.close();
    const restored = new AiEventService({ path: fixture.path, codec, host: fixture.host, now: () => now }); await restored.init();
    assert.equal((await restored.ingest(event())).accepted, 0); assert.match(restored.runs()[0].reason!, /运行次数/);
    await restored.save({ ...limited, enabled: false }); assert.equal((await restored.ingest(event())).accepted, 0);
    assert.equal(calls, 1); await restored.close();
  } finally { await fixture.cleanup(); }
});

test('durable reservation precedes execute; restart marks in-flight unknown and will not replay', async () => {
  let persistedStatus = ''; const fixture = await setup();
  fixture.host.execute = async () => { const raw = JSON.parse(await codec.decrypt(await readFile(fixture.path, 'utf8'))); persistedStatus = raw.runs[0].status; };
  const e = event();
  try {
    await fixture.service.save(rule()); await fixture.service.ingest(e); await settle(() => fixture.service.runs()[0]?.status === 'completed'); assert.equal(persistedStatus, 'running');
    await fixture.service.close();
    const raw = JSON.parse(await codec.decrypt(await readFile(fixture.path, 'utf8'))); raw.runs[0].status = 'running'; await writeFile(fixture.path, await codec.encrypt(JSON.stringify(raw)));
    const restored = new AiEventService({ path: fixture.path, codec, host: fixture.host, now: () => now }); await restored.init();
    assert.equal(restored.runs()[0].status, 'unknown'); assert.equal((await restored.ingest(e)).duplicate, true); await restored.close();
    assert.ok(!(await readFile(fixture.path, 'utf8')).includes('Answer briefly'));
    assert.ok(!JSON.stringify(raw).includes('hello'));
  } finally { await fixture.cleanup(); }
});

test('bounded queue rejects overload and account-scoped IDs do not collide', async () => {
  let release: () => void = () => {}; const fixture = await setup(async () => new Promise<void>(resolve => { release = resolve; }));
  try {
    const first = rule({ maxRunsPerHour: 60, maxRunsPerDay: 200, reservedTokensPerRun: 1024, maxReservedTokensPerDay: 1000000 });
    await fixture.service.save(first);
    const id = randomUUID(); assert.equal((await fixture.service.ingest(event(id))).accepted, 1);
    assert.equal((await fixture.service.ingest(event(id, { accountId: 'other' }))).accepted, 1);
    await fixture.service.save(rule({ ...first, id: randomUUID() }));
    for (let i = 0; i < 70; i++) await fixture.service.ingest(event());
    assert.equal(fixture.service.runs().filter(run => run.reservedTokens > 0).length, 65);
    assert.ok(fixture.service.runs().some(run => run.reason === '事件队列已满'));
    await assert.rejects(fixture.service.ingest(event(undefined, { occurredAt: now - 8 * 86400000 })), /window/);
  } finally { await fixture.service.close(); release(); await new Promise(resolve => setTimeout(resolve, 30)); await fixture.cleanup(); }
});
