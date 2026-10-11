import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Eye, Keyboard, Pin, PinOff, Maximize2, X } from 'lucide-react';
import type { SessionEvent } from '../../shared/contracts';
import '@xterm/xterm/css/xterm.css';

export function FloatingTerminal() {
  const host = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null);
  const [label, setLabel] = useState('CShell'),
    [readOnly, setReadOnly] = useState(false);
  const [pinned, setPinned] = useState(false),
    [closed, setClosed] = useState(false);
  const [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const [cn, setCn] = useState(true);
  const fail = (error: unknown) => setError(error instanceof Error ? error.message : String(error));
  useEffect(() => {
    let disposed = false,
      initialized = false,
      sequence = 0;
    const queued: SessionEvent[] = [];
    const fit = new FitAddon();
    const term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      scrollback: 10000,
      cursorBlink: true,
    });
    terminal.current = term;
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    // The main view answers device queries once for the shared PTY. Suppress
    // replies in mirrors through the public parser API, preserving IME input.
    const queryHandlers = [
      ...[
        { final: 'c' },
        { prefix: '>', final: 'c' },
        { final: 'n' },
        { prefix: '?', final: 'n' },
        { intermediates: '$', final: 'p' },
        { prefix: '?', intermediates: '$', final: 'p' },
      ].map((id) => term.parser.registerCsiHandler(id, () => true)),
      term.parser.registerCsiHandler({ final: 't' }, (params) =>
        [14, 16, 18].includes(Number(params[0])),
      ),
      term.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => true),
      ...[4, 10, 11, 12].map((id) =>
        term.parser.registerOscHandler(id, (value) => value.split(';').includes('?')),
      ),
    ];
    const receive = (event: SessionEvent) => {
      if (!initialized) {
        queued.push(event);
        return;
      }
      if (event.type === 'data' && (event.sequence || 0) > sequence) {
        sequence = event.sequence!;
        term.write(event.data);
      } else if (event.type === 'closed') {
        setClosed(true);
        term.options.disableStdin = true;
      }
    };
    const unsubscribe = window.cshell.onFloatingEvent(receive);
    const data = term.onData((value) => {
      if (!term.options.disableStdin) void window.cshell.floatingInput(value).catch(fail);
    });
    const resize = term.onResize((size) => {
      if (initialized) void window.cshell.floatingResize(size.cols, size.rows).catch(fail);
    });
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        event.shiftKey &&
        ['C', 'V'].includes(event.key.toUpperCase())
      ) {
        event.preventDefault();
        if (event.key.toUpperCase() === 'C')
          void window.cshell.floatingCopy(term.getSelection()).catch(fail);
        else if (!term.options.disableStdin)
          void window.cshell
            .floatingPaste()
            .then((text) => term.paste(text))
            .catch(fail);
        return false;
      }
      return true;
    });
    const observer = new ResizeObserver(() => {
      if (initialized && host.current?.clientWidth) fit.fit();
    });
    void window.cshell
      .floatingInit()
      .then((state) => {
        if (disposed) return;
        setLabel(state.label);
        setReadOnly(state.readOnly);
        setClosed(state.closed);
        setCn(state.preferences.locale === 'zh-CN');
        document.documentElement.dataset.theme = state.preferences.theme;
        term.options.fontFamily = state.preferences.terminalFont;
        term.options.fontSize = state.preferences.fontSize;
        term.options.lineHeight = state.preferences.lineHeight;
        term.options.theme = state.snapshot.theme;
        host.current!.style.setProperty(
          '--floating-background',
          state.snapshot.theme.background || 'var(--terminal)',
        );
        term.options.disableStdin = state.readOnly || state.closed;
        term.resize(state.snapshot.cols, state.snapshot.rows);
        term.open(host.current!);
        sequence = state.snapshot.sequence;
        term.write(state.snapshot.data, () => {
          if (disposed) return;
          initialized = true;
          state.tail.forEach((chunk) =>
            receive({ type: 'data', sessionId: state.sessionId, ...chunk }),
          );
          queued.forEach(receive);
          queued.length = 0;
          // Resize after the complete snapshot and tail have been parsed.
          term.write('', () => {
            if (!disposed) {
              fit.fit();
              term.focus();
              setReady(true);
              observer.observe(host.current!);
            }
          });
        });
      })
      .catch(fail);
    return () => {
      disposed = true;
      unsubscribe();
      queryHandlers.forEach((handler) => handler.dispose());
      observer.disconnect();
      data.dispose();
      resize.dispose();
      term.dispose();
    };
  }, []);
  const mode = async () => {
    try {
      await window.cshell.floatingMode(!readOnly);
      setReadOnly(!readOnly);
      if (terminal.current) terminal.current.options.disableStdin = !readOnly || closed;
      setError('');
    } catch (error) {
      fail(error);
    }
  };
  return (
    <main className="floating-terminal">
      <header className="floating-bar">
        <span className="floating-label">
          {label}
          {closed
            ? cn
              ? ' · 已断开'
              : ' · Disconnected'
            : readOnly
              ? cn
                ? ' · 仅观察'
                : ' · Read only'
              : ''}
        </span>
        <button
          className="icon"
          disabled={!ready || closed}
          aria-label={readOnly ? (cn ? '允许输入' : 'Enable input') : cn ? '仅观察' : 'Read only'}
          title={readOnly ? (cn ? '允许输入' : 'Enable input') : cn ? '仅观察' : 'Read only'}
          aria-pressed={readOnly}
          onClick={() => void mode()}
        >
          {readOnly ? <Eye size={14} /> : <Keyboard size={14} />}
        </button>
        <button
          className="icon"
          aria-label={pinned ? (cn ? '取消置顶' : 'Unpin') : cn ? '窗口置顶' : 'Pin window'}
          title={pinned ? (cn ? '取消置顶' : 'Unpin') : cn ? '窗口置顶' : 'Pin window'}
          aria-pressed={pinned}
          onClick={() => void window.cshell.floatingPin(!pinned).then(setPinned).catch(fail)}
        >
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button
          className="icon"
          aria-label={cn ? '返回工作台' : 'Restore workbench'}
          title={cn ? '返回工作台' : 'Restore workbench'}
          onClick={() => void window.cshell.floatingRestore().catch(fail)}
        >
          <Maximize2 size={14} />
        </button>
        <button
          className="icon"
          aria-label={cn ? '关闭小窗' : 'Close window'}
          title={cn ? '关闭小窗（保持连接）' : 'Close window (keep connection)'}
          onClick={() => void window.cshell.floatingClose().catch(fail)}
        >
          <X size={14} />
        </button>
      </header>
      {error && (
        <div className="floating-error" role="alert">
          {error}
        </div>
      )}
      <div className="floating-screen" ref={host} />
    </main>
  );
}
