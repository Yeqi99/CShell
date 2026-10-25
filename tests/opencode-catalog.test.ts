import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenCodeExtension } from '../src/extensions/opencode/service';

async function fixture(network: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-catalog-'));
  const saved: any[] = []; let notifications = 0;
  const extension = new OpenCodeExtension({ directory, enabled: () => true,
    encrypt: async s => Buffer.from(s).toString('base64'), decrypt: async s => Buffer.from(s, 'base64').toString(),
    saveProvider: async p => { saved.push(p); }, getProvider: id => saved.filter(p => p.id === id).at(-1),
    changed: () => { notifications++; }, open: async () => {},
  }, network);
  await extension.load(); await extension.call('save', { key: 'private-fixture' });
  return { extension, saved, notifications: () => notifications, state: async()=>JSON.parse(Buffer.from(await readFile(join(directory,'opencode.enc'),'utf8'),'base64').toString()), close: () => rm(directory, { recursive: true, force: true }) };
}

test('retired reference is unavailable without deleting credentials or selecting another default', async () => {
  let listed = ['longcat-flash-free'];
  const f = await fixture(async () => Response.json({ data: listed.map(id => ({id})) }));
  try {
    await f.extension.call('connect');
    const before = await f.state();
    listed = ['beam-free', 'claude-opus-5'];
    const catalog = await f.extension.call('catalog', { reference: 'go/longcat-flash-free', refresh: true });
    assert.equal(catalog.current.available, false);
    assert.match(catalog.current.reason, /已不在.*当前目录/);
    assert.ok(catalog.choices.every((m: any) => !m.model.includes('longcat')));
    await f.extension.call('connect');
    assert.equal(f.saved.length, 1, 'credential verification must not replace provider');
    assert.equal(f.saved[0].model, 'longcat-flash-free');
    assert.deepEqual(await f.state(), before);
    await assert.rejects(f.extension.resolve('go/longcat-flash-free', 'new'), /重新选择模型/);
    const notices = f.notifications();
    await f.extension.call('catalog', { reference: 'go/longcat-flash-free' });
    assert.equal(f.notifications(), notices, 'cached status must not create notification loops');
  } finally { await f.close(); }
});

test('temporary tier failure is unknown, not retirement, and partial catalogs remain usable', async () => {
  let offline = false;
  const f = await fixture(async url => {
    if (offline && String(url).includes('/go/')) throw Error('offline');
    return Response.json({ data: [{id: 'beam-free'}] });
  });
  try {
    await f.extension.call('catalog', { reference: 'go/beam-free' });
    offline = true;
    const catalog = await f.extension.call('catalog', { reference: 'go/beam-free', refresh: true });
    assert.match(catalog.current.reason, /尚不能确认/);
    assert.doesNotMatch(catalog.current.reason, /已不在|下架/);
    assert.equal(catalog.choices.length, 1);
    const notified = await f.extension.call('catalog', { reference: 'go/beam-free' });
    assert.match(notified.current.reason, /尚不能确认/, 'notification refresh must not revive the stale cache');
    assert.match(catalog.choices[0].ref, /zen/);
    assert.equal((await f.state()).accounts[0].key, 'private-fixture');
    offline = false;
    assert.equal((await f.extension.call('catalog', { reference: 'go/beam-free', refresh: true })).current.available, true);
  } finally { await f.close(); }
});

test('an existing conversation retry recovers a failed catalog once without replaying inference', async () => {
  let offline = false, catalogRequests = 0, inferenceRequests = 0;
  const f = await fixture(async (url, init) => {
    if (String(url).endsWith('/models')) {
      catalogRequests++;
      if (offline) throw Error('offline');
      return Response.json({data:[{id:'beam-free'}]});
    }
    if (init?.method === 'POST') {
      inferenceRequests++;
      return Response.json({choices:[{message:{content:'OK'}}]});
    }
    return Response.json({});
  });
  try {
    await f.extension.call('connect');
    const before = await f.state();
    offline = true;
    const failed = await f.extension.call('catalog', {reference:'go/beam-free',refresh:true});
    assert.match(failed.current.reason, /尚不能确认/);
    let count = catalogRequests;
    await assert.rejects(f.extension.resolve('go/beam-free', 'existing-thread'), /offline/);
    assert.equal(catalogRequests, count + 1, 'one failed retry must not loop');
    offline = false;
    count = catalogRequests;
    const [provider] = await Promise.all([
      f.extension.resolve('go/beam-free', 'existing-thread'),
      f.extension.resolve('go/beam-free', 'another-thread'),
    ]);
    assert.equal(catalogRequests, count + 1, 'concurrent retries share the catalog request');
    assert.equal(inferenceRequests, 0, 'catalog recovery must not replay a message');
    await provider.transport('', {body:JSON.stringify({model:'beam-free',messages:[],stream:false})});
    assert.equal(inferenceRequests, 1);
    assert.equal((await f.extension.call('catalog', {reference:'go/beam-free'})).current.available, true);
    assert.equal(f.saved.length, 1);
    assert.deepEqual(await f.state(), before);
  } finally { await f.close(); }
});

