import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodingService } from '../src/agent/coding';
import { ClientVault } from '../src/core/client/identity';
import { codingProfileSchema } from '../src/shared/coding';
const fake = `const readline=require('readline');if(process.argv.includes('--version')){console.log('test engine 1.0');process.exit(0);}const send=v=>console.log(JSON.stringify(v));if(process.argv.includes('app-server')){readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:'test-thread'}}});if(m.method==='turn/start'){send({id:m.id,result:{}});send({method:'item/agentMessage/delta',params:{delta:'hello '+(process.env.CSHELL_CODING_API_KEY||'official')}});send({id:81,method:'item/commandExecution/requestApproval',params:{command:'test command'}});}if(m.id===81){send({method:'turn/completed',params:{turn:{status:'completed'}}});}});}else{let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{send({type:'assistant',session_id:'claude-test',message:{content:[{type:'text',text:'reply '+s}]}});send({type:'result',is_error:false,result:'done'});});}`;
async function fixture() {
  const d = await mkdtemp(join(tmpdir(), 'coding-tests-')),
    exe = join(d, 'fake.cjs');
  await writeFile(exe, fake);
  const vault = new ClientVault(d, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  let allowed = true;
  const service = new CodingService(vault, d, () => allowed);
  await service.load();
  await service.call(
    'coding.configure',
    { directory: join(d, 'private'), codex: exe, claude: exe },
    'owner',
  );
  return { service, d, vault, revoke: () => (allowed = false) };
}
async function until(fn: () => Promise<any>, check: (v: any) => boolean) {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (check(v)) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error('timeout');
}
test('Codex structured session preserves owner, approval, profile binding, secret redaction and history', async () => {
  const f = await fixture(),
    id = randomUUID();
  try {
    await f.service.call(
      'coding.profile.save',
      {
        id,
        engine: 'codex',
        name: 'test',
        auth: 'api',
        endpoint: 'https://fixture.invalid/v1',
        model: 'test',
        key: 'fake-key-only',
      },
      'owner',
    );
    const status = await f.service.call('coding.status', {}, 'owner');
    assert.equal(status.engines[0].ready, true);
    assert.equal(status.profiles[0].hasKey, true);
    assert.ok(!JSON.stringify(status).includes('fake-key-only'));
    const started = await f.service.call(
      'coding.start',
      { profileId: id, cwd: f.d, prompt: 'test' },
      'owner',
    );
    let task = await until(
      () => f.service.call('coding.task', started, 'owner'),
      (t) => t.state === 'approval',
    );
    assert.ok(task.messages.at(-1).text.includes('[已隐藏密钥]'));
    await assert.rejects(f.service.call('coding.task', started, 'other'));
    await assert.rejects(
      f.service.call('coding.approve', { id: started.id, approvalId: '80', accept: true }, 'owner'),
    );
    await f.service.call(
      'coding.approve',
      { id: started.id, approvalId: task.approval.id, accept: true },
      'owner',
    );
    task = await until(
      () => f.service.call('coding.task', started, 'owner'),
      (t) => t.state === 'completed',
    );
    assert.equal(task.threadId, 'test-thread');
    await new Promise((r) => setTimeout(r, 100));
    const restored = new CodingService(f.vault, f.d, () => true);
    await restored.load();
    assert.equal((await restored.call('coding.task', started, 'owner')).threadId, 'test-thread');
    await restored.close();
  } finally {
    await f.service.close();
  }
});
test('Claude structured output completes and revoked permission denies task access', async () => {
  const f = await fixture(),
    id = randomUUID();
  try {
    await f.service.call(
      'coding.profile.save',
      { id, engine: 'claude', name: 'official', auth: 'official' },
      'owner',
    );
    const started = await f.service.call(
      'coding.start',
      { profileId: id, cwd: f.d, prompt: 'local fixture only' },
      'owner',
    );
    const task = await until(
      () => f.service.call('coding.task', started, 'owner'),
      (t) => t.state === 'completed',
    );
    assert.equal(task.threadId, 'claude-test');
    assert.ok(task.messages.some((m: any) => m.text.includes('local fixture only')));
    f.revoke();
    await assert.rejects(f.service.call('coding.tasks', {}, 'owner'));
  } finally {
    await f.service.close();
  }
});
test('model profiles reject credentials in endpoint and external plaintext HTTP', () => {
  const base = { id: randomUUID(), engine: 'codex', name: 'test', auth: 'api', model: 'x' };
  assert.equal(
    codingProfileSchema.safeParse({ ...base, endpoint: 'http://external.example' }).success,
    false,
  );
  assert.equal(
    codingProfileSchema.safeParse({ ...base, endpoint: 'https://user:pass@example.com' }).success,
    false,
  );
  assert.equal(
    codingProfileSchema.safeParse({ ...base, endpoint: 'http://127.0.0.1:1234/v1' }).success,
    true,
  );
});
