import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  officialExecutable,
  officialInferencePath,
  ensureOfficialRuntime,
} from '../src/extensions/opencode/official-runtime';
import { OpenCodeExtension } from '../src/extensions/opencode/service';

test('official runtime rejects corrupt or linked executables, and extracts only the verified binary', () => {
  const tar = Buffer.alloc(3072);
  tar.write('package/bin/opencode.exe');
  tar.write('00000002000\0', 124);
  tar[156] = 48;
  tar.fill(65, 512, 1536);
  const pack = gzipSync(tar),
    digest = createHash('sha512').update(pack).digest('base64');
  assert.equal(officialExecutable(pack, digest, true).length, 1024);
  assert.throws(() => officialExecutable(pack, 'invalid', true), /摘要/);
  assert.throws(() => officialExecutable(pack, digest, false), /目标程序/);
  tar[156] = 50;
  const linked = gzipSync(tar);
  assert.throws(
    () => officialExecutable(linked, createHash('sha512').update(linked).digest('base64'), true),
    /类型/,
  );
});

test('official client denial updates only that model; retry restores it without deleting account/default or falling back to HTTP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'official-extension-'));
  let denied = true,
    calls = 0,
    rawCalls = 0;
  const providers: any[] = [];
  const extension = new OpenCodeExtension(
    {
      directory,
      enabled: () => true,
      encrypt: async (s) => s,
      decrypt: async (s) => s,
      open: async () => {},
      saveProvider: async (p) => {
        providers.push(p);
      },
      official: async (input) => {
        input.guard();
        calls++;
        assert.equal(input.key, 'private-key');
        assert.equal(input.model, 'new-supported-model');
        return denied
          ? Response.json(
              { error: { message: 'FreeTier official client restriction' } },
              { status: 403 },
            )
          : Response.json({ choices: [{ message: { content: 'OK' } }] });
      },
    },
    async (url) => {
      if (String(url).includes('/models'))
        return Response.json({ data: [{ id: 'new-supported-model' }] });
      if (String(url).endsWith('/config')) return Response.json({});
      rawCalls++;
      throw Error('Unexpected legacy HTTP inference');
    },
  );
  try {
    await extension.load();
    await extension.call('save', { id: 'one', name: 'one', key: 'private-key' });
    await assert.rejects(() => extension.call('check', { id: 'one', tier: 'go' }));
    assert.equal(calls, 0, 'model check cannot implicitly pick a paid model');
    assert.equal(rawCalls, 0);
    const provider = await extension.resolve('one/go/new-supported-model', 'test');
    await assert.rejects(
      () =>
        provider.transport('', {
          body: JSON.stringify({
            model: 'new-supported-model',
            messages: [{ role: 'user', content: 'hello' }],
          }),
        }),
      /客户端/,
    );
    const rejected: any = await extension.call('catalog', {
      reference: 'one/go/new-supported-model',
    });
    assert.equal(rejected.current.available, false);
    denied = false;
    await provider.transport('', {
      body: JSON.stringify({
        model: 'new-supported-model',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    const recovered: any = await extension.call('catalog', {
      reference: 'one/go/new-supported-model',
    });
    assert.equal(recovered.current.available, true);
    assert.equal(calls, 2);
    assert.equal(rawCalls, 0);
    assert.equal(providers.length, 0);
    assert.equal(((await extension.call('status')) as any).accounts.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('official bridge binds Google URL model and rejects unrelated paths', () => {
  assert.equal(
    officialInferencePath(
      'google/v1beta/models/gemini-free:streamGenerateContent?alt=sse',
      'gemini-free',
    ),
    true,
  );
  assert.equal(
    officialInferencePath(
      'google/v1beta/models/gemini-paid:streamGenerateContent?alt=sse',
      'gemini-free',
    ),
    false,
  );
  assert.equal(
    officialInferencePath(
      'google/v1beta/models/gemini-free:generateContent?key=secret',
      'gemini-free',
    ),
    false,
  );
  assert.equal(officialInferencePath('openai/v1/chat/completions', 'beam-free'), true);
  assert.equal(officialInferencePath('https://other.example/chat/completions', 'beam-free'), false);
});

test('cancelling a shared runtime download waiter does not wait for or cancel the owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'official-download-'));
  const owner = new AbortController(),
    waiter = new AbortController();
  let downloading!: () => void,
    downloads = 0;
  const started = new Promise<void>((resolve) => {
    downloading = resolve;
  });
  const network: typeof fetch = async (_url, init) => {
    downloads++;
    downloading();
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }),
    );
  };
  const first = ensureOfficialRuntime(directory, network, owner.signal);
  const firstRejected = assert.rejects(first);
  try {
    await started;
    const second = ensureOfficialRuntime(directory, network, waiter.signal);
    waiter.abort();
    await assert.rejects(second, { name: 'AbortError' });
    assert.equal(downloads, 1);
    assert.equal(owner.signal.aborted, false);
  } finally {
    owner.abort();
    await firstRejected;
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
