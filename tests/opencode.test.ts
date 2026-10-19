import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeExtension, quotaWindows } from '../src/extensions/opencode/service';
import { encodeRequest, normalizeResponse, family } from '../src/extensions/opencode/protocol';
import { readAiResponse } from '../src/core/ai-response';
import { AiService } from '../src/core/ai';
import { Store } from '../src/core/store';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { randomUUID } from 'node:crypto';
test('generic host routes managed provider chat, probe and text through extension transport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'extension-host-'));
  const store = new Store(directory, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  const ai = new AiService(directory, store, new ConnectionRegistry(() => undefined));
  let enabled = true,
    calls = 0;
  ai.providerExtensions.register({
    id: 'test.models',
    call: async () => null,
    resolve: async () => {
      if (!enabled) throw Error('disabled');
      return {
        url: 'https://model-extension.invalid',
        model: 'fixture',
        key: '',
        transport: async () => {
          calls++;
          return Response.json({ choices: [{ message: { content: 'OK' } }] });
        },
      };
    },
  });
  try {
    await store.load();
    await ai.load();
    const p = {
      id: randomUUID(),
      name: 'fixture',
      url: 'https://model-extension.invalid',
      model: 'fixture',
      extension: { id: 'test.models', model: 'fixture' },
    };
    await ai.saveProvider(p);
    await ai.setTextProvider('translate', p.id);
    await ai.testProvider(p);
    assert.equal((await ai.text({ kind: 'translate', text: 'hello' })).text, 'OK');
    const t = await ai.create('workspace', p.id, 'review');
    await ai.send(t.id, 'hello');
    const end = Date.now() + 3000;
    while (
      ai.snapshot().threads.find((v) => v.id === t.id)?.state === 'running' &&
      Date.now() < end
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      ai
        .snapshot()
        .threads.find((v) => v.id === t.id)
        ?.messages.at(-1)?.content,
      'OK',
    );
    assert.ok(calls >= 3);
    enabled = false;
    await assert.rejects(() => ai.text({ kind: 'translate', text: 'hello' }), /disabled/);
  } finally {
    ai.dispose();
    await ai.flush();
    await rm(directory, { recursive: true, force: true });
  }
});
test('extension credentials stay private, Go routes stay separate, disable blocks transport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-test-'));
  let enabled = true;
  let saved: any;
  const requests: any[] = [];
  const network: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/models'))
      return Response.json({
        data: [{ id: 'glm-5.3' }, { id: 'claude-haiku-5-5' }, { id: 'unknown-new-protocol' }],
      });
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };
  const host = {
    directory,
    enabled: () => enabled,
    encrypt: async (s: string) => Buffer.from(s).toString('base64'),
    decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
    saveProvider: async (p: any) => {
      saved = p;
    },
    open: async () => {},
  };
  try {
    const e = new OpenCodeExtension(host, network);
    await e.load();
    await e.call('save', {
      key: 'test-private-key',
      workspace: 'https://opencode.ai/console/wrk_test/go',
    });
    const state = await e.call('status', {});
    assert.equal(JSON.stringify(state).includes('test-private-key'), false);
    await e.call('add', { tier: 'go', model: 'glm-5.3', name: 'Go' });
    assert.equal(saved.extension.model, 'go/glm-5.3');
    assert.equal(saved.key, undefined);
    const p = await e.resolve('go/glm-5.3', 'conversation-1');
    await p.transport(p.url, {
      body: JSON.stringify({ model: p.model, messages: [], stream: false }),
    });
    const last = requests.at(-1);
    assert.match(last.url, /\/inference\/go\/openai\/v1\/chat\/completions$/);
    assert.equal(last.init.headers['x-opencode-session'], 'conversation-1');
    assert.equal(last.init.headers.Authorization, 'Bearer test-private-key');
    assert.equal(
      (await readFile(join(directory, 'opencode.enc'), 'utf8')).includes('test-private-key'),
      false,
    );
    enabled = false;
    await assert.rejects(() => p.transport(p.url, { body: '{}' }), /启用/);
    enabled = true;
    await assert.rejects(() => e.resolve('go/unknown-new-protocol', 'test'), /协议/);
    const reload = new OpenCodeExtension(host, network);
    await reload.load();
    assert.equal((await reload.call('status', {})).hasKey, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('official quota windows are distinct from money and unknown format is unavailable', () => {
  const result = quotaWindows({
    rollingUsage: { usagePercent: 23, resetInSec: 100 },
    weeklyUsage: { usagePercent: 50 },
    monthlyUsage: { usagePercent: 0 },
  });
  assert.deepEqual(
    result.map((x) => x.usedPercent),
    [23, 50, 0],
  );
  assert.ok(result[0].resetAt);
  assert.deepEqual(quotaWindows({ balance: 20 }), []);
  assert.equal(family('jev-1.13'), null);
});
test('request adapters preserve tool results and Gemini thought signatures', () => {
  const b = {
    model: 'test',
    stream: true,
    messages: [
      { role: 'system', content: 'system' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            function: { name: 'lookup', arguments: '{"x":1}' },
            providerData: 'signed-thought',
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'result' },
    ],
    tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
  };
  assert.equal(encodeRequest('responses', b).input[2].type, 'function_call_output');
  assert.equal(encodeRequest('anthropic', b).messages[1].content[0].tool_use_id, 'c1');
  assert.equal(encodeRequest('google', b).contents[0].parts[0].thoughtSignature, 'signed-thought');
  assert.equal(encodeRequest('google', b).contents[1].parts[0].functionResponse.name, 'lookup');
});
test('Responses and Anthropic fragmented SSE normalize tool calls without fake completion', async () => {
  for (const kind of ['responses', 'anthropic'] as const) {
    const events =
      kind === 'responses'
        ? [
            { type: 'response.output_text.delta', delta: 'Hello' },
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'function_call', call_id: 'c1', name: 'lookup' },
            },
            { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"x":1}' },
            { type: 'response.completed' },
          ]
        : [
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
            {
              type: 'content_block_start',
              index: 1,
              content_block: { type: 'tool_use', id: 'c1', name: 'lookup' },
            },
            {
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
            },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
          ];
    const bytes = new TextEncoder().encode(
      events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    );
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    const parsed = await readAiResponse(
      normalizeResponse(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
        kind,
        true,
      ),
      () => {},
    );
    assert.equal(parsed.content, 'Hello');
    assert.equal(parsed.tool_calls?.[0].function.arguments, '{"x":1}');
  }
  const truncated = new Response(
    'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
  await assert.rejects(
    () => readAiResponse(normalizeResponse(truncated, 'responses', true), () => {}),
    /中断/,
  );
});
test('Gemini JSON preserves tool metadata in normalized contract', async () => {
  const r = Response.json({
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: { name: 'lookup', args: { x: 1 } },
              thoughtSignature: 'signed-thought',
            },
          ],
        },
        finishReason: 'STOP',
      },
    ],
  });
  const p = await readAiResponse(normalizeResponse(r, 'google', false), () => {});
  assert.equal(p.tool_calls?.[0].providerData, 'signed-thought');
});

