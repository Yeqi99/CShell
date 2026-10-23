import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminalColorSpans } from '../src/ui/terminal-colors';

test('recognizes prompt and multiple links without coloring arbitrary log prefixes', () => {
  const text = 'root@host:~# curl https://example.com/a https://example.net/b';
  const spans = terminalColorSpans(text);
  assert.deepEqual(spans.map(span => text.slice(span.start, span.end)), ['root@host:~# ', 'https://example.com/a', 'https://example.net/b']);
  assert.deepEqual(terminalColorSpans('Password: '), []);
  assert.deepEqual(terminalColorSpans('log: error message'), []);
});

test('keeps unicode offsets and strips prose punctuation', () => {
  const text = '下载：https://example.com/目录。';
  const [span] = terminalColorSpans(text);
  assert.equal(span.start, 3);
  assert.equal(span.kind, 'url');
  assert.equal(terminalColorSpans('[user@host ~]$ ls')[0].kind, 'prompt');
});
