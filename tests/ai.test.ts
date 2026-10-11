import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AiService, commandNeedsReview } from '../src/core/ai';
import { Store } from '../src/core/store';
import { SshService } from '../src/core/ssh';
import { createSshConnections } from '../src/core/connections/ssh-provider';
import { fixture } from './fixture';
import { initialWindowBounds } from '../src/desktop/window-bounds';
import { ConnectionRegistry } from '../src/core/connections/registry';
const until = async (fn: () => boolean) => {
  const deadline = Date.now() + 10000;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('Timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};
test('initial window fits work area including small/high-DPI and secondary screens', () => {
  for (const area of [
    { x: 0, y: 0, width: 1280, height: 680 },
    { x: -1920, y: 30, width: 1920, height: 1050 },
    { x: 0, y: 0, width: 700, height: 500 },
  ]) {
    const w = initialWindowBounds(area);
    assert.ok(w.x >= area.x && w.y >= area.y);
    assert.ok(w.x + w.width <= area.x + area.width && w.y + w.height <= area.y + area.height);
    assert.ok(w.minWidth <= area.width && w.minHeight <= area.height);
  }
});
test('agent enforces target/capability, review, revocation, stop and encrypted persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-ai-')),
    secret = randomBytes(32);
  const codec = {
    encrypt: async (s: string) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', secret, iv);
      return Buffer.concat([iv, cipher.update(s), cipher.final(), cipher.getAuthTag()]).toString(
        'base64',
      );
    },
    decrypt: async (s: string) => {
      const b = Buffer.from(s, 'base64'),
        c = createDecipheriv('aes-256-gcm', secret, b.subarray(0, 12));
      c.setAuthTag(b.subarray(-16));
      return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
    },
  };
  const store = new Store(directory, codec),
    remote = await fixture(),
    ssh = new SshService(
      () => {},
      async () => true,
    );
  const requests: any[] = [];
  let requestedCommand = 'pwd';
  const api = createServer(async (req, res) => {
    let data = '';
    for await (const c of req) data += c;
    const input = JSON.parse(data);
    requests.push(input);
    const last = input.messages.at(-1);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message:
              last.role === 'tool'
                ? { content: 'Done', tool_calls: null }
                : {
                    content: null,
                    tool_calls: [
                      {
                        id: randomUUID(),
                        type: 'function',
                        function: {
                          name: 'execute_command',
                          arguments: JSON.stringify({ command: requestedCommand }),
                        },
                      },
                    ],
                  },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  try {
    const profile = {
      id: randomUUID(),
      name: 'test',
      host: '127.0.0.1',
      port: remote.port,
      username: 'tester',
      auth: 'password' as const,
      group: 'Dev',
      favorite: false,
    };
    await store.saveProfile(profile);
    const { sessionId } = await ssh.connect(profile, { password: remote.password });
    const connections = createSshConnections(ssh, () => store.snapshot().profiles);
    const ai = new AiService(directory, store, connections);
    await ai.load();
    const provider = {
      id: randomUUID(),
      name: 'fixture',
      url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
      model: 'fixture',
    };
    await ai.saveProvider(provider, 'private-test-key');
    assert.equal(JSON.stringify(ai.snapshot()).includes('private-test-key'), false);
    await assert.rejects(
      ai.saveProvider({ ...provider, url: 'https://different.example/v1' }),
      /key again/,
    );
    const permission = {
      location: 'terminal' as const,
      providerId: provider.id,
      groups: ['Dev'],
      profiles: [],
      capabilities: ['commands.execute' as const],
    };
    await ai.permission(permission);
    const thread = await ai.create('terminal', provider.id, 'review', sessionId);
    await ai.send(thread.id, 'show directory');
    await until(() => ai.snapshot().threads[0].state === 'approval');
    assert.equal(requests[0].tools.length, 1);
    await ai.permission({ ...permission, capabilities: [] });
    ai.approve(thread.id, ai.snapshot().threads[0].pending!.id, true);
    await until(() => ai.snapshot().threads[0].state === 'idle');
    assert.match(
      ai.snapshot().threads[0].messages.find((m) => m.role === 'tool')!.content,
      /revoked/,
    );
    await ai.permission(permission);
    requestedCommand = 'rm -rf /test-only-not-executed';
    await ai.mode(thread.id, 'restricted');
    await ai.send(thread.id, 'dangerous operation');
    await until(() => ai.snapshot().threads[0].state === 'approval');
    ai.stop(thread.id);
    await until(() => ai.snapshot().threads[0].state === 'error');
    await until(() => !ai.snapshot().threads[0].pending);
    await ai.savePolicy({
      ...ai.snapshot().policy,
      overrides: [{ profileId: profile.id, capabilities: [] }],
    });
    const outside = await ai.create('files', provider.id, 'allow', sessionId);
    await ai.send(outside.id, 'try bypass');
    await until(() => ai.snapshot().threads[0].state === 'idle');
    assert.match(
      ai.snapshot().threads[0].messages.find((m) => m.role === 'tool')!.content,
      /denied/,
    );
    await ai.permission(permission);
    assert.equal(commandNeedsReview('ls -la'), false);
    assert.equal(commandNeedsReview('echo x; rm a'), true);
    assert.equal(commandNeedsReview('python3 -c x'), true);
    requestedCommand = 'pwd';
    await ai.mode(thread.id, 'restricted');
    await ai.send(thread.id, 'read with restricted execution');
    await until(() => ai.snapshot().threads.find((t) => t.id === thread.id)!.state === 'idle');
    assert.match(
      ai
        .snapshot()
        .threads.find((t) => t.id === thread.id)!
        .messages.filter((m) => m.role === 'tool')
        .at(-1)!.content,
      /__CPU__/,
    );
    await ai.mode(thread.id, 'review');
    await ai.send(thread.id, 'review and allow once');
    await until(() => ai.snapshot().threads.find((t) => t.id === thread.id)!.state === 'approval');
    ai.approve(thread.id, ai.snapshot().threads.find((t) => t.id === thread.id)!.pending!.id, true);
    await until(() => ai.snapshot().threads.find((t) => t.id === thread.id)!.state === 'idle');
    assert.match(
      ai
        .snapshot()
        .threads.find((t) => t.id === thread.id)!
        .messages.filter((m) => m.role === 'tool')
        .at(-1)!.content,
      /__CPU__/,
    );
    await ai.mode(thread.id, 'allow');
    await ai.send(thread.id, 'allow permitted execution');
    await until(() => ai.snapshot().threads.find((t) => t.id === thread.id)!.state === 'idle');
    assert.match(
      ai
        .snapshot()
        .threads.find((t) => t.id === thread.id)!
        .messages.filter((m) => m.role === 'tool')
        .at(-1)!.content,
      /__CPU__/,
    );
    // Ensure pending writes completed before reading/reopening.
    await ai.permission(permission);
    const stored = await readFile(join(directory, 'ai.enc'), 'utf8');
    assert.equal(stored.includes('private-test-key'), false);
    assert.equal(stored.includes('show directory'), false);
    const reloaded = new AiService(directory, store, connections);
    await reloaded.load();
    assert.equal(reloaded.snapshot().providers[0].hasKey, true);
    assert.equal(reloaded.snapshot().threads.length, 2);
  } finally {
    ssh.dispose();
    await remote.close();
    await new Promise<void>((r) => api.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('chat accepts null, omitted and empty tool calls but rejects malformed calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-chat-'));
  let calls: unknown = null;
  let chatContent = '你好';
  const api = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const correcting = JSON.parse(body).messages.at(-1).role === 'system';
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: correcting ? '当前未绑定机器，无法查询。' : chatContent,
              tool_calls: calls,
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const store = new Store(directory, {
    encrypt: async (value) => Buffer.from(value).toString('base64'),
    decrypt: async (value) => Buffer.from(value, 'base64').toString(),
  });
  const ai = new AiService(directory, store, new ConnectionRegistry(() => undefined));
  try {
    await ai.load();
    const provider = {
      id: randomUUID(),
      name: 'fixture',
      model: 'fixture',
      url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
    };
    await ai.saveProvider(provider, 'test-key');
    for (const value of [null, undefined, [], {}, [{ id: 'broken' }]]) {
      calls = value;
      const thread = await ai.create('terminal', provider.id, 'review');
      await ai.send(thread.id, 'hello');
      await until(() => ai.snapshot().threads.find((t) => t.id === thread.id)!.state !== 'running');
      const result = ai.snapshot().threads.find((t) => t.id === thread.id)!;
      const valid = value == null || (Array.isArray(value) && value.length === 0);
      assert.equal(result.state, valid ? 'idle' : 'error');
      assert.equal(
        result.messages.some((m) => m.role === 'assistant' && m.content === '你好'),
        valid,
      );
      assert.equal(
        result.messages.some((m) => m.role === 'tool'),
        false,
      );
    }
    calls = null;
    chatContent = '<tool_call><function=list_machines></function></tool_call>';
    const corrected = await ai.create('terminal', provider.id, 'review');
    await ai.send(corrected.id, '我有几台机器');
    await until(
      () => ai.snapshot().threads.find((t) => t.id === corrected.id)!.state !== 'running',
    );
    const result = ai.snapshot().threads.find((t) => t.id === corrected.id)!;
    assert.equal(result.state, 'idle');
    assert.equal(result.messages.at(-1)!.content, '当前未绑定机器，无法查询。');
    assert.equal(
      result.messages.some((m) => m.role === 'tool' || m.content.includes('<tool_call>')),
      false,
    );
    await ai.permission({
      location: 'terminal',
      providerId: provider.id,
      groups: [],
      profiles: [],
      capabilities: [],
    });
  } finally {
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('CShell inventory tools work without a bound machine, obey global grants and review revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-inventory-'));
  const store = new Store(directory, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  const requests: any[] = [];
  const api = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message:
              input.messages.at(-1).role === 'tool'
                ? { content: '查询完成' }
                : {
                    content: null,
                    tool_calls: [
                      {
                        id: randomUUID(),
                        type: 'function',
                        function: { name: 'list_machines', arguments: '{}' },
                      },
                    ],
                  },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  const registry = new ConnectionRegistry(() => undefined);
  const ai = new AiService(directory, store, registry);
  try {
    await store.saveProfile({
      id: randomUUID(),
      name: 'offline-server',
      host: '192.0.2.10',
      port: 22,
      username: 'dev',
      auth: 'password',
      group: 'Dev',
      favorite: false,
    });
    const provider = {
      id: randomUUID(),
      name: 'fixture',
      model: 'fixture',
      url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
    };
    await ai.saveProvider(provider, 'private-inventory-key');
    const thread = await ai.create('workspace', provider.id, 'restricted');
    await ai.savePolicy({ ...ai.snapshot().policy, application: ['connections.read'] });
    await ai.send(thread.id, '我有几台机器');
    await until(() => ai.snapshot().threads[0].state === 'idle');
    assert.deepEqual(
      requests[0].tools.map((t: any) => t.function.name),
      ['list_machines', 'list_sessions'],
    );
    const result = JSON.parse(
      ai
        .snapshot()
        .threads[0].messages.find((m) => m.role === 'tool')!
        .content.split('\n')
        .slice(2)
        .join('\n'),
    );
    assert.equal(result.total, 1);
    assert.equal(result.machines[0].name, 'offline-server');
    assert.deepEqual(Object.keys(result.machines[0]).sort(), [
      'group',
      'host',
      'id',
      'name',
      'port',
      'username',
    ]);
    assert.ok(!JSON.stringify(requests).includes('private-inventory-key'));
    await ai.mode(thread.id, 'review');
    await ai.send(thread.id, '再次查询');
    await until(() => ai.snapshot().threads[0].state === 'approval');
    await ai.savePolicy({ ...ai.snapshot().policy, application: [] });
    ai.approve(thread.id, ai.snapshot().threads[0].pending!.id, true);
    await until(() => ai.snapshot().threads[0].state === 'idle');
    assert.match(
      ai
        .snapshot()
        .threads[0].messages.filter((m) => m.role === 'tool')
        .at(-1)!.content,
      /revoked/,
    );
    await ai.setExtractionProvider(provider.id);
    const loaded = new AiService(directory, store, registry);
    await loaded.load();
    assert.equal(loaded.snapshot().extractionProviderId, provider.id);
    assert.deepEqual(loaded.snapshot().policy.application, []);
    await assert.rejects(ai.setExtractionProvider(randomUUID()), /Unknown AI provider/);
    await ai.deleteProvider(provider.id);
    assert.equal(ai.snapshot().extractionProviderId, null);
  } finally {
    await new Promise<void>((r) => api.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('connection extraction uses its saved model independently of chat providers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-extraction-model-'));
  const models: string[] = [];
  const api = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    models.push(JSON.parse(body).model);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                providerId: 'cshell.ssh',
                fields: { host: '192.0.2.20', username: 'dev', port: 22 },
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  const store = new Store(directory, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  const ai = new AiService(directory, store, new ConnectionRegistry(() => undefined));
  try {
    const first = {
      id: randomUUID(),
      name: 'Chat',
      model: 'chat-model',
      url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
    };
    const second = { ...first, id: randomUUID(), name: 'Extraction', model: 'extraction-model' };
    await ai.saveProvider(first);
    await ai.saveProvider(second);
    await ai.setExtractionProvider(second.id);
    const loaded = new AiService(directory, store, new ConnectionRegistry(() => undefined));
    await loaded.load();
    await loaded.extractConnection('ssh dev@192.0.2.20');
    await loaded.extractConnection('ssh dev@192.0.2.20', first.id);
    assert.deepEqual(models, ['extraction-model', 'chat-model']);
    assert.equal(loaded.snapshot().extractionProviderId, second.id);
  } finally {
    await new Promise<void>((r) => api.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});
