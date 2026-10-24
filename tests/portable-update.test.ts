import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareAppImageUpdate } from '../src/desktop/portable-update';

test('AppImage update stages without changing the running application, commits with backup', async () => {
 const root=await mkdtemp(join(tmpdir(),'cshell-update-test-'));
 try {
  const target=join(root,'CShell.AppImage'),source=join(root,'download');
  await writeFile(target,'old');await writeFile(source,'new');
  const plan=await prepareAppImageUpdate(source,target);
  assert.equal(await readFile(target,'utf8'),'old');
  const backup=plan.commit();
  assert.equal(await readFile(target,'utf8'),'new');assert.equal(await readFile(backup,'utf8'),'old');
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('cancelled update leaves the original intact and removes staging', async () => {
 const root=await mkdtemp(join(tmpdir(),'cshell-update-cancel-'));
 try {
  const target=join(root,'CShell.AppImage'),source=join(root,'download');
  await writeFile(target,'old');await writeFile(source,'new');
  const plan=await prepareAppImageUpdate(source,target);await plan.cancel();
  assert.equal(await readFile(target,'utf8'),'old');assert.equal((await readdir(root)).length,2);
  assert.throws(()=>plan.commit());assert.equal(await readFile(target,'utf8'),'old');
  await assert.rejects(prepareAppImageUpdate(source,''));
 } finally { await rm(root,{recursive:true,force:true}); }
});
