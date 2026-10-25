import type { Terminal, IDisposable, IMarker } from '@xterm/xterm';

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
  type PaintedLine = { marker: IMarker; signature: string; decorations: IDisposable[] };
  const lines = new Map<number, PaintedLine>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remove = (y: number) => {
    const previous = lines.get(y);
    if (!previous) return;
    previous.decorations.forEach(entry => entry.dispose());
    previous.marker.dispose();
    lines.delete(y);
  };
  const clear = () => { for (const y of lines.keys()) remove(y); };
  const paint = () => {
    timer = undefined;
    const buffer = terminal.buffer.active;
    if (buffer.type !== 'normal') { clear(); return; }
    for (const [y, previous] of lines) {
      if (y < buffer.viewportY || y >= buffer.viewportY + terminal.rows || previous.marker.isDisposed || previous.marker.line !== y) remove(y);
    }
    for (let y = buffer.viewportY; y < buffer.viewportY + terminal.rows; y++) {
      const line = buffer.getLine(y);
      const spans = line ? terminalColorSpans(line.translateToString(false)) : [];
      // Most output has no semantic colors. Avoid allocating a cell and an
      // offset object for every column of every log line after each keypress.
      if (!line || !spans.length) { remove(y); continue; }
      let offset = 0;
      const offsets: Array<{ x: number; start: number; end: number; width: number; plain: boolean }> = [];
      const last = Math.max(...spans.map(span => span.end));
      for (let x = 0; x < line.length && offset < last; x++) {
        const cell = line.getCell(x);
        if (!cell || !cell.getWidth()) continue;
        const start = offset;
        offset += (cell.getChars() || ' ').length;
        offsets.push({ x, start, end: offset, width: cell.getWidth(), plain: cell.isFgDefault() && cell.isBgDefault() && !cell.isInverse() });
      }
      const ranges: Array<{ x: number; width: number; kind: 'prompt' | 'url' }> = [];
      for (const span of spans) {
        const cells = offsets.filter(cell => cell.start >= span.start && cell.end <= span.end && cell.plain);
        for (let i = 0; i < cells.length;) {
          const first = cells[i++];
          let end = first.x + first.width;
          while (i < cells.length && cells[i].x === end) { end += cells[i++].width; }
          ranges.push({ x: first.x, width: end - first.x, kind: span.kind });
        }
      }
      const signature = JSON.stringify(ranges);
      if (lines.get(y)?.signature === signature) continue;
      remove(y);
      if (!ranges.length) continue;
      const marker = terminal.registerMarker(y - buffer.baseY - buffer.cursorY);
      if (!marker) continue;
      const decorations: IDisposable[] = [];
      for (const range of ranges) {
        const decoration = terminal.registerDecoration({ marker, x: range.x, width: range.width, layer: 'bottom', foregroundColor: range.kind === 'url' ? (dark ? '#79B7FF' : '#225FC2') : (dark ? '#80CDBB' : '#16705D') });
        if (decoration) decorations.push(decoration);
      }
      lines.set(y, { marker, signature, decorations });
    }
  };
  const schedule = () => { if (!timer) timer = setTimeout(paint, 80); };
  const listeners = [terminal.onWriteParsed(schedule), terminal.onScroll(schedule), terminal.onResize(schedule), terminal.buffer.onBufferChange(schedule)];
  schedule();
  return () => { if (timer) clearTimeout(timer); listeners.forEach(listener => listener.dispose()); clear(); };
}
