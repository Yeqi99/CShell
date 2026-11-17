import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toolBatches} from '../src/core/tool-batches';

test('parallel reads keep order, bounded fan-out and barriers for commands and approvals', () => {
  const sequence = ['a','b','c','d','e','command','f','g','approval'];
  assert.deepEqual([...toolBatches(sequence, name => name.length === 1)], [
    ['a','b','c','d'],['e'],['command'],['f','g'],['approval'],
  ]);
  assert.deepEqual([...toolBatches(sequence, () => false)], sequence.map(name => [name]));
});
