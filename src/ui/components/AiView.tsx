import { useEffect, useState } from 'react';
import type { AiSnapshot } from '../../shared/ai';
import { AiConversation } from './AiConversation';
import {useI18n} from '../i18n';
import './ai-panel.css';
import './ai-view.css';

/** A view keeps an explicit conversation reference; it never rebinds to the active terminal. */
export function AiView({ threadId }: { threadId: string }) {
  const {locale}=useI18n(); const text=(zh:string,en:string)=>locale==='en-US'?en:zh;
  const [snapshot, setSnapshot] = useState<AiSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const next = await window.cshell.aiSnapshot(); if (alive) setSnapshot(next); }
      catch (e) { if (alive) setError(String(e)); }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 800);
    return () => { alive = false; clearInterval(timer); };
  }, [threadId]);
  const thread = snapshot?.threads.find(t => t.id === threadId);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); setSnapshot(await window.cshell.aiSnapshot()); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <div className="view-ai agent-chat-page">
    {!snapshot ? <p role="status">{error || text('正在恢复智能体会话…','Restoring conversation…')}</p> : !thread ? <p role="status">{text('该智能体会话已删除或不可用，请在视图设置中重新选择。','This conversation is unavailable. Choose another in view settings.')}</p> : <>
      <AiConversation snapshot={snapshot} thread={thread} location={thread.location}
        providerId={thread.providerId} mode={thread.mode} sessionId={thread.sessionId}
        busy={busy} insertion={null} executionVisible={false}
        openThread={() => setError(text('请在主工作台中打开子任务，当前区域保留已保存的会话。','Open subtasks in the main workbench. This pane keeps its saved conversation.'))}
        setProviderId={() => {}} setMode={() => {}}
        create={async () => { throw Error(text('此区域只使用已保存的会话','This pane uses its saved conversation only')); }} run={run}
        configure={() => setError(text('请在主工作台配置智能体基座。','Configure the AI provider in the main workbench.'))}/>
      {error && <p role="alert" className="form-error">{error}</p>}
    </>}
  </div>;
}
