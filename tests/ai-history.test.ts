import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationHistory, conversationStatus } from '../src/ui/ai-history';
import type { AiThread } from '../src/shared/ai';
const make = (id: string, time: number, state: AiThread['state']): AiThread => ({
  id, title: id, providerId: 'test', mode: 'review', location: 'workspace', state,
  messages: [{ role: 'user', content: id, time }],
});
test('active history is discoverable, sorted without mutating source; target search works', () => {
  const list = [make('old', 1, 'idle'), make('new', 9, 'idle'), make('working', 2, 'running')];
  list[0].target = 'US machine';
  assert.deepEqual(conversationHistory(list, '').map(t => t.id), ['working', 'new', 'old']);
  assert.deepEqual(list.map(t => t.id), ['old', 'new', 'working']);
  assert.deepEqual(conversationHistory(list, ' US ').map(t => t.id), ['old']);
  assert.equal(conversationStatus(make('waiting', 1, 'approval')), '等待审核');
});
