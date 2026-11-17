import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AccountMemoryFile} from '../src/core/account-memory-file';

test('file edits, agent writes and legacy memory IDs round trip within one account',t=>{
  const root=mkdtempSync(join(tmpdir(),'cshell-memory-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const file=new AccountMemoryFile(join(root,'account-a'));
  const other=new AccountMemoryFile(join(root,'account-b'));
  const old=[{id:'9d4b473e-d56d-469a-8ef3-75dd9c3e3ccc',text:'Use Chinese',updatedAt:'2026-11-17T00:00:00.000Z'}];
  assert.deepEqual(file.read(old),old);
  file.write(old);
  assert.deepEqual(file.read(old),old);
  writeFileSync(file.path,'# 用户记忆\n\nIntro\n\n<!-- cshell-memory:'+old[0].id+' -->\nUse English\n');
  const changed=file.read(old);
  assert.equal(changed[1].id,old[0].id);
  assert.equal(changed[1].text,'Use English');
  assert.equal(changed[0].text,'Intro');
  file.write(changed);
  assert.deepEqual(file.read(changed),changed);
  assert.deepEqual(other.read([]),[]);
  writeFileSync(file.path,'');
  assert.deepEqual(file.read(changed),[]);
});