test('first account connection never chooses an unapproved paid model', async () => {
  const f = await fixture(async () => Response.json({data:[{id:'claude-opus-5'}]}));
  try {
    await assert.rejects(f.extension.call('connect'), /不会自动选择付费模型/);
    assert.equal(f.saved.length, 0);
    await f.extension.call('connect', { reference: 'default/go/claude-opus-5' });
    assert.equal(f.saved[0].extension.model, 'default/go/claude-opus-5');
  } finally { await f.close(); }
});

test('credential verification and an explicit model probe preserve the existing default', async () => {
  const f = await fixture(async (_url, init) => init?.method === 'POST'
    ? Response.json({choices:[{message:{content:'OK'}}]})
    : Response.json({data:[{id:'longcat-flash-free'},{id:'beam-free'}]}));
  try {
    const connected = await f.extension.call('connect', {reference:'default/go/longcat-flash-free'});
    const before = await f.state();
    await f.extension.call('connect', {reference:'default/go/beam-free'});
    await f.extension.call('check', {id:'default',tier:'go',model:'beam-free'});
    assert.equal(f.saved.length, 1, 'verification and probe must not save a different default');
    assert.equal(f.saved[0].id, connected.id);
    assert.equal(f.saved[0].extension.model, 'default/go/longcat-flash-free');
    assert.deepEqual(await f.state(), before);
  } finally { await f.close(); }
});

test('explicit default selection updates the same provider and preserves account credentials', async () => {
  let listed = ['longcat-flash-free'];
  const f = await fixture(async () => Response.json({data:listed.map(id=>({id}))}));
  try {
    const connected = await f.extension.call('connect');
    const before = await f.state();
    const original = f.saved[0];
    original.name = 'My OpenCode';
    listed = ['beam-free'];
    await assert.rejects(f.extension.call('connect', {setDefault:true}), /明确选择/);
    await assert.rejects(f.extension.call('connect', {setDefault:true,reference:'other/go/beam-free'}), /选择.*模型/);
    assert.equal(f.saved.length, 1);
    const updated = await f.extension.call('connect', {setDefault:true,reference:'default/go/beam-free'});
    assert.equal(updated.id, connected.id);
    assert.equal(f.saved.length, 2);
    assert.equal(f.saved[1].name, 'My OpenCode');
    assert.equal(f.saved[1].extension.model, 'default/go/beam-free');
    assert.equal(original.extension.model, 'default/go/longcat-flash-free');
    assert.deepEqual(await f.state(), before);
    await f.extension.call('connect');
    assert.equal(f.saved.length, 2, 'later credential verification keeps the explicit choice');
  } finally { await f.close(); }
});

test('actual model rejection is shown separately from account validity and explicit retest can recover', async () => {
  let reject = true;
  const f = await fixture(async (_url, init) => {
    if (!init?.method) return Response.json({data:[{id:'beam-free'}]});
    return reject ? Response.json({ error: { message: 'This model is not available in your country private-fixture' } }, {status:403})
      : Response.json({ choices:[{message:{content:'OK'}}] });
  });
  try {
    const provider = await f.extension.resolve('go/beam-free', 'fixed-thread');
    const request = {body:JSON.stringify({model:'beam-free',messages:[],stream:false})};
    await assert.rejects(provider.transport('', request), error => {
      assert.match(String(error), /当前地区/); assert.doesNotMatch(String(error), /private-fixture/); return true;
    });
    assert.equal((await f.extension.call('catalog',{reference:'go/beam-free'})).current.available, false);
    assert.equal((await f.extension.call('status')).hasKey, true);
    reject = false;
    const retry = await f.extension.resolve('go/beam-free', 'explicit-retest');
    assert.ok((await retry.transport('', request)).ok);
    assert.equal((await f.extension.call('catalog',{reference:'go/beam-free'})).current.available, true);
    assert.equal(f.saved.length, 0);
  } finally { await f.close(); }
});