test('multi-account references stay bound after deletion and old encrypted config migrates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-accounts-'));
  const seen: string[] = [];
  const host = {
    directory,
    enabled: () => true,
    encrypt: async (s: string) => Buffer.from(s).toString('base64'),
    decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
    saveProvider: async () => {},
    open: async () => {},
  };
  const network: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'glm-5.3' }] });
    seen.push((init?.headers as any).Authorization);
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(directory, 'opencode.enc'),
      await host.encrypt(JSON.stringify({ key: 'legacy-secret' })),
    );
    const e = new OpenCodeExtension(host, network);
    await e.load();
    assert.equal((await e.call('status')).accounts[0].id, 'default');
    await e.call('save', { id: 'second', name: 'Second', key: 'other-secret' });
    const legacy = await e.resolve('go/glm-5.3', 'old'),
      second = await e.resolve('second/zen/glm-5.3', 'new');
    const body = JSON.stringify({ model: 'glm-5.3', messages: [], stream: false });
    await legacy.transport('', { body });
    await second.transport('', { body });
    assert.deepEqual(seen, ['Bearer legacy-secret', 'Bearer other-secret']);
    await e.call('remove', { id: 'default' });
    await assert.rejects(() => legacy.transport('', { body }), /已移除/);
    await assert.rejects(() => e.call('choices', { reference: 'go/glm-5.3' }), /已移除/);
    await second.transport('', { body });
    assert.equal(seen.at(-1), 'Bearer other-secret');
    assert.equal(JSON.stringify(await e.call('status')).includes('other-secret'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('availability requires authenticated config and real completion, never public models alone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-check-'));
  let auth = false,
    completion = false;
  const requests: string[] = [];
  const network: typeof fetch = async (url, init) => {
    requests.push(String(url));
    if (String(url).endsWith('/config'))
      return auth ? Response.json({ providers: {} }) : new Response('', { status: 401 });
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'glm-5.3' }] });
    if (String(url).endsWith('/usage')) return Response.json({ rollingUsage: { usagePercent: 9 } });
    assert.equal(JSON.parse(String(init?.body)).max_tokens, 64);
    return completion
      ? Response.json({ choices: [{ message: { content: 'OK' } }] })
      : new Response('', { status: 429 });
  };
  const e = new OpenCodeExtension(
    {
      directory,
      enabled: () => true,
      encrypt: async (s) => s,
      decrypt: async (s) => s,
      saveProvider: async () => {},
      open: async () => {},
    },
    network,
  );
  try {
    await e.call('save', { key: 'fixture' });
    await assert.rejects(() => e.call('check', { tier: 'go' }), /401/);
    assert.equal(
      requests.some((u) => u.includes('completions')),
      false,
    );
    auth = true;
    await assert.rejects(() => e.call('check', { tier: 'go' }), /429/);
    completion = true;
    const r = await e.call('check', { tier: 'go' });
    assert.equal(r.authenticated, true);
    assert.equal(r.usage.windows[0].usedPercent, 9);
    assert.ok(requests.some((u) => u.endsWith('/go/openai/v1/chat/completions')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('device login stays private and refreshes once for concurrent calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-device-'));
  let refreshed = 0;
  const opened: string[] = [];
  const network: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/code'))
      return Response.json({
        device_code: 'private-device',
        user_code: 'ABCD',
        verification_uri_complete: '/console/device?user_code=ABCD',
        expires_in: 600,
        interval: 5,
      });
    if (u.endsWith('/token')) {
      const b = new URLSearchParams(String(init?.body));
      if (b.get('grant_type') === 'refresh_token') {
        refreshed++;
        await new Promise((r) => setTimeout(r, 20));
        return Response.json({
          access_token: 'new-private',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        });
      }
      return Response.json({
        access_token: 'old-private',
        refresh_token: 'private-refresh',
        expires_in: 1,
        org_id: 'org_test',
      });
    }
    if (u.endsWith('/models')) return Response.json({ data: [{ id: 'glm-5.3' }] });
    assert.equal((init?.headers as any).Authorization, 'Bearer new-private');
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };
  const e = new OpenCodeExtension(
    {
      directory,
      enabled: () => true,
      encrypt: async (s) => Buffer.from(s).toString('base64'),
      decrypt: async (s) => Buffer.from(s, 'base64').toString(),
      saveProvider: async () => {},
      open: async (u) => {
        opened.push(u);
      },
    },
    network,
  );
  try {
    const d = await e.call('login-start');
    assert.equal(JSON.stringify(d).includes('private-device'), false);
    assert.equal((await e.call('login-poll', { id: d.id })).pending, true);
    (e as any).device.nextPoll = 0;
    const status = await e.call('login-poll', { id: d.id });
    assert.equal(status.pending, false);
    assert.equal(JSON.stringify(status).includes('private-refresh'), false);
    assert.match(opened[0], /^https:\/\/opencode.ai\/console\/device/);
    const p = await e.resolve(`${d.id}/go/glm-5.3`, 'test');
    const body = JSON.stringify({ model: 'glm-5.3', messages: [] });
    await Promise.all([p.transport('', { body }), p.transport('', { body })]);
    assert.equal(refreshed, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('device flow refuses external verification URL', async () => {
  const e = new OpenCodeExtension(
    {
      directory: tmpdir(),
      enabled: () => true,
      encrypt: async (s) => s,
      decrypt: async (s) => s,
      saveProvider: async () => {},
      open: async () => assert.fail('must not open'),
    },
    async () =>
      Response.json({
        device_code: 'private',
        user_code: 'ABCD',
        verification_uri_complete: 'https://example.com/console/device',
        expires_in: 600,
      }),
  );
  await assert.rejects(() => e.call('login-start'), /不可信/);
});

test('unknown refresh outcome remains blocked across restart and metadata edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-refresh-'));
  const host = {
    directory,
    enabled: () => true,
    encrypt: async (s: string) => Buffer.from(s).toString('base64'),
    decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
    saveProvider: async () => {},
    open: async () => {},
  };
  let refreshCalls = 0;
  const network: typeof fetch = async (url) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'glm-5.3' }] });
    refreshCalls++;
    throw Error('connection lost');
  };
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(directory, 'opencode.enc'),
      await host.encrypt(
        JSON.stringify({
          accounts: [
            {
              id: 'login',
              name: 'Browser',
              key: 'expired',
              refreshToken: 'single-use',
              expiresAt: 1,
            },
          ],
        }),
      ),
    );
    const e = new OpenCodeExtension(host, network);
    await e.load();
    const p = await e.resolve('login/go/glm-5.3', 'test');
    await assert.rejects(() => p.transport('', { body: '{}' }), /connection lost/);
    const reload = new OpenCodeExtension(host, network);
    await reload.load();
    await reload.call('save', { id: 'login', name: 'Renamed' });
    const again = await reload.resolve('login/go/glm-5.3', 'test');
    await assert.rejects(() => again.transport('', { body: '{}' }), /未知/);
    assert.equal(refreshCalls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
