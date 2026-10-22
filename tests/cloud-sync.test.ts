import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptVault, decryptVault, newRecoveryKey, unwrapRecoveryKey } from '../src/core/cloud-crypto';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { CloudSync } from '../src/core/cloud-sync';

test('password unlock authenticates the wrapped recovery key and account', () => {
  const salt=randomBytes(32), password='test-password-only', key=newRecoveryKey();
  const derived=pbkdf2Sync(password,salt,210000,32,'sha256').toString('base64url');
  const box={salt:salt.toString('base64'),envelope:encryptVault({key},derived,'test-account')};
  assert.equal(unwrapRecoveryKey(box,password,'test-account'),key);
  assert.throws(()=>unwrapRecoveryKey(box,'wrong-password','test-account'));
  assert.throws(()=>unwrapRecoveryKey(box,password,'another-account'));
});

test('vault binds ciphertext to account, detects tampering and uses unique nonces', () => {
  const key = newRecoveryKey(),
    data = { password: 'secret', providers: [{ key: 'api-secret' }] };
  const a = encryptVault(data, key, 'a'),
    b = encryptVault(data, key, 'a');
  assert.notEqual(a.nonce, b.nonce);
  assert.deepEqual(decryptVault(a, key, 'a'), data);
  assert.throws(() => decryptVault(a, key, 'b'));
  assert.throws(() => decryptVault(a, newRecoveryKey(), 'a'));
  const changed = Buffer.from(a.ciphertext, 'base64');
  changed[0] ^= 1;
  assert.throws(() => decryptVault({ ...a, ciphertext: changed.toString('base64') }, key, 'a'));
  assert(!JSON.stringify(a).includes('api-secret'));
});

test('two devices restore, detect concurrent edits, preserve encrypted backup and retry lost response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-cloud-'));
  let remote: any = { revision: 0, envelope: null },
    last: any,
    drop = false;
  const accountId = 'a'.repeat(32);
  const request: typeof fetch = async (url, options) => {
    const path = String(url).split('/api')[1],
      body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (path === '/v1/auth/login')
      return Response.json({ accountId, email: 'test@example.com', token: 't'.repeat(43) });
    if (path === '/v1/vault' && !body) return Response.json(remote);
    if (path === '/v1/vault') {
      if (last?.mutationId === body.mutationId) return Response.json({ revision: remote.revision });
      if (body.baseRevision !== remote.revision)
        return Response.json({ error: 'conflict' }, { status: 409 });
      remote = { revision: remote.revision + 1, envelope: body.envelope };
      last = body;
      if (drop) {
        drop = false;
        throw new Error('lost response');
      }
      return Response.json({ revision: remote.revision });
    }
    return Response.json({ ok: true });
  };
  const localKey = newRecoveryKey();
  const codec = {
    encrypt: async (s: string) => JSON.stringify(encryptVault(s, localKey, 'local')),
    decrypt: async (s: string) => decryptVault(JSON.parse(s), localKey, 'local') as string,
  };
  let a = { value: 'first' },
    b = { value: 'empty' };
  const make = (name: string, get: () => any, set: (v: any) => void) =>
    new CloudSync(
      join(directory, name),
      codec,
      {
        export: async () => structuredClone(get()),
        validate: (v) => assert.equal(typeof (v as any).value, 'string'),
        import: async (v) => set(v),
      },
      'https://test.invalid/api',
      request,
    );
  try {
    let x = make(
      'a',
      () => a,
      (v) => (a = v),
    );
    const y = make(
      'b',
      () => b,
      (v) => (b = v),
    );
    await x.login('test@example.com', '123456');
    const { recoveryKey } = await x.createVault();
    await x.sync();
    assert.equal(remote.revision, 1);
    await y.login('test@example.com', '123456');
    await y.unlock(recoveryKey);
    await assert.rejects(y.sync());
    assert.equal(y.status().state, 'conflict');
    assert.equal(b.value, 'empty');
    await y.sync('download');
    assert.equal(b.value, 'first');
    a = { value: 'a edit' };
    b = { value: 'b edit' };
    await x.sync();
    await assert.rejects(y.sync());
    assert.equal(b.value, 'b edit');
    await y.sync('upload');
    assert.equal((decryptVault(remote.envelope, recoveryKey, accountId) as any).value, 'b edit');
    await x.sync('download');
    a = { value: 'uncertain' };
    drop = true;
    await assert.rejects(x.sync());
    const revision = remote.revision;
    assert.equal(x.status().state, "error");
    await x.autoSync();
    assert.equal(x.status().state, "ready");
    assert.equal(remote.revision, revision);
    x = make(
      'a',
      () => a,
      (v) => (a = v),
    );
    await x.load();
    await x.sync();
    assert.equal(remote.revision, revision);
    assert(!String(await readFile(join(directory, 'a', 'cloud-sync.enc'))).includes(recoveryKey));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('registration initializes encrypted cloud and password login restores on a new device',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cshell-signup-'));let registration:any;let restored:any;
 const request:typeof fetch=async(url,options)=>{const path=String(url).split('/api')[1];if(path==='/v1/auth/register'){registration=JSON.parse(String(options!.body));return Response.json({accountId:registration.accountId,email:registration.email,token:'x'.repeat(43)});}if(path==='/v1/auth/password-login')return Response.json({accountId:registration.accountId,email:registration.email,token:'y'.repeat(43),keybox:registration.keybox});if(path==='/v1/vault')return Response.json({revision:1,envelope:registration.envelope});return Response.json({ok:true});};
 const codec={encrypt:async(s:string)=>s,decrypt:async(s:string)=>s};const snapshot={connections:[{host:'fixture.internal'}],model:{key:'private-fixture-key'}};
 try{const first=new CloudSync(join(dir,'a'),codec,{export:async()=>snapshot,validate:()=>{},import:async()=>{}},'https://test.invalid/api',request);await first.register('fixture@example.com','123456','fixture-password');assert.equal(first.status().state,'ready');assert(!JSON.stringify(registration.envelope).includes('private-fixture-key'));
 const second=new CloudSync(join(dir,'b'),codec,{export:async()=>({}),validate:()=>{},import:async(v)=>{restored=v;}},'https://test.invalid/api',request);await second.login('fixture@example.com','fixture-password',true);assert.deepEqual(restored,snapshot);assert.equal(second.status().state,'ready');}finally{await rm(dir,{recursive:true,force:true});}
});
