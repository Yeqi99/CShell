import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedWechatValidation } from '../src/agent/managed-wechat-validation';

async function waitFile(path: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { return await readFile(path, 'utf8'); } catch { await new Promise(r => setTimeout(r, 20)); }
  }
  throw Error('Self-terminating fixture did not finish');
}
for (const mode of ['timeout', 'overflow'] as const) test(`validation ${mode} preserves child and permanently rejects replay`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-validation-child-'));
  const done = join(dir, 'done'), alive = join(dir, 'alive'), starts = join(dir, 'starts');
  const runner = new ManagedWechatValidation();
  const script = `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(starts)},'1');${mode === 'overflow' ? "process.stdout.write('x'.repeat(4096));" : ''}setTimeout(()=>fs.writeFileSync(${JSON.stringify(alive)},String(process.pid)),250);setTimeout(()=>{fs.writeFileSync(${JSON.stringify(done)},'normal exit');process.exit(0)},500);`;
  try {
    await assert.rejects(runner.run(process.execPath, ['-e', script], { waitMs: mode === 'timeout' ? 80 : 3000, outputBytes: 32 }), /VALIDATION_UNKNOWN/);
    assert.equal(runner.unknown, true);
    await assert.rejects(runner.run(process.execPath, ['-e', script]), /VALIDATION_UNKNOWN/);
    assert.match(await waitFile(alive), /^\d+$/);
    assert.equal(await waitFile(done), 'normal exit');
    await new Promise(r => setTimeout(r, 80));
    await assert.rejects(runner.run(process.execPath, ['-e', script]), /VALIDATION_UNKNOWN/);
    assert.equal(await readFile(starts, 'utf8'), '1');
  } finally { await waitFile(done); await rm(dir, { recursive: true, force: true }); }
});
test('validation accepts clean bounded result, but retained cleanup poisons instance', async () => {
  const clean = new ManagedWechatValidation();
  const result = { validated: true, cleanup: { unloaded: true, codeRestored: true, retained: false, errors: [] } };
  assert.deepEqual(await clean.run(process.execPath, ['-e', `console.log(${JSON.stringify(JSON.stringify(result))})`]), result);
  assert.equal(clean.unknown, false);
  const unsafe = new ManagedWechatValidation();
  await assert.rejects(unsafe.run(process.execPath, ['-e', 'console.log(JSON.stringify({cleanup:{retained:true}}))']), /VALIDATION_UNKNOWN/);
  assert.equal(unsafe.unknown, true);
});

for (const result of [null, [], {}, {validated: 'true'}, {validated:true}, {validated:true,cleanup:{unloaded:true,codeRestored:true}}]) test(`malformed validation result is unknown: ${JSON.stringify(result)}`, async () => {
 const runner = new ManagedWechatValidation();
 await assert.rejects(runner.run(process.execPath, ['-e', `console.log(${JSON.stringify(JSON.stringify(result))})`]), /VALIDATION_UNKNOWN/);
 assert.equal(runner.unknown,true);
});
test('explicit unvalidated outcome does not claim success or poison', async () => {
 const runner = new ManagedWechatValidation();
 assert.deepEqual(await runner.run(process.execPath,['-e','console.log(JSON.stringify({validated:false,reason:"profile_quarantined"}))']), {validated:false,reason:'profile_quarantined'});
 assert.equal(runner.unknown,false);
});
