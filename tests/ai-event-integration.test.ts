import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Store } from '../src/core/store';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { registerAiHandlers } from '../src/desktop/ai';
import { aiEventRuleSchema } from '../src/shared/ai-events';
import { WechatService } from '../src/core/wechat';
import { builtinPlugins } from '../src/shared/plugins';

test('plugin event reaches configured AI without prior history; duplicate and revoked events never call model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-event-integration-'));
  const store = new Store(directory, { encrypt: async s => Buffer.from(s).toString('base64'), decrypt: async s => Buffer.from(s, 'base64').toString() });
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw); requests.push(request);
    res.setHeader('content-type', 'application/json');
    const checkTool = request.tools?.find((tool: any) => tool.function.name === 'wechat_status');
    const message = checkTool && request.messages.at(-1).role === 'user' && request.max_tokens
      ? { content: null, tool_calls: [{ id: randomUUID(), type: 'function', function: { name: 'wechat_status', arguments: '{}' } }] }
      : { content: 'Recorded event.' };
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let permitted = true;
  const definitions = new WechatService(directory, { plugins: () => builtinPlugins.map(manifest => ({manifest, enabled:true, source:'builtin'})) } as any).tools();
  const wechat: any = {
    tools: () => definitions.length ? definitions.map(tool => ({...tool, invoke: async () => '{}'})) : [{ name: 'wechat_events', capability: 'wechat.read', description: 'Read messages', input: z.object({}), needsReview: () => false, invoke: async () => '{}' }],
    eventSource: () => ({ id: 'wechat', name: 'WeChat fixture', eventTypes: [{ id: 'message.received', name: 'Message' }], available: true }),
    eventAuthorized: () => permitted,
    subscriptions: { list: () => [{ id: 'subscription-fixture', state: 'listening', targets: ['filehelper'] }], onMessage: undefined },
  };
  const handlers = new Map<string, (...args: any[]) => any>();
  const call = (name: string, ...args: any[]) => handlers.get(name)!(...args);
  const register = () => registerAiHandlers((name, fn) => handlers.set(name, fn), directory, store, new ConnectionRegistry(() => undefined), undefined, undefined, undefined, wechat);
  let dispose = await register();
  const wait = async (condition: () => boolean) => {
    for (let i = 0; i < 250; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 20)); }
    throw new Error('Integration timed out: ' + JSON.stringify(call('ai:events-snapshot')));
  };
  const emit = (id: string) => wechat.subscriptions.onMessage({ id: 'subscription-fixture', accountId: 'wxid_fixture', event: {
    kind: 'message', messageId: id, senderId: 'filehelper', recipientId: 'wxid_fixture', conversationId: 'filehelper', conversationType: 'private',
    nativeType: 1, timestampRaw: String(Math.floor(Date.now() / 1000)), text: 'Event fixture message', format: 'text', rawSecret: 'must-not-leak',
  } });
  try {
    const provider = { id: randomUUID(), name: 'fixture', model: 'fixture', url: `http://127.0.0.1:${(server.address() as any).port}/v1` };
    await call('ai:provider-save', provider, 'fixture-key');
    await call('ai:policy', { ...call('ai:snapshot').policy, application: ['wechat.read'] });
    const thread = await call('ai:create', 'workspace', provider.id, 'allow');
    await call('ai:send', thread.id, 'Prior private conversation must not enter event prompt');
    await wait(() => call('ai:snapshot').threads.find((t: any) => t.id === thread.id).state === 'idle');
    requests.length = 0;
    const rule = aiEventRuleSchema.parse({ id: randomUUID(), name: 'Fixture', enabled: true, source: 'wechat', eventType: 'message.received', threadId: thread.id,
      prompt: 'Summarize this event only.', cooldownSeconds: 0, reservedTokensPerRun: 32768, maxReservedTokensPerDay: 200000 });
    await call('ai:event-save', rule);
    emit('101');
    await wait(() => call('ai:events-snapshot').runs.some((r: any) => r.status === 'completed'));
    const callsPerRun = definitions.length ? 2 : 1;
    assert.equal(requests.length, callsPerRun);
    assert.equal(requests[0].max_tokens, 512);
    const body = JSON.stringify(requests[0]);
    assert.match(body, /Event fixture message/);
    assert.doesNotMatch(body, /Prior private conversation|must-not-leak/);
    emit('101'); emit('102');
    await wait(() => call('ai:events-snapshot').runs.filter((r: any) => r.status === 'completed').length === 2);
    assert.equal(requests.length, callsPerRun * 2);
    permitted = false; emit('103');
    await wait(() => call('ai:events-snapshot').runs.some((r: any) => r.eventId.endsWith(':103') && r.status === 'skipped'));
    assert.equal(requests.length, callsPerRun * 2);
    permitted = true;
    await call('ai:event-save', { ...rule, reservedTokensPerRun: 1024 }); emit('104');
    await wait(() => call('ai:events-snapshot').runs.some((r: any) => r.eventId.endsWith(':104') && r.status === 'failed'));
    assert.equal(requests.length, callsPerRun * 2, 'budget stops before model call');
    await dispose();
    const file = join(directory, 'ai.enc');
    const saved = JSON.parse(Buffer.from(await readFile(file, 'utf8'), 'base64').toString());
    saved.threads[0].messages.push(...Array.from({length: 500}, (_, i) => ({role:'assistant',content:'Old event '+i,time:Date.now(),eventGenerated:true})));
    await writeFile(file, Buffer.from(JSON.stringify(saved)).toString('base64'));
    dispose = await register();
    await call('ai:event-save', rule); emit('105');
    await wait(() => call('ai:events-snapshot').runs.some((r: any) => r.eventId.endsWith(':105') && r.status === 'completed'));
    const history = call('ai:snapshot').threads[0].messages;
    assert(history.some((m: any) => m.content === 'Prior private conversation must not enter event prompt'));
    assert(history.filter((m: any) => m.eventGenerated).length <= 125, 'old event details are bounded without deleting manual history');
    emit('101');
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(requests.length, callsPerRun * 3, 'restart retains deduplication');
  } finally {
    await dispose(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true });
  }
});
