import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IPty } from 'node-pty';
import { ClientVault } from '../src/core/client/identity';
import { agentCodec } from '../src/agent/storage';
import { ManagedEnvironment, ManagedScripts } from '../src/agent/managed-classroom';
import { AgentTerminalProvider } from '../src/core/agent-terminal';
import { CagentAssistant } from '../src/agent/assistant';
import type { requestAiReply } from '../src/core/ai-request';

function memoryVault() {
  const data = new Map<string, unknown>();
  const vault = { read: async (key: string) => structuredClone(data.get(key)), write: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } } as unknown as ClientVault;
  return { vault, data };
}
const host = { shells: async () => [], applications: async () => [], execute: async () => ({}), allowed: () => true };
const model = { endpoint: 'https://example.invalid/v1/chat/completions', model: 'fixture', key: 'fixture-key' };
async function until(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Timed out'); }

test('managed environment is encrypted, reloadable and changes only future PTYs without changing process.env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-environment-'));
  const before = { ...process.env }, launches: Record<string, string>[] = [];
  const provider = new AgentTerminalProvider(() => {}, async () => [{ id: 'sh', label: 'Fixture', executable: '/bin/sh', args: [], environment: 'host' }], ((_exe: string, _args: unknown, options: {env: Record<string, string>}) => {
    launches.push({ ...options.env });
    let exit: (event: {exitCode: number}) => void = () => {};
    return { onData: () => ({ dispose() {} }), onExit: (fn: typeof exit) => { exit = fn; return { dispose() {} }; }, write() {}, resize() {}, pause() {}, resume() {}, kill() { exit({ exitCode: 0 }); } } as unknown as IPty;
  }) as typeof import('node-pty').spawn);
  try {
    const vault = new ClientVault(root, await agentCodec(root));
    const environment = new ManagedEnvironment(vault, values => provider.setManagedEnvironment(values));
    await environment.load();
    const first = await provider.connect('sh', undefined, new AbortController().signal);
    await environment.save({ variables: { CLASSROOM_TEST_TOKEN: 'encrypted-secret-fixture', PATH: 'managed-fixture-path' } });
    assert.equal(provider.size, 1);
    assert.ok(provider.resolve(first).terminal);
    await provider.connect('sh', undefined, new AbortController().signal);
    assert.equal(launches[0].CLASSROOM_TEST_TOKEN, undefined);
    assert.equal(launches[1].CLASSROOM_TEST_TOKEN, 'encrypted-secret-fixture');
    if (process.platform === 'win32') assert.deepEqual(Object.keys(launches[1]).filter(key => key.toLowerCase() === 'path'), ['PATH']);
    assert.equal(launches[1].PATH, 'managed-fixture-path');
    assert.deepEqual({ ...process.env }, before);
    assert.ok(!(await readFile(join(root, 'managed-environment.enc'), 'utf8')).includes('encrypted-secret-fixture'));
    let restored: Record<string, string> = {};
    const reload = new ManagedEnvironment(vault, values => { restored = values; });
    await reload.load();
    assert.equal(restored.CLASSROOM_TEST_TOKEN, 'encrypted-secret-fixture');
    assert.ok(!JSON.stringify(reload.snapshot()).includes('encrypted-secret-fixture'));
    await reload.save({ variables: { CLASSROOM_TEST_TOKEN: null } });
    assert.equal(restored.CLASSROOM_TEST_TOKEN, undefined);
    await assert.rejects(reload.save({ variables: { NODE_OPTIONS: '--require malicious' } }));
    await assert.rejects(reload.save({ variables: { CSHELL_AGENT_CONTROL_TOKEN: 'not-allowed' } }));
  } finally { await provider.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('managed environment is inherited by a real new process without mutating the parent', async () => {
  const shell = process.platform === 'win32' ? 'powershell' : 'sh';
  const exe = process.platform === 'win32' ? join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/sh';
  const provider = new AgentTerminalProvider(() => {}, async () => [{ id: shell, label: shell, executable: exe, args: [], environment: 'host' }]);
  const previous = process.env.CLASSROOM_REAL_CHILD;
  provider.setManagedEnvironment({ CLASSROOM_REAL_CHILD: 'child-only-value' });
  try {
    const result = await provider.execute({ shell, command: process.platform === 'win32' ? '[Console]::Write($env:CLASSROOM_REAL_CHILD)' : 'printf %s "$CLASSROOM_REAL_CHILD"', timeoutMs: 15000 }, new AbortController().signal);
    assert.equal(result.stdout, 'child-only-value'); assert.equal(result.exitCode, 0);
    assert.equal(process.env.CLASSROOM_REAL_CHILD, previous);
  } finally { await provider.dispose(); }
});

test('managed scripts isolate owners, report nonzero exit and do not replay cancelled jobs', async () => {
  let executions = 0;
  const scripts = new ManagedScripts(() => true, async (_input, signal, output) => {
    executions++; output('started');
    await new Promise<void>((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    return { exitCode: 0 };
  });
  try {
    const job = await scripts.start('owner-a', { shell: 'sh', command: 'fixture' });
    await assert.rejects(scripts.query('owner-b', { id: job.id }), /不属于/);
    await assert.rejects(scripts.query('owner-b', { id: job.id }, true), /不属于/);
    const result = await scripts.query('owner-a', { id: job.id, waitMs: 1000 }, true);
    assert.equal(result.state, 'cancelled');
    await scripts.query('owner-a', { id: job.id }, true);
    assert.equal(executions, 1);
  } finally { await scripts.close(); }
  await assert.rejects(scripts.start('owner-a', { shell: 'sh', command: 'not replayed' }));
  assert.equal(executions, 1);
  const failure = new ManagedScripts(() => true, async () => ({ exitCode: 7 }));
  try { const job = await failure.start('a', { shell: 'sh', command: 'exit 7' }); const result = await failure.query('a', { id: job.id, waitMs: 1000 }); assert.equal(result.state, 'failed'); assert.match(result.output, /7/); }
  finally { await failure.close(); }
});

test('revocation aborts an already running managed script', async () => {
  let allowed = true, aborted = false;
  const scripts = new ManagedScripts(() => allowed, async (_input, signal) => {
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
    return { exitCode: 0 };
  });
  try { await scripts.start('a', { shell: 'sh', command: 'fixture' }); allowed = false; await until(() => aborted && scripts.activity === 0); assert.throws(() => scripts.query('a', { id: randomUUID() }), /未授权/); }
  finally { await scripts.close(); }
});

test('model-only configuration preserves permissions/history, rejects busy changes, and never exposes key', async () => {
  const { vault } = memoryVault();
  let wait = false;
  const request = (async (_url, _init, signal) => { if (wait) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); return { content: 'done' }; }) as typeof requestAiReply;
  const assistant = new CagentAssistant(vault, host, request);
  try {
    await assistant.load(); await assistant.configure({ ...model, commands: false, review: true, delegates: [] });
    const completed = await assistant.start({ prompt: 'fixture', requestId: randomUUID() }, 'local');
    await until(() => assistant.activity === 0);
    const next = await assistant.configureModel({ ...model, model: 'new-model', key: 'new-secret' });
    assert.equal(next.commands, false); assert.equal(next.review, true); assert.deepEqual(next.delegates, []);
    assert.ok(!JSON.stringify(next).includes('new-secret')); assert.equal(assistant.list('local')[0].id, completed.id);
    await assert.rejects(assistant.configureModel({ ...model, commands: true }));
    wait = true; await assistant.start({ prompt: 'busy', requestId: randomUUID() }, 'local');
    await assert.rejects(assistant.configureModel(model), /执行任务/);
  } finally { await assistant.close(); }
});

test('pending model write locks task start and releases lock after failed writes', async () => {
  const { vault } = memoryVault();
  const original = vault.write.bind(vault);
  let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const assistant = new CagentAssistant(vault, host, (async () => ({ content: 'done' })) as typeof requestAiReply);
  await assistant.load(); await assistant.configure({ ...model, commands: false, review: true, delegates: [] });
  vault.write = async (key, value) => { if (key === 'assistant-settings') { entered(); await blocked; throw Error('disk failed'); } await original(key, value); };
  const update = assistant.configureModel(model);
  try {
    await enteredPromise;
    await assert.rejects(assistant.start({ prompt: 'must wait', requestId: randomUUID() }, 'local'), /配置正在更新/);
    await assert.rejects(assistant.configureModel(model), /配置正在更新/);
    release(); await assert.rejects(update, /disk failed/);
    vault.write = original;
    await assistant.configureModel(model);
    await assistant.start({ prompt: 'works after failure', requestId: randomUUID() }, 'local');
    await until(() => assistant.activity === 0);
  } finally { release(); await assistant.close(); }
});
