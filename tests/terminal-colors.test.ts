import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installTerminalColors, terminalColorSpans } from '../src/ui/terminal-colors';
import type { Terminal } from '@xterm/xterm';

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

test('reuses unchanged decorations, skips plain log cells and respects ANSI colors', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const events = new Map<string, () => void>();
  const listen = (name: string) => (callback: () => void) => {
    events.set(name, callback);
    return { dispose: () => { events.delete(name); } };
  };
  const rows = ['root@host:~# ', 'plain log output', 'https://example.com'];
  const colored = new Set<number>();
  let cellReads = 0, created = 0, removed = 0;
  const markers: Array<{ line: number; isDisposed: boolean; dispose(): void }> = [];
  const buffer = {
    type: 'normal', viewportY: 0, baseY: 0, cursorY: 0,
    getLine: (y: number) => rows[y] === undefined ? undefined : ({
      length: rows[y].length,
      translateToString: (trimRight: boolean) => trimRight ? rows[y].trimEnd() : rows[y],
      getCell: (x: number) => {
        cellReads++;
        assert.notEqual(y, 1, 'plain log rows must not require per-cell scanning');
        return { getWidth: () => 1, getChars: () => rows[y][x], isFgDefault: () => !colored.has(y), isBgDefault: () => true, isInverse: () => false };
      },
    }),
  };
  const terminal = {
    rows: 3, buffer: { active: buffer, onBufferChange: listen('buffer') },
    onWriteParsed: listen('write'), onScroll: listen('scroll'), onResize: listen('resize'),
    registerMarker: (line: number) => {
      const marker = { line, isDisposed: false, dispose() { this.isDisposed = true; } };
      markers.push(marker); return marker;
    },
    registerDecoration: () => { created++; return { dispose() { removed++; } }; },
  } as unknown as Terminal;
  const dispose = installTerminalColors(terminal, false);
  context.mock.timers.tick(80);
  assert.equal(created, 2);
  assert.ok(cellReads > 0);
  rows[0] += ' -l'; // Typing after the prompt must not rebuild unchanged colors.
  for (let i = 0; i < 30; i++) { events.get('write')!(); context.mock.timers.tick(80); }
  assert.equal(created, 2);
  assert.equal(removed, 0);
  colored.add(2);
  events.get('write')!(); context.mock.timers.tick(80);
  assert.equal(removed, 1, 'remote ANSI color takes precedence');
  buffer.viewportY = 1;
  events.get('scroll')!(); context.mock.timers.tick(80);
  assert.equal(removed, 2);
  buffer.viewportY = 0;
  events.get('scroll')!(); context.mock.timers.tick(80);
  assert.equal(created, 3);
  buffer.type = 'alternate';
  events.get('buffer')!(); context.mock.timers.tick(80);
  assert.equal(removed, 3, 'full-screen applications are never decorated');
  dispose();
  assert.equal(events.size, 0);
  assert.ok(markers.every(marker => marker.isDisposed));
});
