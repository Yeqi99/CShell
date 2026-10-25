import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeExtension } from '../src/extensions/opencode/service';
test('picker discovers authenticated account models without creating bases or inference; explicit selection preserves existing default and IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-picker-'));
  const providers = new Map<string, any>();
  let offline = false,
    paid = 0,
    models = ['beam-free', 'longcat-flash-free'],
    authRejected = false;
  const extension = new OpenCodeExtension(
    {
      directory,
      enabled: () => true,
      encrypt: async (s) => Buffer.from(s).toString('base64'),
      decrypt: async (s) => Buffer.from(s, 'base64').toString(),
      open: async () => {},
      getProvider: (id) => providers.get(id),
      saveProvider: async (p) => {
        providers.set(p.id, p);
      },
    },
    async (url, init) => {
      if (String(url).includes('/models')) {
        if (offline) throw Error('offline');
        return Response.json({
          data: models.map((id) => ({ id, modalities: { input: ['text'] } })),
        });
      }
      if (String(url).endsWith('/config'))
        return authRejected &&
          new Headers(init?.headers).get('Authorization') === 'Bearer second-key'
          ? new Response('', { status: 401 })
          : Response.json({});
      paid++;
      throw Error('No inference allowed during discovery');
    },
  );
  try {
    await extension.load();
    await extension.call('save', { id: 'first', name: '主账号', key: 'first-key' });
    await extension.call('save', { id: 'second', name: '另一个账号', key: 'second-key' });
    let result = await extension.call('picker');
    assert.equal(result.accounts.length, 2);
    assert.ok(
      result.accounts.every((a: any) =>
        a.choices.some((c: any) => c.ref === a.id + '/go/beam-free'),
      ),
    );
    assert.equal(providers.size, 0);
    assert.equal(paid, 0);
    const selected = await extension.call('connect', {
      id: 'first',
      reference: 'first/go/longcat-flash-free',
    });
    const previous = structuredClone(providers.get(selected.id));
    models = ['beam-free'];
    result = await extension.call('picker', { refresh: true });
    assert.ok(!JSON.stringify(result).includes('longcat'));
    const again = await extension.call('connect', { id: 'first', reference: 'first/go/beam-free' });
    assert.equal(again.id, selected.id);
    assert.deepEqual(
      providers.get(selected.id),
      previous,
      'selection pins a new thread, does not change account default',
    );
    authRejected = true;
    result = await extension.call('picker');
    assert.equal(result.accounts[1].choices.length, 0);
    assert.ok(result.accounts[0].choices.length > 0);
    assert.equal((await extension.call('status')).accounts.length, 2);
    assert.equal(providers.size, 1);
    offline = true;
    result = await extension.call('picker');
    assert.equal(result.accounts[0].choices.length, 0);
    assert.match(result.accounts[0].reason, /暂不可用/);
    offline = false;
    result = await extension.call('picker');
    assert.ok(result.accounts[0].choices.length > 0);
    const runtime = await extension.resolve('first/go/beam-free', 'fixture');
    assert.equal(runtime.imageInput, false);
    assert.equal(paid, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
