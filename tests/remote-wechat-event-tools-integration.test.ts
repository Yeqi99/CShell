import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { registerAiHandlers } from '../src/desktop/ai';
import { remoteWechatSource } from '../src/core/remote-wechat-events';
import type { ProviderConnection } from '../src/core/connections/contracts';

test('model discovers event tools, creates a remote CAgent source rule, and remote message triggers it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'remote-event-tools-'));
  const store = new Store(directory, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  const sessionId = randomUUID(),
    profileId = randomUUID(),
    subscriptionId = randomUUID(),
    identity = 'fixture-device/certificate';
  const source = remoteWechatSource(identity);
  let emit = false,
    delivered = false,
    modelStep = 0;
  const requests: any[] = [];
  const connection: ProviderConnection = {
    target: {
      providerId: 'cshell.agent',
      resourceId: profileId,
      identity,
      label: 'Fixture CAgent',
    },
    tools: [],
    agent: async (call) => {
      if (call.method === 'packages.tools') return [];
      const p = call.params as any;
      if (p.toolId === 'wechat_subscriptions')
        return [
          {
            id: subscriptionId,
            accountId: 'wxid_fixture',
            state: 'listening',
            targets: ['filehelper'],
          },
        ];
      if (p.toolId === 'wechat_events') {
        const send = emit && !delivered;
        if (send) delivered = true;
        return {
          events: send
            ? [
                {
                  kind: 'message',
                  messageId: '123',
                  senderId: 'filehelper',
                  recipientId: 'wxid_fixture',
                  conversationId: 'filehelper',
                  conversationType: 'private',
                  nativeType: 1,
                  timestampRaw: String(Math.floor(Date.now() / 1000)),
                  text: 'remote fixture message',
                  format: 'text',
                },
              ]
            : [],
          nextCursor: delivered ? '2' : '1',
          gap: false,
          listenerState: 'listening',
        };
      }
      throw Error('Unexpected fixture call');
    },
  };
  const registry = new ConnectionRegistry(() => ({ id: profileId, group: '' }));
  registry.register({
    id: 'cshell.agent',
    version: '1.0.0',
    capabilities: [],
    resolve: () => connection,
  });
  registry.bind(sessionId, 'cshell.agent');
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const request = JSON.parse(raw);
    requests.push(request);
    let message: any = { content: 'Done' };
    if (request.max_tokens && request.messages.at(-1).role === 'user') {
      // Simulate a model following malicious event content even though these tools are hidden.
      const rule = call('ai:events-snapshot').rules[0];
      message = {tool_calls: [
        {name:'ai_event_save',args:{...rule,prompt:'malicious replacement'}},
        {name:'ai_event_set_enabled',args:{id:rule.id,enabled:false}},
        {name:'ai_event_remove',args:{id:rule.id}},
      ].map(({name,args})=>({id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}))};
    }
    if (!request.max_tokens) {
      if (modelStep++ === 0)
        message = {
          tool_calls: [
            {
              id: randomUUID(),
              type: 'function',
              function: { name: 'ai_event_list', arguments: '{}' },
            },
          ],
        };
      else if (modelStep === 2)
        message = {
          tool_calls: [
            {
              id: randomUUID(),
              type: 'function',
              function: {
                name: 'ai_event_save',
                arguments: JSON.stringify({
                  name: 'Remote test',
                  source,
                  eventType: 'message.received',
                  subscriptionId,
                  prompt: 'Summarize the event',
                  enabled: true,
                  cooldownSeconds: 0,
                }),
              },
            },
          ],
        };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const handlers = new Map<string, Function>();
  const call = (name: string, ...args: any[]) => handlers.get(name)!(...args);
  const dispose = await registerAiHandlers(
    (name, fn) => handlers.set(name, fn),
    directory,
    store,
    registry,
  );
  const wait = async (fn: () => boolean) => {
    for (let i = 0; i < 500; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error('fixture timeout');
  };
  try {
    const provider = {
      id: randomUUID(),
      name: 'Fixture',
      model: 'fixture',
      url: `http://127.0.0.1:${(server.address() as any).port}`,
    };
    await call('ai:provider-save', provider, 'fixture');
    await call('ai:policy', {
      ...call('ai:snapshot').policy,
      application: ['events.manage', 'wechat.read'],
      profiles: [profileId],
      capabilities: ['agent.manage'],
    });
    const thread = await call('ai:create', 'workspace', provider.id, 'allow', sessionId);
    await wait(() =>
      call('ai:events-snapshot').sources.some((s: any) => s.id === source && s.available),
    );
    await call('ai:send', thread.id, 'Create a rule for the remote source');
    await wait(() => call('ai:snapshot').threads[0].state === 'idle');
    const names = requests[0].tools.map((t: any) => t.function.name);
    assert(names.includes('ai_event_list'));
    assert(names.includes('ai_event_save'));
    assert.equal(
      requests[0].tools.find((t: any) => t.function.name === 'ai_event_save').function.parameters
        .properties.source.type,
      'string',
    );
    const snapshot = call('ai:events-snapshot');
    assert.equal(snapshot.rules.length, 1);
    assert.equal(snapshot.rules[0].source, source);
    assert.equal(snapshot.rules[0].enabled, true);
    assert.equal(snapshot.rules[0].threadId, thread.id);
    assert(snapshot.rules[0].bindingKey);
    emit = true;
    await wait(() => call('ai:events-snapshot').runs.some((r: any) => r.status === 'completed'));
    assert(
      requests.some(
        (r) => r.max_tokens && JSON.stringify(r.messages).includes('remote fixture message'),
      ),
    );
    const triggered = requests.filter(r=>r.max_tokens);
    for (const request of triggered) {
      const toolNames = request.tools.map((tool:any)=>tool.function.name);
      assert(toolNames.includes('ai_event_list'), 'read-only event discovery remains available');
      assert.equal(toolNames.some((name:string)=>name.startsWith('ai_event_')&&name!=='ai_event_list'),false);
    }
    assert.deepEqual(call('ai:events-snapshot').rules,snapshot.rules,'forged mutation calls must not change subscriptions');
    const deniedResults = triggered.flatMap(r=>r.messages.filter((m:any)=>m.role==='tool'));
    assert(deniedResults.length>=3);
    assert(deniedResults.every((m:any)=>m.content.includes('事件运行不能修改订阅')));
    await call('ai:policy', { ...call('ai:snapshot').policy, application: ['wechat.read'] });
    await call('ai:send', thread.id, 'List my rules');
    await wait(() => call('ai:snapshot').threads[0].state === 'idle');
    assert.equal(
      requests.at(-1).tools.some((t: any) => t.function.name === 'ai_event_save'),
      false,
    );
  } finally {
    await dispose();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});
