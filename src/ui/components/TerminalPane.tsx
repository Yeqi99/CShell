import { SerializeAddon } from '@xterm/addon-serialize';
import { pluginEnabled, type InstalledPlugin } from '../../shared/plugins';
import { suggestCommands, shellPromptInput, linuxCommands } from '../command-suggestions';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ArrowDown, ArrowUp, X, Search, Keyboard } from 'lucide-react';
import { installTerminalColors } from '../terminal-colors';
import { isolateTerminalMeasurement } from '../terminal-measurement';
import type { Preferences } from '../../shared/contracts';
import { subscribeTerminal, registerTerminalSnapshot } from '../terminalBus';
import { useI18n } from '../i18n';
import { shortcutFor } from '../shortcuts';
import { detectEditor, editorFromCommand, type EditorDetection } from '../editor-detection';
import { EditorAssistant, type AssistantChoice } from './EditorAssistant';
import { editorActionInput, editorPromptBusy, vimExitFromPrompt } from '../editor-actions';
import '@xterm/xterm/css/xterm.css';
import { openTextAssist, analyzeSelection } from '../text-assist';
import { useAiProviders } from '../use-ai-providers';
import { editorFileFromCommand } from '../text-path';
const TextFileEditor = lazy(() => import('./TextFileEditor').then(module => ({default: module.TextFileEditor})));
function currentShellInput(terminal: Terminal) {
  const buffer = terminal.buffer.active;
  const row = buffer.getLine(buffer.baseY + buffer.cursorY);
  if (!row || row.translateToString(true, buffer.cursorX).trim()) return null;
  return shellPromptInput(row.translateToString(false, 0, buffer.cursorX));
}
export function TerminalPane({
  id,
  active,
  preferences,
  closed,
  suggestionsEnabled,
  plugins,
  pythonInterpreter,
  textEditingSupported = false,
  searching,
  onSearchClose,
  onError,
}: {
  id: string;
  active: boolean;
  preferences: Preferences;
  closed: boolean;
  suggestionsEnabled: boolean;
  plugins: InstalledPlugin[];
  pythonInterpreter?: string;
  textEditingSupported?: boolean;
  searching: boolean;
  onSearchClose: () => void;
  onError: (e: unknown) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    term = useRef<Terminal | null>(null),
    fit = useRef<FitAddon | null>(null),
    search = useRef<SearchAddon | null>(null),
    [query, setQuery] = useState('');
  const { t } = useI18n();
  const aiAvailable = useAiProviders().providers.length > 0;
  const [zoom, setZoom] = useState(0);
  const [keysOpen, setKeysOpen] = useState(false);
  const [nativeKeys, setNativeKeys] = useState(false);
  const clipboardKeys = useRef(true);
  clipboardKeys.current = preferences.terminalClipboardKeys && !nativeKeys;
  const [textPath, setTextPath] = useState('');
  const [editingPath, setEditingPath] = useState('');
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [commandInput, setCommandInput] = useState('');
  const [commandPosition, setCommandPosition] = useState({ left: 12, top: 12 });
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const typed = useRef<string | null>(null);
  const [pythonContext, setPythonContext] = useState(false);
  const [pythonSelection, setPythonSelection] = useState('');
  const [pythonEnvironments, setPythonEnvironments] = useState<
    Array<{ python: string; name: string }>
  >([]);
  const [pythonError, setPythonError] = useState('');
  const interpreterRef = useRef(pythonInterpreter);
  interpreterRef.current = pythonInterpreter;
  const runtime = useRef({ active: false, python: '', history: '', environment: '' });
  const [pythonChoices, setPythonChoices] = useState<
    Array<{ command: string; zh: string; en: string }>
  >([]);
  const pythonChoicesRef = useRef(pythonChoices);
  pythonChoicesRef.current = pythonChoices;
  const pluginsRef = useRef(plugins);
  pluginsRef.current = plugins;
  const promptInput = (terminal: Terminal) => {
    if (!runtime.current.active) return currentShellInput(terminal);
    if (!pluginEnabled(pluginsRef.current, 'python')) return null;
    const buffer = terminal.buffer.active,
      row = buffer.getLine(buffer.baseY + buffer.cursorY);
    if (buffer.type !== 'normal' || !row || row.translateToString(true, buffer.cursorX).trim())
      return null;
    return (
      row
        .translateToString(false, 0, buffer.cursorX)
        .match(/^(?:>>> |\.\.\. |In \[\d+\]: )(.*)$/)?.[1] ?? null
    );
  };
  const suggestionsFor = (input: string) =>
    runtime.current.active
      ? pythonChoicesRef.current.filter((c) => c.command.startsWith(input) && c.command !== input)
      : suggestCommands(input, commandCatalog.current);
  useEffect(() => {
    setPythonChoices([]);
    if (
      !active ||
      closed ||
      !runtime.current.active ||
      !runtime.current.python ||
      !commandInput ||
      !pluginEnabled(plugins, 'python')
    )
      return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const source = runtime.current.history + commandInput;
      const before = source.split('\n');
      try {
        const result = await window.cshell.pythonAnalyze(
          id,
          runtime.current.python,
          source,
          before.length,
          [...before.at(-1)!].length,
        );
        if (cancelled) return;
        setPythonError('');
        const word = commandInput.match(/[a-zA-Z0-9_]*$/)?.[0] || '';
        setPythonChoices(
          result.completions
            .filter((c) => c.label.startsWith(word))
            .slice(0, 6)
            .map((c) => ({
              command: commandInput.slice(0, commandInput.length - word.length) + c.label,
              zh: c.detail,
              en: c.detail,
            })),
        );
      } catch (e) {
        if (!cancelled) setPythonError(String(e));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [commandInput, active, closed, plugins, id, pythonSelection]);
  const dismissed = useRef(false);
  const suggestionState = useRef({
    active,
    closed,
    enabled: suggestionsEnabled,
    input: commandInput,
    index: suggestionIndex,
  });
  suggestionState.current = {
    active,
    closed,
    enabled: suggestionsEnabled,
    input: commandInput,
    index: suggestionIndex,
  };
  const commandCatalog = useRef(linuxCommands);
  commandCatalog.current = [
    ...(pluginEnabled(plugins, 'commands') ? linuxCommands : []),
    ...plugins
      .filter((p) => p.enabled && p.manifest.provider === 'snippets')
      .flatMap((p) =>
        p.manifest.commands.map((c) => [c.text, c.label, c.label] as [string, string, string]),
      ),
  ];
  const choices = suggestionsEnabled && active && !closed ? suggestionsFor(commandInput) : [];
  const acceptSuggestion = (command: string) => {
    const terminal = term.current,
      state = suggestionState.current;
    if (
      !terminal ||
      !state.active ||
      state.closed ||
      !state.enabled ||
      terminal.buffer.active.type !== 'normal' ||
      !typed.current ||
      !command.startsWith(typed.current)
    )
      return;
    if (promptInput(terminal) !== typed.current) return;
    const suffix = command.slice(typed.current.length);
    typed.current = null;
    setCommandInput('');
    terminal.paste(suffix);
    terminal.focus();
  };
  const acceptRef = useRef(acceptSuggestion);
  acceptRef.current = acceptSuggestion;
  const [detected, setDetected] = useState<EditorDetection | null>(null);
  const [assistantChoice, setAssistantChoice] = useState<AssistantChoice>('auto');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const copy = () => {
    const text = term.current?.getSelection();
    if (text) void window.cshell.copyText(text).catch(errorRef.current);
  };
  const paste = () =>
    void window.cshell
      .pasteText()
      .then((text) => { if (suggestionState.current.active && !suggestionState.current.closed) term.current?.paste(text); })
      .catch(errorRef.current);
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 10000,
      allowProposedApi: true,
      convertEol: false,
    });
    const fitter = new FitAddon(),
      finder = new SearchAddon();
    terminal.loadAddon(fitter);
    terminal.loadAddon(finder);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.open(host.current!);
    const restoreMeasurement = isolateTerminalMeasurement(terminal.element);
    term.current = terminal;
    fit.current = fitter;
    search.current = finder;
    terminal.attachCustomKeyEventHandler((event) => {
      const state = suggestionState.current;
      if (clipboardKeys.current && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ['KeyC', 'KeyV'].includes(event.code)) {
        event.preventDefault();
        if (event.type === 'keydown' && !event.repeat && state.active) {
          if (event.code === 'KeyC') copy();
          else if (!state.closed) paste();
        }
        return false;
      }
      const options =
        state.active && !state.closed && state.enabled ? suggestionsFor(state.input) : [];
      if (
        options.length &&
        ((event.code === 'Space' && event.ctrlKey) ||
          (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.code)) ||
          event.code === 'Escape')
      ) {
        if (event.type === 'keydown') {
          event.preventDefault();
          if (event.code === 'Space')
            acceptRef.current(options[state.index % options.length].command);
          else if (event.code === 'Escape') {
            dismissed.current = true;
            setCommandInput('');
          } else
            setSuggestionIndex(
              (index) =>
                (index + (event.code === 'ArrowDown' ? 1 : options.length - 1)) % options.length,
            );
        }
        return false;
      }
      if (shortcutFor(event)) return false;
      if (event.ctrlKey && event.shiftKey && ['Equal', 'Minus', 'Digit0'].includes(event.code)) {
        if (event.type === 'keydown') {
          event.preventDefault();
          setZoom((n) =>
            event.code === 'Digit0'
              ? 0
              : Math.max(-4, Math.min(10, n + (event.code === 'Equal' ? 1 : -1))),
          );
        }
        return false;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        ['C', 'V', 'F', 'P', 'N', 'B', 'E'].includes(event.key.toUpperCase())
      ) {
        if (event.type === 'keydown') {
          if (event.key.toUpperCase() === 'C') copy();
          if (event.key.toUpperCase() === 'V') paste();
        }
        return false;
      }
      return true;
    });
    let commandLine = '';
    let pending: { kind: 'vim' | 'nano'; time: number } | null = null;
    let latched: EditorDetection | null = null;
    let detectionTimer: ReturnType<typeof setTimeout> | undefined;
    const scanEditor = () => {
      detectionTimer = undefined;
      const buffer = terminal.buffer.active;
      if (buffer.type !== 'alternate') {
        latched = null;
        setDetected(null);
        return;
      }
      const lines = Array.from(
        { length: terminal.rows },
        (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) || '',
      );
      const found = detectEditor(lines, true);
      if (found) latched = found;
      setDetected((previous) =>
        JSON.stringify(previous) === JSON.stringify(latched) ? previous : latched,
      );
    };
    const bufferChange = terminal.buffer.onBufferChange((buffer) => {
      latched =
        buffer.type === 'alternate' && pending && Date.now() - pending.time < 5000
          ? { kind: pending.kind, nanoModern: false, nanoSearch: 'Ctrl+W' }
          : null;
      pending = null;
      commandLine = '';
      typed.current = null;
      setCommandInput('');
      setDetected(latched);
    });
    let parsedFrame: number | undefined;
    const syncParsedUi = () => {
      parsedFrame = undefined;
      if (!detectionTimer) detectionTimer = setTimeout(scanEditor, 120);
      const buffer = terminal.buffer.active;
      if (runtime.current.active && currentShellInput(terminal) === '') {
        runtime.current.active = false;
        setPythonContext(false);
        setPythonChoices([]);
      }
      if (buffer.type === 'normal' && typed.current !== null && !dismissed.current) {
        const input = promptInput(terminal) === typed.current ? typed.current : '';
        setCommandInput(input);
        const bounds = host.current?.closest('.terminal-pane')?.getBoundingClientRect();
        const screen = host.current?.querySelector('.xterm-screen')?.getBoundingClientRect();
        if (input && bounds && screen) {
          const rowHeight = screen.height / terminal.rows;
          const cursorTop = screen.top - bounds.top + buffer.cursorY * rowHeight;
          const height = Math.max(1, suggestionsFor(input).length) * 34 + 12;
          const width = Math.min(540, bounds.width - 24);
          const position = {
            left: Math.max(
              12,
              Math.min(
                bounds.width - width - 12,
                screen.left -
                  bounds.left +
                  (Math.max(0, buffer.cursorX - input.length) * screen.width) / terminal.cols,
              ),
            ),
            top:
              cursorTop + rowHeight + height + 8 < bounds.height
                ? cursorTop + rowHeight + 4
                : Math.max(4, cursorTop - height - 4),
          };
          setCommandPosition((previous) =>
            previous.left === position.left && previous.top === position.top ? previous : position,
          );
        }
      }
    };
    // Parser callbacks can run synchronously while React is committing another
    // terminal update. Coalesce presentation updates outside that call stack;
    // terminal parsing, input, acknowledgements and snapshots remain immediate.
    const parsed = terminal.onWriteParsed(() => {
      parsedFrame ??= requestAnimationFrame(syncParsedUi);
    });
    const data = terminal.onData((value) => {
      // Send first; local suggestions and editor detection must not hold up
      // interactive SSH input. The remote PTY remains the source of echo.
      for (let offset = 0; offset < value.length; offset += 32768)
        void window.cshell.input(id, value.slice(offset, offset + 32768)).catch(errorRef.current);
      const entered = typed.current;
      const visibleInput = entered !== null && promptInput(terminal) === entered;
      if (terminal.buffer.active.type === 'normal') {
        if (typed.current === null && !/[\x00-\x1f\x7f]/.test(value)) {
          if (promptInput(terminal) === '') {
            typed.current = '';
            dismissed.current = false;
          }
        }
        if (value === '\x7f' && typed.current !== null) typed.current = typed.current.slice(0, -1);
        else if (/[\x00-\x1f\x7f]/.test(value) || value.length > 100) {
          typed.current = null;
          setCommandInput('');
        } else if (typed.current !== null) typed.current += value;
        setSuggestionIndex(0);
        for (const char of value) {
          if (char === '\r' || char === '\n') {
            if (runtime.current.active) {
              if (visibleInput)
                runtime.current.history = (runtime.current.history + entered + '\n').slice(
                  -100_000,
                );
            } else if (visibleInput) {
              const activation = commandLine.match(/^conda activate ([a-zA-Z0-9_/-]+)$/);
              if (activation) runtime.current.environment = activation[1];
              const launch = commandLine.match(
                /^(python(?:3(?:\.\d+)?)?|\/[a-zA-Z0-9_./-]+\/python(?:3(?:\.\d+)?)?|ipython)(?:\s*)$/,
              );
              if (launch && pluginEnabled(pluginsRef.current, 'python')) {
                runtime.current.active = true;
                setPythonContext(true);
                setPythonError('');
                setPythonSelection('');
                runtime.current.history = '';
                runtime.current.python = '';
                const selected = runtime.current.environment;
                void window.cshell
                  .environments(id)
                  .then((snapshot) => {
                    if (!runtime.current.active) return;
                    runtime.current.python = launch[1].startsWith('/')
                      ? launch[1]
                      : snapshot.environments.find(
                          (e) => e.name === selected || e.prefix === selected,
                        )?.python ||
                        interpreterRef.current ||
                        '';
                    setPythonEnvironments([
                      ...snapshot.environments,
                      ...(snapshot.python
                        ? [{ python: snapshot.python, name: 'System Python' }]
                        : []),
                    ]);
                    setPythonSelection(runtime.current.python);
                  })
                  .catch((e) => setPythonError(String(e)));
              }
            }
            const kind = editorFromCommand(commandLine);
            if (kind) setTextPath(editorFileFromCommand(commandLine) || '');
            pending = kind ? { kind, time: Date.now() } : null;
            commandLine = '';
          } else if (char === '\x7f' || char === '\b') commandLine = commandLine.slice(0, -1);
          else if (char < ' ') commandLine = '';
          else commandLine = (commandLine + char).slice(-512);
        }
      }
    });
    const resize = terminal.onResize(
      (size) => void window.cshell.resize(id, size.cols, size.rows).catch(() => {}),
    );
    const serializer = new SerializeAddon();
    terminal.loadAddon(serializer);
    let writtenSequence = 0;
    let writes: Promise<void> = Promise.resolve();
    const dispose = subscribeTerminal(id, (value, sequence) => {
      if (!value) { writtenSequence = Math.max(writtenSequence, sequence); return; }
      writes = new Promise<void>(resolve => terminal.write(value, () => {
        writtenSequence = sequence;
        void window.cshell.acknowledge(id, value.length).catch(() => {});
        resolve();
      }));
    });
    const snapshotDispose = registerTerminalSnapshot(id, async () => {
      await writes;
      return {
        data: serializer.serialize(), sequence: writtenSequence,
        cols: terminal.cols, rows: terminal.rows,
        theme: Object.fromEntries(Object.entries(terminal.options.theme || {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )),
      };
    });
    let fitFrame: number | undefined;
    let forceRemoteResize = false;
    const scheduleFit = () => {
      fitFrame ??= requestAnimationFrame(() => {
        fitFrame = undefined;
        if (suggestionState.current.active && host.current?.clientWidth && host.current?.clientHeight) {
          const cols = terminal.cols, rows = terminal.rows;
          fitter.fit();
          // A floating view may have resized this same PTY while unfocused.
          if (forceRemoteResize && cols === terminal.cols && rows === terminal.rows)
            void window.cshell.resize(id, terminal.cols, terminal.rows).catch(() => {});
        }
        forceRemoteResize = false;
      });
    };
    const focusTerminal = () => { forceRemoteResize = true; scheduleFit(); };
    window.addEventListener('focus', focusTerminal);
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(host.current!);
    const fontsLoaded = () => {
      if (host.current?.clientWidth) {
        fitter.fit();
        terminal.refresh(0, terminal.rows - 1);
      }
    };
    window.addEventListener('cshell:fonts-loaded', fontsLoaded);
    return () => {
      dispose();
      snapshotDispose();
      window.removeEventListener('focus', focusTerminal);
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
      observer.disconnect();
      window.removeEventListener('cshell:fonts-loaded', fontsLoaded);
      data.dispose();
      resize.dispose();
      clearTimeout(detectionTimer);
      bufferChange.dispose();
      parsed.dispose();
      if (parsedFrame !== undefined) cancelAnimationFrame(parsedFrame);
      restoreMeasurement();
      terminal.dispose();
    };
  }, [id]);
  useEffect(() => {
    if (!term.current || !active || closed || !preferences.terminalSemanticColors) return;
    return installTerminalColors(term.current, preferences.theme === 'dark');
  }, [id, active, closed, preferences.terminalSemanticColors, preferences.theme]);
  useEffect(() => {
    if (term.current) {
      term.current.options.fontFamily = preferences.terminalFont;
      term.current.options.fontSize = Math.max(10, Math.min(28, preferences.fontSize + zoom));
      term.current.options.lineHeight = preferences.lineHeight;
      term.current.options.theme =
        preferences.theme === 'dark'
          ? {
              background: preferences.backgroundAsset ? '#00000000' : '#0d141b',
              foreground: '#d6e1ee',
              cursor: '#b8d2f3',
              selectionBackground: '#284467',
              black: '#18212b',
              red: '#f07178',
              green: '#a3c775',
              yellow: '#e7bd76',
              blue: '#74a9ed',
              magenta: '#c69ae5',
              cyan: '#73c4c8',
              white: '#d6e1ee',
              brightBlack: '#718297',
              brightRed: '#ff8c92',
              brightGreen: '#c1e68c',
              brightYellow: '#f5d794',
              brightBlue: '#97c4ff',
              brightMagenta: '#e0b3fa',
              brightCyan: '#95e0df',
              brightWhite: '#ffffff',
            }
          : {
              background: preferences.backgroundAsset ? '#00000000' : '#ffffff',
              foreground: '#24334a',
              cursor: '#236fea',
              selectionBackground: '#c4dafa',
              black: '#24334a',
              red: '#b52f3f',
              green: '#23753b',
              yellow: '#856515',
              blue: '#245fc4',
              magenta: '#8642a2',
              cyan: '#116e78',
              white: '#6c7989',
              brightBlack: '#64748b',
              brightRed: '#cc3448',
              brightGreen: '#287b45',
              brightYellow: '#906800',
              brightBlue: '#286fd8',
              brightMagenta: '#9952b3',
              brightCyan: '#137c8c',
              brightWhite: '#8793a1',
            };
      fit.current?.fit();
    }
  }, [preferences, zoom]);
  useEffect(() => {
    if (active)
      requestAnimationFrame(() => {
        fit.current?.fit();
        term.current?.focus();
      });
  }, [active]);
  useEffect(() => {
    if (closed && term.current) term.current.options.disableStdin = true;
  }, [closed]);
  return (
    <section
      className={`terminal-pane ${active ? 'active' : ''}`}
      onContextMenu={(event) => {
        if (!(event.target as Element).closest('.terminal-host')) return;
        event.preventDefault();
        setContextMenu({
          x: Math.max(0, Math.min(event.clientX, window.innerWidth - 260)),
          y: Math.max(8, Math.min(event.clientY, window.innerHeight - 520)),
        });
      }}
      onClick={() => setContextMenu(null)}
    >
      <div className="terminal-keybar">
        <button className="terminal-key-toggle" aria-expanded={keysOpen} title="终端快捷键" onClick={() => setKeysOpen(value => !value)}><Keyboard size={15}/>快捷键</button>
        {keysOpen && <>
          <button onClick={copy}>复制</button><button disabled={closed} onClick={paste}>粘贴</button>
          {([['中断 · Ctrl+C', '\x03'], ['挂起 · Ctrl+Z', '\x1a'], ['结束输入 · Ctrl+D', '\x04'], ['原生 Ctrl+V', '\x16'], ['Esc', '\x1b']] as const).map(([label, value]) => <button key={label} disabled={closed} title={`发送 ${label} 到当前终端`} onClick={() => { if (!closed && active) { void window.cshell.input(id, value).catch(errorRef.current); term.current?.focus(); } }}>{label}</button>)}
          <label><input type="checkbox" checked={nativeKeys || !preferences.terminalClipboardKeys} disabled={!preferences.terminalClipboardKeys} onChange={event => setNativeKeys(event.target.checked)}/>原生按键</label>
        </>}
      </div>
      {textEditingSupported && !!detected && !closed && <form className="text-editor-options" onSubmit={event => {event.preventDefault();if(textPath.startsWith('/')){setEditingPath(textPath);setShowTextEditor(true);}}}>
        <input aria-label="文件完整路径" placeholder="文件完整路径，如 /etc/config.conf" value={textPath} onChange={event => setTextPath(event.target.value)}/>
        <button disabled={!textPath.startsWith('/')}>内置编辑器</button>
        <small>先在终端编辑器保存修改；内置编辑器默认实时同步。</small>
      </form>}
      {editingPath && <div className="terminal-text-overlay" hidden={!showTextEditor}>
        <div className="text-editor-options"><button onClick={() => setShowTextEditor(false)}>返回终端</button><span>编辑内容会保留；实时同步仍继续。</span></div>
        <Suspense fallback={<p role="status">正在打开编辑器…</p>}><TextFileEditor key={editingPath} sessionId={id} path={editingPath} realtime/></Suspense>
      </div>}
      {pythonContext && !closed && pluginEnabled(plugins, 'python') && (
        <div className="python-repl-context">
          <span>Python</span>
          <select
            aria-label={
              preferences.locale === 'zh-CN' ? '终端 Python 环境' : 'Terminal Python environment'
            }
            value={pythonSelection}
            onChange={(e) => {
              runtime.current.python = e.target.value;
              setPythonSelection(e.target.value);
            }}
          >
            <option value="">
              {preferences.locale === 'zh-CN' ? '选择当前环境' : 'Select current environment'}
            </option>
            {pythonEnvironments.map((env, index) => (
              <option key={index} value={env.python}>
                {env.name}
              </option>
            ))}
          </select>
          {pythonError && (
            <button
              title={pythonError}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('cshell:open-python', { detail: { sessionId: id, path: '' } }),
                )
              }
            >
              {preferences.locale === 'zh-CN' ? '配置补全' : 'Configure completion'}
            </button>
          )}
        </div>
      )}
      {searching && (
        <div className="terminal-search">
          <Search size={15} />
          <input
            aria-label={t('searchTerminal')}
            placeholder={t('searchTerminal')}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              search.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search.current?.findNext(query);
            }}
          />
          <button
            className="icon"
            title={t('previous')}
            onClick={() => search.current?.findPrevious(query)}
          >
            <ArrowUp size={15} />
          </button>
          <button
            className="icon"
            title={t('next')}
            onClick={() => search.current?.findNext(query)}
          >
            <ArrowDown size={15} />
          </button>
          <button className="icon" aria-label={t('close')} onClick={onSearchClose}>
            <X size={15} />
          </button>
        </div>
      )}
      {!!choices.length && (
        <div
          className="command-suggestions"
          style={commandPosition}
          role="listbox"
          aria-label="Linux commands"
        >
          {choices.map((item, index) => (
            <button
              key={item.command}
              role="option"
              aria-selected={index === suggestionIndex % choices.length}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => acceptSuggestion(item.command)}
            >
              <code>{item.command}</code>
              <span>{preferences.locale === 'zh-CN' ? item.zh : item.en}</span>
              {index === suggestionIndex % choices.length && <kbd>Ctrl+Space</kbd>}
            </button>
          ))}
        </div>
      )}
      <EditorAssistant
        detected={closed || !detected || !pluginEnabled(plugins, detected.kind) ? null : detected}
        choice={
          closed ||
          ((assistantChoice === 'vim' || assistantChoice === 'nano') &&
            !pluginEnabled(plugins, assistantChoice))
            ? 'off'
            : assistantChoice
        }
        onChoice={setAssistantChoice}
        onFocusTerminal={() => term.current?.focus()}
        onAction={async (kind, action, value, modern, nanoSearch) => {
          const terminal = term.current;
          if (
            !active ||
            closed ||
            !terminal ||
            terminal.buffer.active.type !== 'alternate' ||
            (assistantChoice === 'auto' && detected?.kind !== kind)
          )
            throw new Error('EDITOR_INACTIVE');
          const buffer = terminal.buffer.active;
          const lines = Array.from(
            { length: terminal.rows },
            (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) || '',
          );
          // Multiplexers can retain the alternate buffer after an editor exits.
          const resumeExit = kind === 'vim' && vimExitFromPrompt(lines, action);
          // Automatic actions require fresh editor evidence, not just a latched badge.
          if (
            assistantChoice === 'auto' &&
            detectEditor(lines, true)?.kind !== kind &&
            !resumeExit &&
            !(['normal', 'cancel'].includes(action) && editorPromptBusy(lines, kind))
          )
            throw new Error('EDITOR_INACTIVE');
          if (
            !resumeExit &&
            !['normal', 'cancel'].includes(action) &&
            editorPromptBusy(lines, kind)
          )
            throw new Error('EDITOR_PROMPT');
          await window.cshell.input(
            id,
            (resumeExit ? '\r' : '') + editorActionInput(kind, action, value, modern, nanoSearch),
          );
        }}
      >
        <div className="terminal-host" ref={host} />
      </EditorAssistant>
      {contextMenu && (
        <div className="terminal-context" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {aiAvailable && (
            <>
              <button
                disabled={!term.current?.hasSelection()}
                onClick={() => analyzeSelection(term.current?.getSelection() || '', id)}
              >
                AI 分析
              </button>
              <button
                disabled={!term.current?.hasSelection()}
                onClick={() =>
                  openTextAssist({
                    mode: 'translate',
                    text: term.current?.getSelection() || '',
                    label: '终端选中文字',
                  })
                }
              >
                AI 翻译选中文字
              </button>
              <button
                onClick={() => {
                  const read = () => {
                    const terminal = term.current;
                    if (
                      !terminal ||
                      !suggestionState.current.active ||
                      suggestionState.current.closed
                    )
                      return null;
                    const buffer = terminal.buffer.active;
                    // Read displayed output only; never inspect the terminal input textarea.
                    return Array.from(
                      { length: buffer.length },
                      (_, i) => buffer.getLine(i)?.translateToString(true) || '',
                    )
                      .join('\n')
                      .trimEnd();
                  };
                  openTextAssist({
                    mode: 'translate',
                    text: read() || '',
                    label: '终端输出',
                    read,
                  });
                }}
              >
                翻译终端内容…
              </button>
              <button
                disabled={
                  closed ||
                  !term.current ||
                  term.current.buffer.active.type !== 'normal' ||
                  promptInput(term.current) === null
                }
                onClick={() => {
                  const terminal = term.current!,
                    before = promptInput(terminal);
                  openTextAssist({
                    mode: 'compose',
                    text: before || '',
                    label: 'Shell 命令输入（仅生成单行命令）',
                    apply(value) {
                      if (
                        !suggestionState.current.active ||
                        suggestionState.current.closed ||
                        terminal.buffer.active.type !== 'normal' ||
                        promptInput(terminal) !== before
                      )
                        throw new Error('终端输入位置已变化，请重新打开助手');
                      if (/[\x00-\x1f\x7f]/.test(value))
                        throw new Error('候选包含换行或控制字符，请要求生成单行命令');
                      // Insert at the current cursor, without Enter or clearing existing input.
                      terminal.paste(value);
                      terminal.focus();
                    },
                  });
                }}
              >
                我想……
              </button>
            </>
          )}
          <button onClick={copy}>
            {t('copy')}
            <kbd>Ctrl+Shift+C</kbd>
          </button>
          <button onClick={paste}>
            {t('paste')}
            <kbd>Ctrl+Shift+V</kbd>
          </button>
          <button onClick={() => term.current?.clear()}>{t('clear')}</button>
          <button onClick={() => setZoom((n) => Math.min(10, n + 1))}>
            {t('terminalZoomIn')}
            <kbd>Ctrl+Shift+=</kbd>
          </button>
          <button onClick={() => setZoom((n) => Math.max(-4, n - 1))}>
            {t('terminalZoomOut')}
            <kbd>Ctrl+Shift+-</kbd>
          </button>
          <button onClick={() => setZoom(0)}>
            {t('terminalZoomReset')}
            <kbd>Ctrl+Shift+0</kbd>
          </button>
          {!closed && (
            <div className="terminal-assistant-choices">
              <span>{t('editorAssistant')}</span>
              {(['auto', 'vim', 'nano', 'off'] as const).map((choice) => (
                <button
                  key={choice}
                  aria-pressed={assistantChoice === choice}
                  onClick={() => setAssistantChoice(choice)}
                >
                  {choice === 'auto'
                    ? t('automatic')
                    : choice === 'off'
                      ? t('disabled')
                      : choice === 'vim'
                        ? 'Vim'
                        : 'Nano'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
