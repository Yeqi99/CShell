import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
const { Server } = ssh2;
import { Store } from '../src/core/store';
import { ConnectionManagement, probeSshHost } from '../src/core/api/connection-management';
const codec = {
  encrypt: async (s: string) => Buffer.from(s).toString('base64'),
  decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
};
const profile = {
  name: 'test',
  host: 'example.com',
  port: 22,
  username: 'u',
  group: 'g',
  favorite: false,
  auth: 'password' as const,
};
async function fixture(
  run: (s: Store, m: ConnectionManagement, c: any) => Promise<void>,
  custom = codec,
) {
  const dir = await mkdtemp(join(tmpdir(), 'connection-management-'));
  try {
    const s = new Store(dir, custom);
    await s.load();
    const m = new ConnectionManagement(s, () => 'account');
    await run(s, m, { owner: 'mcp', accountKey: 'account', authorize: () => {} });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test('create/change credential atomic; metadata edits preserve secret; endpoint edits clear it; no grants', async () =>
  fixture(async (s, m, c) => {
    const r: any = await m.call(
      { action: 'create', profile, secret: { password: 'test-secret' } },
      c,
    );
    assert(!JSON.stringify(r).includes('test-secret'));
    assert.equal(r.credentialConfigured, true);
    const p: any = await m.call(
      {
        action: 'update',
        id: r.profile.id,
        revision: r.revision,
        patch: { name: 'renamed', group: 'other' },
      },
      c,
    );
    assert.equal((await s.secret(p.profile.id))?.password, 'test-secret');
    await assert.rejects(
      m.call(
        {
          action: 'credentials',
          id: p.profile.id,
          revision: r.revision,
          secret: { password: 'bad' },
        },
        c,
      ),
      /CONNECTION_CHANGED/,
    );
    const n: any = await m.call(
      {
        action: 'credentials',
        id: p.profile.id,
        revision: p.revision,
        secret: { password: 'new-secret' },
      },
      c,
    );
    assert.equal((await s.secret(p.profile.id))?.password, 'new-secret');
    await m.call(
      {
        action: 'update',
        id: p.profile.id,
        revision: n.revision,
        patch: { host: 'other.example' },
      },
      c,
    );
    assert.equal(await s.secret(p.profile.id), undefined);
    assert.deepEqual(s.mcpSettings().allowedProfiles, []);
  }));
test('encryption failure and post-encryption permission revocation leave no partial profile', async () => {
  await fixture(
    async (s, m, c) => {
      await assert.rejects(
        m.call({ action: 'create', profile, secret: { password: 'x' } }, c),
        /ENCRYPT_FAILED/,
      );
      assert.equal(s.snapshot().profiles.length, 0);
    },
    {
      ...codec,
      encrypt: async () => {
        throw new Error('ENCRYPT_FAILED');
      },
    },
  );
  let allowed = true;
  await fixture(
    async (s, m, c) => {
      c.authorize = () => {
        if (!allowed) throw new Error('REVOKED');
      };
      await assert.rejects(
        m.call({ action: 'create', profile, secret: { password: 'x' } }, c),
        /REVOKED/,
      );
      assert.equal(s.snapshot().profiles.length, 0);
    },
    {
      ...codec,
      encrypt: async (s) => {
        allowed = false;
        return codec.encrypt(s);
      },
    },
  );
});
test('challenge is owner/account/revision bound and explicit acceptance is single use', async () =>
  fixture(async (s, _m, c) => {
    const fingerprint = 'SHA256:' + 'a'.repeat(43);
    const m = new ConnectionManagement(
      s,
      () => 'account',
      async () => fingerprint,
    );
    const r: any = await m.call({ action: 'create', profile }, c);
    const p: any = await m.call({ action: 'probe', id: r.profile.id }, c);
    assert.equal(s.host('example.com:22'), undefined);
    await assert.rejects(
      m.call({ action: 'accept', challenge: p.challenge, fingerprint }, { ...c, owner: 'other' }),
      /HOST_CHALLENGE_INVALID/,
    );
    const q: any = await m.call({ action: 'probe', id: r.profile.id }, c);
    await m.call({ action: 'accept', challenge: q.challenge, fingerprint }, c);
    assert.equal(s.host('example.com:22'), fingerprint);
    await assert.rejects(
      m.call({ action: 'accept', challenge: q.challenge, fingerprint }, c),
      /HOST_CHALLENGE_INVALID/,
    );
    const t: any = await m.call({ action: 'probe', id: r.profile.id }, c);
    await s.saveProfile({ ...s.profile(r.profile.id), host: 'changed.example' });
    await assert.rejects(
      m.call({ action: 'accept', challenge: t.challenge, fingerprint }, c),
      /CONNECTION_CHANGED/,
    );
    await assert.rejects(
      m.call({ action: 'list' }, { ...c, accountKey: 'old' }),
      /ACCOUNT_CHANGED/,
    );
  }));
test('real SSH host probe never reaches authentication; reports real key fingerprint', async () => {
  const key = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }).privateKey;
  let authentications = 0;
  const server = new Server({ hostKeys: [key] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      authentications++;
      ctx.reject();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const address = server.address() as { port: number };
    const result = await probeSshHost({
      ...profile,
      id: crypto.randomUUID(),
      host: '127.0.0.1',
      port: address.port,
    });
    assert.match(result, /^SHA256:[A-Za-z0-9+/]{43}$/);
    assert.equal(authentications, 0);
  } finally {
    server.close();
  }
});

test('concurrent same-revision writes cannot overwrite winner and durable state matches', async () =>
  fixture(async (s, m, c) => {
    const created: any = await m.call(
      { action: 'create', profile, secret: { password: 'initial' } },
      c,
    );
    const results = await Promise.allSettled(
      ['one', 'two'].map((name) =>
        m.call(
          { action: 'update', id: created.profile.id, revision: created.revision, patch: { name } },
          c,
        ),
      ),
    );
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(results.filter((x) => x.status === 'rejected').length, 1);
    assert.equal((await s.secret(created.profile.id))?.password, 'initial');
  }));
test('changed known host pin is never silently accepted and probe rejects cancelled/jump targets', async () =>
  fixture(async (s, m, c) => {
    const created: any = await m.call({ action: 'create', profile }, c);
    await s.trust('example.com:22', 'SHA256:' + 'b'.repeat(43));
    const manager = new ConnectionManagement(
      s,
      () => 'account',
      async () => 'SHA256:' + 'c'.repeat(43),
    );
    const p: any = await manager.call({ action: 'probe', id: created.profile.id }, c);
    assert.equal(p.changed, true);
    await assert.rejects(
      manager.call({ action: 'accept', challenge: p.challenge, fingerprint: p.fingerprint }, c),
      /HOST_KEY_CHANGED/,
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(probeSshHost(created.profile, { signal: abort.signal }), /CANCELLED/);
    await assert.rejects(
      probeSshHost({ ...created.profile, jumpProfileId: crypto.randomUUID() }),
      /JUMP_PROBE/,
    );
  }));
test('review resolves actual target, never includes secrets, and rechecks revocation before probe/write', async () =>
  fixture(async (s, m, c) => {
    const id: any = await m.call({ action: 'create', profile }, c);
    let observed: unknown;
    let allowed = true;
    let probes = 0;
    const manager = new ConnectionManagement(
      s,
      () => 'account',
      async () => {
        probes++;
        return 'SHA256:' + 'a'.repeat(43);
      },
    );
    const denied = {
      ...c,
      authorize: () => {
        if (!allowed) throw new Error('REVOKED');
      },
      review: async (_action: string, p: any, detail: unknown) => {
        assert.equal(p.id, id.profile.id);
        observed = detail;
        allowed = false;
      },
    };
    await assert.rejects(manager.call({ action: 'probe', id: id.profile.id }, denied), /REVOKED/);
    assert.equal(probes, 0);
    allowed = true;
    await assert.rejects(
      manager.call(
        {
          action: 'credentials',
          id: id.profile.id,
          revision: id.revision,
          secret: { password: 'sensitive-fixture' },
        },
        denied,
      ),
      /REVOKED/,
    );
    assert(!JSON.stringify(observed).includes('sensitive-fixture'));
    assert.equal(await s.secret(id.profile.id), undefined);
  }));
test('account epoch changes during review abort creation even when account returns to same name', async () =>
  fixture(async (s, _m, c) => {
    let epoch = 'a:1';
    const manager = new ConnectionManagement(s, () => epoch);
    await assert.rejects(
      manager.call(
        { action: 'create', profile, secret: { password: 'x' } },
        {
          ...c,
          accountKey: 'a:1',
          review: async () => {
            epoch = 'a:3';
          },
        },
      ),
      /ACCOUNT_CHANGED/,
    );
    assert.equal(s.snapshot().profiles.length, 0);
  }));

test('paired Agent updates require grants, retain identity adapter and roll back failed profile persistence',async()=>fixture(async(s,_m,c)=>{
 const id='34343434-3434-4343-8343-343434343434';await s.saveProfile({...profile,id,protocol:'client',port:24443});
 let endpoint={host:'example.com',port:24443},updates=0,reviews=0;
 const m=new ConnectionManagement(s,()=> 'account',undefined,{get:key=>key===id?endpoint:undefined,update:async(_id,value)=>{updates++;endpoint={...value};}});
 const request=()=>({action:'update',id,revision:s.connectionRevision(id),patch:{host:'p3.deviy.cn',port:53773}});
 await assert.rejects(m.call(request(),{...c,authorize:()=>{throw Error('DENIED');}}),/DENIED/);assert.equal(updates,0);
 await m.call(request(),{...c,review:async()=>{reviews++;}});assert.equal(reviews,1);assert.equal(endpoint.host,'p3.deviy.cn');
 await assert.rejects(m.call({...request(),patch:{username:'other'}},c),/PAIRED_CONNECTION_PATCH_UNSUPPORTED/);
 const save=s.saveConnection.bind(s);s.saveConnection=async()=>{throw Error('DISK_FAILED');};
 await assert.rejects(m.call({...request(),patch:{host:'other.example'}},c),/DISK_FAILED/);assert.equal(endpoint.host,'p3.deviy.cn');s.saveConnection=save;
 await assert.rejects(m.call({action:'create',profile:{...profile,protocol:'client'}},c),/USE_PROTOCOL_PAIRING_WORKFLOW/);
}));
