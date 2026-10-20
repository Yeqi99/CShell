import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { useEffect, useRef, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from '@codemirror/view';
import { python as pythonLanguage } from '@codemirror/lang-python';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { linter, lintGutter } from '@codemirror/lint';
import { Save, RotateCcw } from 'lucide-react';
import { useI18n } from '../i18n';
import { shellLanguage } from '../text-languages';

const pythonHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((style) =>
    style.color
      ? {
          ...style,
          color: `light-dark(${style.color}, color-mix(in srgb, ${style.color}, white 55%))`,
        }
      : style,
  ),
);

export function PythonEditor({
  sessionId,
  python,
  path,
  connected,
  onDependency,
  textFile = false,
  initialRealtime = false,
  languageMode = 'text',
}: {
  sessionId: string;
  python: string;
  path?: string;
  connected: boolean;
  onDependency: () => void;
  textFile?: boolean;
  initialRealtime?: boolean;
  languageMode?: 'text' | 'shell' | 'python';
}) {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN';
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const [realtime, setRealtime] = useState(initialRealtime);
  const savingLock = useRef(false);
  const versions = useRef<string[]>([]);
  const [versionCount, setVersionCount] = useState(0);
  const readFile = textFile ? window.cshell.textReadFile : window.cshell.pythonReadFile;
  const writeFile = textFile ? window.cshell.textSaveFile : window.cshell.pythonSaveFile;
  const [code, setCode] = useState(''),
    [revision, setRevision] = useState(''),
    [savedCode, setSavedCode] = useState('');
  const [error, setError] = useState(''),
    [engineError, setEngineError] = useState(''),
    [reloadConfirm, setReloadConfirm] = useState(false),
    [signature, setSignature] = useState(''),
    [ready, setReady] = useState(!path),
    [saving, setSaving] = useState(false);
  const state = useRef({ python, connected });
  state.current = { python, connected };
  const analyze = async (text: string, position: number) => {
    if (!state.current.python || !state.current.connected) return null;
    const before = text.slice(0, position).split('\n');
    const interpreter = state.current.python;
    try {
      const result = await window.cshell.pythonAnalyze(
        sessionId,
        interpreter,
        text,
        before.length,
        [...before.at(-1)!].length,
        path,
      );
      if (interpreter !== state.current.python || !state.current.connected) return null;
      setEngineError('');
      return result;
    } catch (e) {
      setEngineError(String(e));
      return null;
    }
  };
  useEffect(() => {
    let cancelled = false;
    if (path)
      void readFile(sessionId, path).then(
        (result) => {
          if (!cancelled) {
            setCode(result.code);
            setSavedCode(result.code);
            setRevision(result.revision);
            setReady(true);
          }
        },
        (e) => {
          if (!cancelled) setError(String(e));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [sessionId, path]);
  const save = async () => {
    if (!path || !state.current.connected || savingLock.current) return;
    const text = view.current?.state.doc.toString() ?? code;
    if (text === savedCode) return;
    savingLock.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await writeFile(sessionId, path, text, revision);
      versions.current.push(savedCode);
      while (versions.current.length > 8 || versions.current.reduce((n, value) => n + value.length * 2, 0) > 2_000_000) versions.current.shift();
      setVersionCount(versions.current.length);
      setRevision(result.revision);
      setSavedCode(text);
    } catch (e) {
      setError(String(e));
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  };
  const reload = async () => {
    if (!path || !connected || savingLock.current) return;
    savingLock.current = true;
    setReloadConfirm(false);
    setSaving(true);
    setError('');
    try {
      const result = await readFile(sessionId, path);
      view.current?.dispatch({
        changes: { from: 0, to: view.current.state.doc.length, insert: result.code },
      });
      setCode(result.code);
      setSavedCode(result.code);
      setRevision(result.revision);
      setReady(true);
    } catch (e) {
      setError(String(e));
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!realtime || !ready || !connected || saving || error || code === savedCode) return;
    const timer = setTimeout(() => void saveRef.current(), 350);
    return () => clearTimeout(timer);
  }, [realtime, ready, connected, saving, error, code, savedCode]);
  useEffect(() => {
    view.current?.dispatch({ effects: language.current.reconfigure(!textFile || languageMode === 'python' ? pythonLanguage() : languageMode === 'shell' ? shellLanguage : []) });
  }, [languageMode, textFile, ready]);
  useEffect(() => {
    if (!ready || !host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history({ minDepth: 20 }),
          language.current.of(!textFile || languageMode === 'python' ? pythonLanguage() : languageMode === 'shell' ? shellLanguage : []),
          syntaxHighlighting(pythonHighlightStyle),
          lintGutter(),
          keymap.of([
            {
              key: 'Ctrl-s',
              run: () => {
                void saveRef.current();
                return true;
              },
            },
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          autocompletion({
            override: [
              async (context) => {
                const word = context.matchBefore(/[\p{L}\p{N}_]*/u);
                if (
                  !context.explicit &&
                  !word?.text &&
                  context.state.sliceDoc(context.pos - 1, context.pos) !== '.'
                )
                  return null;
                const result = await analyze(context.state.doc.toString(), context.pos);
                if (!result || context.aborted) return null;
                setSignature(result.signatures.join(' · '));
                return {
                  from: word?.from ?? context.pos,
                  options: result.completions.map((item) => ({
                    label: item.label,
                    detail: item.detail,
                    type: ['function', 'class', 'module', 'keyword'].includes(item.type)
                      ? item.type
                      : 'variable',
                  })),
                  validFor: /^[\p{L}\p{N}_]*$/u,
                };
              },
            ],
            activateOnTyping: true,
          }),
          linter(
            async (v) => {
              const doc = v.state.doc,
                result = await analyze(doc.toString(), v.state.selection.main.head);
              if (!result) return [];
              setSignature(result.signatures.join(' · '));
              return result.diagnostics
                .filter((d) => d.line >= 1 && d.line <= doc.lines)
                .map((d) => {
                  const line = doc.line(d.line);
                  const from = Math.min(
                    line.to,
                    line.from + [...line.text].slice(0, d.column).join('').length,
                  );
                  return {
                    from,
                    to: Math.min(doc.length, from + 1),
                    severity: 'error' as const,
                    message: d.message,
                  };
                });
            },
            { delay: 1000 },
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setCode(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': {
              height: '100%',
              fontSize: '14px',
              color: 'var(--text)',
              backgroundColor: 'var(--terminal)',
            },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, monospace' },
            '.cm-gutters': {
              backgroundColor: 'var(--panel)',
              color: 'var(--muted)',
              border: 'none',
            },
            '.cm-cursor': { borderLeftColor: 'var(--text)' },
            '.cm-activeLine': { backgroundColor: 'var(--hover)' },
            '.cm-tooltip': {
              backgroundColor: 'var(--panel)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
            },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [ready]);
  return (
    <section className="python-editor">
      <header>
        <span title={path}>
          {path || (zh ? 'Python 草稿' : 'Python scratchpad')}
          {path && code !== savedCode ? ' •' : ''}
        </span>
        {path && (
          <select aria-label={zh ? '同步模式' : 'Sync mode'} value={realtime ? 'live' : 'save'} onChange={event => setRealtime(event.target.value === 'live')}>
            <option value="save">{zh ? '保存模式' : 'Save manually'}</option>
            <option value="live">{zh ? '实时模式' : 'Live sync'}</option>
          </select>
        )}
        {path && versionCount > 0 && <button disabled={saving || !connected} title={zh ? '恢复上一个保存版本到编辑区，实时模式会暂停' : 'Restore previous saved content; pauses live sync'} onClick={() => {
          const previous = versions.current.pop();
          if (previous === undefined || !view.current) return;
          setRealtime(false);setVersionCount(versions.current.length);
          view.current.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: previous } });
        }}>{zh ? '回退' : 'Restore'}</button>}
        {path && (
          <button
            className="icon"
            disabled={!connected || saving}
            title={zh ? '重新读取文件' : 'Reload file'}
            aria-label={zh ? '重新读取文件' : 'Reload file'}
            onClick={() => (code !== savedCode ? setReloadConfirm(true) : void reload())}
          >
            <RotateCcw size={15} />
          </button>
        )}
        <button
          className="icon"
          disabled={!path || !connected || saving || code === savedCode}
          onClick={() => void save()}
          title={zh ? '保存文件 (Ctrl+S)' : 'Save file (Ctrl+S)'}
          aria-label={zh ? '保存文件' : 'Save file'}
        >
          <Save size={16} />
        </button>
      </header>
      {reloadConfirm && (
        <div className="extension-error">
          <span>
            {zh ? '重新读取将放弃当前未保存修改。' : 'Reloading discards unsaved changes.'}
          </span>
          <button onClick={() => setReloadConfirm(false)}>{zh ? '取消' : 'Cancel'}</button>
          <button onClick={() => void reload()}>{zh ? '重新读取' : 'Reload'}</button>
        </div>
      )}
      {(error || engineError) && (
        <div className="extension-error" role="alert">
          {!error && engineError.includes('JEDI_MISSING') ? (
            <>
              <span>
                {zh
                  ? '当前环境缺少 Python 补全引擎。'
                  : 'Completion engine is missing in this environment.'}
              </span>
              <button onClick={onDependency}>
                {zh ? '安装补全引擎' : 'Install completion engine'}
              </button>
            </>
          ) : (
            error || engineError
          )}
        </div>
      )}
      {!python && !textFile && (
        <p className="muted">
          {zh
            ? '选择 Python 环境以启用语义补全。'
            : 'Select a Python environment for semantic completion.'}
        </p>
      )}
      <div className="python-code" ref={host} />
      <footer>
        {saving ? (zh ? '同步中 · ' : 'Syncing · ') : path && code !== savedCode ? (zh ? '未保存 · ' : 'Unsaved · ') : path ? (zh ? '已同步 · ' : 'Synced · ') : ''}
        {error && realtime ? (zh ? '实时同步已暂停 · ' : 'Live sync paused · ') : ''}
        {signature || (python ? `${python} · Ctrl+Space` : '')}
        {!connected && (zh ? ' · 已断开' : ' · Disconnected')}
      </footer>
    </section>
  );
}
