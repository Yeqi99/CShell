import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AgentApplicationService, installArgs } from '../src/agent/applications';
import type { ClientVault } from '../src/core/client/identity';
import { appTaskSchema } from '../src/shared/agent-applications';

function fixture(owner = 'local', code = 'console.log("installed-fixture")') {
  const id = randomUUID();
  const task = appTaskSchema.parse({
    id,
    app: 'git',
    platform: process.platform,
    manager: 'fixture',
    executable: process.execPath,
    args: ['-e', code],
    expires: Date.now() + 60000,
    state: 'planned',
    logs: '',
    warning: 'fixture only',
  });
  const data = new Map<string, unknown>([['applications-tasks', [{ owner, task }]]]);
  const vault = {
    read: async (key: string) => structuredClone(data.get(key)),
    write: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
  } as unknown as ClientVault;
  let permitted = true;
  const service = new AgentApplicationService(vault, () => permitted);
  return {
    service,
    id,
    data,
    revoke: () => {
      permitted = false;
    },
  };
}
async function finished(service: AgentApplicationService, id: string, owner = 'local') {
  for (let n = 0; n < 100; n++) {
    const result = service.status({ id }, owner);
    if (result.state !== 'running') return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('fixture timed out');
}
test('recipes use exact package IDs without arbitrary commands or elevation', () => {
  assert.ok(installArgs('winget', 'git').includes('Git.Git'));
  assert.ok(installArgs('winget', 'git').includes('--no-upgrade'));
  assert.deepEqual(installArgs('brew', 'vscode'), ['install', '--cask', 'visual-studio-code']);
  assert.deepEqual(installArgs('apt-get', 'python'), ['install', '-y', 'python3']);
  assert.throws(() => installArgs('dnf', 'vscode'));
});
test('installation defaults closed and plans belong to a controller', async () => {
  const f = fixture();
  await f.service.load();
  await assert.rejects(f.service.install({ id: f.id, confirm: true }, 'local'), /未授权/);
  await f.service.configure({ enabled: true, controllers: ['a'.repeat(64)] });
  await assert.rejects(f.service.install({ id: f.id, confirm: true }, 'a'.repeat(64)), /NOT_FOUND/);
  await f.service.dispose();
});
test('confirmation, duplicate submission, bounded output and completion are real process behavior', async () => {
  const f = fixture('local', 'console.log("x".repeat(100000))');
  await f.service.load();
  await f.service.configure({ enabled: true });
  await assert.rejects(f.service.install({ id: f.id }, 'local'));
  await f.service.install({ id: f.id, confirm: true }, 'local');
  const second = await f.service.install({ id: f.id, confirm: true }, 'local');
  assert.equal(second.id, f.id);
  const result = await finished(f.service, f.id);
  assert.equal(result.state, 'completed');
  assert.equal(result.exitCode, 0);
  assert.ok(result.logs.length <= 32768);
  await f.service.dispose();
});
test('revoking a controller stops its running process and leaves an honest interrupted state', async () => {
  const owner = 'b'.repeat(64),
    f = fixture(owner, 'setInterval(()=>{},1000)');
  await f.service.load();
  await f.service.configure({ enabled: true, controllers: [owner] });
  await f.service.install({ id: f.id, confirm: true }, owner);
  f.revoke();
  await new Promise((r) => setTimeout(r, 1300));
  assert.throws(() => f.service.status({ id: f.id }, owner), /未授权/);
  await f.service.dispose();
  const saved = f.data.get('applications-tasks') as { task: { state: string } }[];
  assert.equal(saved[0].task.state, 'interrupted');
});
test('restart never retries an interrupted installation', async () => {
  const f = fixture();
  const saved = f.data.get('applications-tasks') as { task: { state: string } }[];
  saved[0].task.state = 'running';
  await f.service.load();
  await f.service.configure({ enabled: true });
  assert.equal(
    (await f.service.install({ id: f.id, confirm: true }, 'local')).state,
    'interrupted',
  );
  await f.service.dispose();
});
