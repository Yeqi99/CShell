import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { ConnectionImport } from '../src/core/connection-import';
const codec = { encrypt: async (text: string) => Buffer.from(text).toString('base64'), decrypt: async (text: string) => Buffer.from(text, 'base64').toString() };

test('FTP, FTPS and SFTP import preserve protocol and encrypted secrets without connecting',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cshell-file-import-'));
 try{
  const store=new Store(directory,codec);await store.load();const service=new ConnectionImport(store);
  const preview=service.prepare('protocol,host,username,password\nsftp,one.example,user,secret-one\nftp,one.example,user,secret-two\nftps,one.example,user,secret-three','csv');
  assert.deepEqual(preview.rows.map(r=>r.protocol),['sftp','ftp','ftps']);assert.deepEqual(preview.rows.map(r=>r.port),[22,21,21]);
  assert.ok(!JSON.stringify(preview).includes('secret-'));
  const applied=await service.apply(preview.token,[2,3,4],'skip');assert.equal(applied.imported.length,3);
  const reloaded=new Store(directory,codec);await reloaded.load();assert.deepEqual(reloaded.snapshot().profiles.map(p=>p.protocol),['sftp','ftp','ftps']);
  const urls=service.prepare('sftp://user:p%40ss@one.example:2222\nftps://user:p%40ss@two.example:2121\nftp://user:p%40ss@three.example','text');
  assert.deepEqual(urls.rows.map(r=>r.port),[2222,2121,21]);assert.ok(!JSON.stringify(urls).includes('p@ss'));assert.ok(!JSON.stringify(urls).includes('p%40ss'));
  const result=await service.apply(urls.token,[1,2,3],'keep');assert.equal((await store.secret(result.imported[0]))?.password,'p@ss');
  const invalid=service.prepare('ftp://user:secret@host/path\nsftp://user:secret@host?command=bad','text');assert.ok(invalid.rows.every(r=>!!r.error));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('preview masks secrets; explicit append encrypts atomically, skips duplicates and preserves original credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-batch-'));
  try {
    const store = new Store(directory, codec); await store.load();
    const service = new ConnectionImport(store);
    const source = service.prepare('name,host,username,password\nA,one.example,root,sensitive-password\nB,two.example,user,other-secret', 'csv');
    assert.equal(store.snapshot().profiles.length, 0);
    assert.equal(JSON.stringify(source).includes('sensitive-password'), false);
    const result = await service.apply(source.token, [2,3], 'skip');
    assert.equal(result.imported.length, 2);
    assert.equal((await store.secret(result.imported[0]))?.password, 'sensitive-password');
    assert.equal((await readFile(join(directory, 'config.json'), 'utf8')).includes('sensitive-password'), false);
    await assert.rejects(service.apply(source.token, [2], 'keep'), /失效/);
    const duplicate = service.prepare('host,username,password\nONE.EXAMPLE.,root,replacement', 'csv');
    assert.equal(duplicate.rows[0].duplicate, true);
    assert.equal((await service.apply(duplicate.token, [2], 'skip')).skipped, 1);
    assert.equal((await store.secret(result.imported[0]))?.password, 'sensitive-password');
    const reloaded = new Store(directory, codec); await reloaded.load();
    assert.equal(reloaded.snapshot().profiles.length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('unknown columns require mapping; missing usernames explicit; expired and invalid selections never write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-batch-')); let now = 0;
  try {
    const store = new Store(directory, codec); const service = new ConnectionImport(store, () => now);
    const initial = service.prepare('Server,Secret\none.example,password', 'csv');
    assert.equal(initial.rows.length, 0);
    const missing = service.preview(initial.token, { mapping: { host: 0, password: 1 } });
    assert.match(missing.rows[0].error!, /用户名/);
    const mapped = service.preview(initial.token, { mapping: { host: 0, password: 1 }, username: 'deploy' });
    assert.equal(mapped.rows[0].username, 'deploy');
    await assert.rejects(service.apply(initial.token, [2,2], 'skip'), /选择/);
    now = 600001;
    await assert.rejects(service.apply(initial.token, [2], 'skip'), /失效/);
    assert.equal(store.snapshot().profiles.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('failed durable write does not publish imported profiles or secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-batch-'));
  try {
    const store = new Store(directory, codec); const service = new ConnectionImport(store);
    const preview = service.prepare('ssh root@one.example\nssh root@two.example', 'text');
    await mkdir(join(directory, 'config.json'));
    await assert.rejects(service.apply(preview.token, [1,2], 'keep'));
    assert.deepEqual(store.snapshot().profiles, []);
    assert.deepEqual(store.snapshot().savedCredentials, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
