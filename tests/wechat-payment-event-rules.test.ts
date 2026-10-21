import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiEventService } from '../src/core/ai-events';
import { aiEventTools } from '../src/core/ai-event-tools';
import { wechatEventTypes } from '../src/shared/wechat-events';
import type { AiPluginEvent } from '../src/shared/ai-events';

test('payment event rules are discoverable and tool-manageable for local and remote sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wechat-payment-rules-'));
  const sources = ['wechat', 'wechat.remote.fixture'];
  let authorized = true;
  const executed: AiPluginEvent[] = [];
  const service = new AiEventService({ path: join(directory, 'events.json'),
    codec: { encrypt: s => s, decrypt: s => s }, host: {
      sources: () => sources.map(id => ({ id, name: id, available: true, eventTypes: wechatEventTypes() })),
      authorize: () => authorized,
      execute: async ({ event }) => { executed.push(event); },
    },
  });
  try {
    await service.init();
    const tools = () => aiEventTools({ snapshot: () => service.snapshot(), save: rule => service.save(rule), remove: id => service.remove(id) }, randomUUID());
    const invoke = async (name: string, args: unknown) => {
      const tool = tools().find(t => t.name === name)!;
      return JSON.parse(await tool.invoke(tool.input.parse(args), new AbortController().signal) as string);
    };
    const snapshot = await invoke('ai_event_list', {});
    for (const source of snapshot.sources) assert.deepEqual(source.eventTypes.map((t: {id: string}) => t.id), ['message.received', 'transfer.received', 'red_packet.received']);
    for (const source of sources) {
      for (const type of ['transfer.received', 'red_packet.received']) {
        const rule = await invoke('ai_event_save', { name: type, source, eventType: type, enabled: true,
          prompt: 'Record the notification only', cooldownSeconds: 0 });
        assert.equal(rule.eventType, type);
        const event: AiPluginEvent = { id: randomUUID(), source, type, accountId: 'account', subscriptionId: 'listener',
          senderId: 'sender', conversationId: 'sender', isSelf: false, isGroup: false, occurredAt: Date.now(), payload: { amountMinor: type === 'transfer.received' ? 10 : null } };
        assert.equal((await service.ingest(event)).accepted, 1);
        assert.equal((await service.ingest(event)).duplicate, true);
        for (let attempt = 0; attempt < 100 && !executed.some(item => item.id === event.id); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(executed.filter(item => item.id === event.id).length, 1);
        await invoke('ai_event_set_enabled', { id: rule.id, enabled: false });
        assert.equal((await service.ingest({ ...event, id: randomUUID() })).accepted, 0);
        await invoke('ai_event_set_enabled', { id: rule.id, enabled: true });
        authorized = false;
        assert.equal((await service.ingest({ ...event, id: randomUUID() })).accepted, 0);
        authorized = true;
        await invoke('ai_event_remove', { id: rule.id });
      }
    }
    await assert.rejects(() => invoke('ai_event_save', { name: 'unsupported', source: 'wechat', eventType: 'payment.claim', enabled: true, prompt: 'x' }), /事件来源当前不可用/);
    // Neither creating nor toggling a rule starts a WeChat listener or invokes a payment action.
    assert(executed.every(event => ['transfer.received', 'red_packet.received'].includes(event.type)));
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});
