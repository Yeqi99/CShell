import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountWorkspaces } from '../src/core/account-workspaces';
const codec = {
  encrypt: async (s: string) => Buffer.from(s).toString('base64'),
  decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
};
test('guest and account snapshots stay separate, failed imports roll back, clearing guest leaves account intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'account-scopes-'));
  let live = { secret: 'guest-key' },
    idle = true,
    fail = false;
  const a = 'a'.repeat(32),
    b = 'b'.repeat(32);
  const adapter = {
    capture: async () => structuredClone(live),
    restore: async (v: typeof live) => {
      if (fail && v.secret === '') throw Error('fixture');
      live = structuredClone(v);
    },
    empty: () => ({ secret: '' }),
    validate: (x: unknown) => {
      assert.equal(typeof (x as any).secret, 'string');
      return x as typeof live;
    },
    assertIdle: () => {
      if (!idle) throw Error('busy');
    },
  };
  try {
    const scopes = new AccountWorkspaces(dir, codec, adapter);
    await scopes.load();
    await scopes.switchTo(a);
    assert.equal(live.secret, '');
    live.secret = 'account-a';
    idle = false;
    await assert.rejects(scopes.switchTo(b), /busy/);
    idle = true;
    fail = true;
    await assert.rejects(scopes.switchTo(b), /fixture/);
    assert.equal(live.secret, 'account-a');
    assert.equal(scopes.current(), a);
    fail = false;
    await scopes.switchTo(b);
    live.secret = 'account-b';
    await scopes.switchTo(a);
    assert.equal(live.secret, 'account-a');
    assert.equal((await scopes.guest())?.secret, 'guest-key');
    await scopes.clearGuest();
    assert.equal(live.secret, 'account-a');
    await scopes.switchTo('guest');
    assert.equal(live.secret, '');
    await assert.rejects(scopes.clearGuest());
    for (const f of await readdir(dir)) {
      assert(!(await readFile(join(dir, f), 'utf8')).includes('account-a'));
    }
    await assert.rejects(scopes.switchTo('../escape'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
