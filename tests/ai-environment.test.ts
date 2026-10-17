import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { AiService } from '../src/core/ai';
import { Store } from '../src/core/store';
import { ConnectionRegistry } from '../src/core/connections/registry';

test('runtime context, bounded progress continuation and private base configuration tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-ai-context-'));
  const store = new Store(directory, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  const profileId = randomUUID(),
    sessionId = randomUUID();
  const registry = new ConnectionRegistry(() => ({ id: profileId, group: '' }));
  const connection = {
    target: {
      providerId: 'test.machine',
      resourceId: profileId,
      identity: 'fixture',
      label: 'Remote Linux fixture',
    },
    tools: [
      {
        name: 'read_file',
        capability: 'files.read',
        description: 'fixture read',
        input: z.object({ path: z.string() }),
        needsReview: () => false,
        invoke: async () => '{"key":"never-expose-this-secret"}',
      },
    ],
  };
  registry.register({
    id: 'test.machine',
    version: '1.0.0',
    capabilities: ['files.read'],
    resolve: () => connection,
  });
  registry.bind(sessionId, 'test.machine');
  let mode = 'plan',
    args: any,
    callName = 'save_ai_provider';
  const requests: any[] = [];
  const api = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const input = JSON.parse(raw);
    requests.push(input);
    const last = input.messages.at(-1);
    const message =
      mode === 'plan'
        ? { content: '先验证当前环境，再配置基座。' }
        : last.role === 'tool'
          ? { content: '操作结果已返回。' }
          : {
              content: null,
              tool_calls: [
                {
                  id: randomUUID(),
                  type: 'function',
                  function: { name: callName, arguments: JSON.stringify(args) },
                },
              ],
            };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  const ai = new AiService(directory, store, registry);
  const base = {
    id: randomUUID(),
    name: 'fixture',
    model: 'fixture',
    url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
  };
  const wait = async (id: string, state: string) => {
    for (let i = 0; i < 250; i++) {
      const t = ai.snapshot().threads.find((t) => t.id === id)!;
      if (t.state === state) return t;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Timeout waiting for ' + state);
  };
  const send = async () => {
    const t = await ai.create('terminal', base.id, 'allow', sessionId);
    await ai.send(t.id, '执行请求');
    return t.id;
  };
  try {
    await ai.saveProvider(base, 'existing-private-key');
    await ai.savePolicy({
      ...ai.snapshot().policy,
      application: ['ai.providers.manage'],
      profiles: [profileId],
      capabilities: ['files.read'],
    });
    const plan = await wait(await send(), 'error');
    assert.match(plan.error!, /没有调用工具/);
    assert.equal(requests.length, 2);
    assert.match(requests[0].messages[1].content, new RegExp(process.platform));
    assert.match(requests[0].messages[1].content, /Remote Linux fixture/);
    assert.match(requests[0].messages[1].content, /INSIDE CShell/);
    mode = 'tool';
    args = {
      name: 'Imported model',
      model: 'model-b',
      url: base.url,
      credential: { source: 'bound-file', path: '/config/key.json', jsonField: 'key' },
    };
    const id = await send();
    const approval = await wait(id, 'approval');
    assert.equal(ai.snapshot().providers.length, 1);
    ai.approve(id, approval.pending!.id, true);
    await wait(id, 'idle');
    assert.equal(ai.snapshot().providers.length, 2);
    assert.equal(ai.snapshot().providers.find((p) => p.name === 'Imported model')!.hasKey, true);
    assert.equal(JSON.stringify(requests).includes('never-expose-this-secret'), false);
    assert.equal(JSON.stringify(ai.snapshot()).includes('never-expose-this-secret'), false);
    args = {
      name: 'Cross origin',
      model: 'model-b',
      url: 'https://example.invalid/v1',
      credential: { source: 'provider', providerId: base.id },
    };
    const cross = await send();
    const review = await wait(cross, 'approval');
    ai.approve(cross, review.pending!.id, true);
    assert.match(
      (await wait(cross, 'idle')).messages.find((m) => m.tool)!.content,
      /相同 API 来源/,
    );
    assert.equal(ai.snapshot().providers.length, 2);
    const revoked = await send();
    const pending = await wait(revoked, 'approval');
    await ai.savePolicy({ ...ai.snapshot().policy, application: [] });
    ai.approve(revoked, pending.pending!.id, true);
    assert.match((await wait(revoked, 'idle')).messages.find((m) => m.tool)!.content, /revoked/);
    callName = 'list_ai_providers';
    args = {};
    const denied = await send();
    await wait(denied, 'idle');
    assert.ok(!requests.at(-2).tools?.some((t: any) => t.function.name === 'list_ai_providers'));
    assert.equal(JSON.stringify(requests).includes('existing-private-key'), false);
  } finally {
    ai.dispose();
    await ai.flush();
    await new Promise<void>((r) => api.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});
