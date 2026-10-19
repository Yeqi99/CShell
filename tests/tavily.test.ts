import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TavilyExtension, remaining } from '../src/extensions/tavily/service';
const quota = (usage = 0) => ({
  key: { usage, limit: 100 },
  account: {
    current_plan: 'test',
    plan_usage: usage,
    plan_limit: 100,
    paygo_usage: 0,
    paygo_limit: 100,
  },
});
async function fixture(network: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'tavily-'));
  let enabled = true;
  const host = {
    directory,
    enabled: () => enabled,
    encrypt: async (s: string) => Buffer.from(s).toString('base64'),
    decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
  };
  const service = new TavilyExtension(host, network);
  await service.load();
  return {
    service,
    host,
    directory,
    disable: () => {
      enabled = false;
    },
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
test('Tavily keys encrypted, separate account quotas, strongest remaining key selected, reload and disable', async () => {
  const requests: any[] = [];
  const f = await fixture(async (_url, init) => {
    const key = (init?.headers as any).Authorization;
    requests.push({ url: String(_url), key, body: init?.body });
    return String(_url).endsWith('/usage')
      ? Response.json(quota(key.endsWith('first-key') ? 90 : 10))
      : Response.json({
          usage: { credits: 1 },
          results: [{ title: 'source', url: 'https://example.com', content: 'untrusted text' }],
        });
  });
  try {
    await f.service.call('save', { name: 'first', key: 'first-key' });
    const status = await f.service.call('save', { name: 'second', key: 'second-key' });
    assert.equal(status.accounts.length, 2);
    assert.equal(JSON.stringify(status).includes('second-key'), false);
    assert.equal(
      (await readFile(join(f.directory, 'tavily.enc'), 'utf8')).includes('second-key'),
      false,
    );
    const result = await f.service.search({ query: 'hello' }, new AbortController().signal);
    assert.equal(result.keyName, 'second');
    assert.equal(requests.at(-1).key, 'Bearer second-key');
    assert.equal(JSON.parse(requests.at(-1).body).auto_parameters, false);
    assert.equal((await f.service.call('status', {})).accounts[1].remaining, 89);
    const reload = new TavilyExtension(f.host);
    await reload.load();
    assert.equal((await reload.call('status', {})).accounts.length, 2);
    f.disable();
    assert.deepEqual(f.service.tools(), []);
    await assert.rejects(
      () => f.service.search({ query: 'x' }, new AbortController().signal),
      /启用/,
    );
  } finally {
    await f.close();
  }
});
test('Tavily never retries an unknown charged outcome; explicit throttling can rotate', async () => {
  let mode = 'rate',
    searches = 0;
  const f = await fixture(async (url) => {
    if (String(url).endsWith('/usage')) return Response.json(quota());
    searches++;
    if (mode === 'rate' && searches === 1) return new Response('', { status: 429 });
    if (mode === 'network') throw Error('secret must not escape');
    return Response.json({ results: [] });
  });
  try {
    await f.service.call('save', { name: 'one', key: 'first-key' });
    await f.service.call('save', { name: 'two', key: 'second-key' });
    assert.equal(
      (await f.service.search({ query: 'q' }, new AbortController().signal)).keyName,
      'two',
    );
    assert.equal(searches, 2);
    mode = 'network';
    await assert.rejects(
      () => f.service.search({ query: 'q' }, new AbortController().signal),
      /结果未知/,
    );
    assert.equal(searches, 3);
  } finally {
    await f.close();
  }
});
test('Tavily cached usage is coalesced; duplicates rejected and cancellation does not search', async () => {
  let usages = 0,
    searches = 0;
  const f = await fixture(async (url) => {
    if (String(url).endsWith('/usage')) {
      usages++;
      return Response.json(quota());
    }
    searches++;
    return Response.json({ results: [] });
  });
  try {
    await f.service.call('save', { name: 'one', key: 'first-key' });
    await Promise.all([f.service.call('refresh', {}), f.service.call('refresh', {})]);
    assert.equal(usages, 1);
    await assert.rejects(
      () => f.service.call('save', { name: 'duplicate', key: 'first-key' }),
      /已添加/,
    );
    const c = new AbortController();
    c.abort();
    await assert.rejects(() => f.service.search({ query: 'q' }, c.signal));
    assert.equal(searches, 0);
  } finally {
    await f.close();
  }
});
test('Tavily account quota bounds key quota; paygo requires explicit opt-in', () => {
  const q = quota();
  q.account.plan_usage = 100;
  assert.equal(remaining(q), 0);
  assert.equal(remaining(q, true), 100);
  q.key.usage = 99;
  assert.equal(remaining(q, true), 1);
});
