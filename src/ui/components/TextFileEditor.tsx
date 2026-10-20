import { useEffect, useState } from 'react';
import { PythonEditor } from './PythonEditor';
import { pluginEnabled } from '../../shared/plugins';
import './text-file-editor.css';

export function TextFileEditor({ sessionId, path, realtime = false }: { sessionId: string; path: string; realtime?: boolean }) {
  const [mode, setMode] = useState<'text' | 'shell' | 'python'>(/\.(sh|bash|zsh)$/.test(path) ? 'shell' : 'text');
  const [enabled, setEnabled] = useState(false);
  const [interpreters, setInterpreters] = useState<string[]>([]);
  const [python, setPython] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [connected, setConnected] = useState(true);
  useEffect(() => window.cshell.events(event => {
    if (event.type === 'closed' && event.sessionId === sessionId) setConnected(false);
  }), [sessionId]);
  useEffect(() => {
    let cancelled = false;
    void window.cshell.plugins().then(async plugins => {
      if (cancelled) return;
      const active = pluginEnabled(plugins, 'python'); setEnabled(active);
      if (!active) return;
      if (path.endsWith('.py')) setMode('python');
      const snapshot = await window.cshell.textEnvironments(sessionId, path);
      if (cancelled) return;
      const choices = [...new Set([...snapshot.environments.map(e => e.python), ...(snapshot.python ? [snapshot.python] : [])])];
      setInterpreters(choices);
      const directory = path.slice(0, path.lastIndexOf('/'));
      setPython(choices.find(p => p.startsWith(directory + '/.venv/')) || choices.find(p => /\/(?:\.venv|venv|env)\/bin\/python$/.test(p)) || snapshot.python || choices[0] || '');
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [sessionId, path]);
  return <section className={'text-file-editor' + (expanded ? ' expanded' : '')}>
    <div className="text-editor-options">
      <button onClick={() => setExpanded(value => !value)}>{expanded ? '还原编辑区' : '展开编辑区'}</button>
      <label>语言 <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
        <option value="text">纯文本</option><option value="shell">Shell</option>
        {enabled && <option value="python">Python</option>}
      </select></label>
      {mode === 'python' && <label>解释器 <select value={python} onChange={e => setPython(e.target.value)}>
        <option value="">选择环境</option>{interpreters.map(p => <option key={p} value={p}>{p}</option>)}
      </select></label>}
    </div>
    {error && <p role="alert">{error}</p>}
    <PythonEditor sessionId={sessionId} path={path} python={mode === 'python' ? python : ''} connected={connected}
      textFile initialRealtime={realtime} languageMode={mode} onDependency={() => window.dispatchEvent(new Event('cshell:open-extensions'))}/>
  </section>;
}
