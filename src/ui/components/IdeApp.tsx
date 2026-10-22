import { useEffect, useState } from 'react';
import { Code2, RotateCw } from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
import { MachineBrowser } from './MachineBrowser';
export function IdeApp({
  call,
  target,
  active,
}: {
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
  target: string;
  active: boolean;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
    setUrl('');
    void (async () => {
      const state = (await call('ide.status')) as any;
      if (!alive) return;
      if (!state.ready) throw Error('代码编辑器尚未安装完成，请在应用市场完成安装。');
      if (!state.launchVersion) throw Error('请更新这台机器的 cagent 后重试。');
      const result = (await call('ide.start', { cwd: state.running?.cwd || '' })) as any;
      if (alive) setUrl(result.url);
    })().catch((e) => {
      if (alive) setError(String(e));
    });
    return () => {
      alive = false;
    };
  }, [call, target, attempt]);
  if (url && !error)
    return (
      <MachineBrowser
        target={'ide@' + (target.startsWith('ssh:') ? target.slice(4) : target)}
        name="代码编辑器"
        active={active}
        appUrl={url}
      />
    );
  return (
    <section className="machine-app-launch" role={error ? 'alert' : 'status'}>
      <Code2 size={36} />
      <h2>{error ? '代码编辑器未能打开' : '正在打开代码编辑器'}</h2>
      {error && (
        <>
          <p>{error}</p>
          <button onClick={() => setAttempt((v) => v + 1)}>
            <RotateCw size={16} />
            重试
          </button>
        </>
      )}
    </section>
  );
}
