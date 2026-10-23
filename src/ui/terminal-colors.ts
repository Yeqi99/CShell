import type { Terminal, IDisposable } from '@xterm/xterm';

export function terminalColorSpans(text: string) {
  const spans: Array<{ start: number; end: number; kind: 'prompt' | 'url' }> = [];
  const prompt = text.match(/^(?:\[[\w.-]+@[\w.-]+[^\]\r\n]*\]|[\w.-]+@[\w.-]+:[^\r\n]*?)[#$]\s/);
  if (prompt) spans.push({ start: 0, end: prompt[0].length, kind: 'prompt' });
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const value = match[0].replace(/[),.;\]]+$/, '');
    spans.push({ start: match.index!, end: match.index! + value.length, kind: 'url' });
  }
  return spans;
}

// Decorate visible, default-colored cells only. Never change PTY data, selection or snapshots.
export function installTerminalColors(terminal: Terminal, dark: boolean) {
  let entries: IDisposable[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { entries.forEach(entry => entry.dispose()); entries = []; };
  const paint = () => {
    timer = undefined;
    clear();
    const buffer = terminal.buffer.active;
    if (buffer.type !== 'normal') return;
    for (let y = buffer.viewportY; y < buffer.viewportY + terminal.rows; y++) {
      const line = buffer.getLine(y);
      if (!line) continue;
      let text = '';
      const offsets: Array<{ x: number; start: number; end: number; width: number; plain: boolean }> = [];
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x);
        if (!cell || !cell.getWidth()) continue;
        const start = text.length;
        text += cell.getChars() || ' ';
        offsets.push({ x, start, end: text.length, width: cell.getWidth(), plain: cell.isFgDefault() && cell.isBgDefault() && !cell.isInverse() });
      }
      for (const span of terminalColorSpans(text)) {
        const cells = offsets.filter(cell => cell.start >= span.start && cell.end <= span.end && cell.plain);
        for (let i = 0; i < cells.length;) {
          const first = cells[i++];
          let end = first.x + first.width;
          while (i < cells.length && cells[i].x === end) { end += cells[i++].width; }
          const marker = terminal.registerMarker(y - buffer.baseY - buffer.cursorY);
          if (!marker) continue;
          entries.push(marker);
          const decoration = terminal.registerDecoration({ marker, x: first.x, width: end - first.x, layer: 'bottom', foregroundColor: span.kind === 'url' ? (dark ? '#79B7FF' : '#225FC2') : (dark ? '#80CDBB' : '#16705D') });
          if (decoration) entries.push(decoration);
        }
      }
    }
  };
  const schedule = () => { if (!timer) timer = setTimeout(paint, 80); };
  const listeners = [terminal.onWriteParsed(schedule), terminal.onScroll(schedule), terminal.onResize(schedule), terminal.buffer.onBufferChange(schedule)];
  schedule();
  return () => { if (timer) clearTimeout(timer); listeners.forEach(listener => listener.dispose()); clear(); };
}
