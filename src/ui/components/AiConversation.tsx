import { AiToolRecord, toolInput } from './AiToolRecord';
import { AiTaskTree } from './AiWork';
import { useAiDrafts } from '../ai-drafts';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Cpu,
  MessageSquare,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import { CopyButton } from './AiCopyButton';
import { AiMarkdown } from './AiMarkdown';
import { AiStreamingMarkdown } from './AiStreamingMarkdown';
import { ErrorNotice } from './ErrorNotice';
import { type AiSnapshot, type AiLocation, type AiMode, type AiThread } from '../../shared/ai';
export function AiConversation({
  openThread,
  insertion,
  snapshot,
  thread,
  location,
  providerId,
  mode,
  sessionId,
  busy,
  setProviderId,
  setMode,
  create,
  run,
  configure,
  executionVisible,
}: {
  openThread: (id: string) => void;
  insertion: { id: string; text: string; threadId: string } | null;
  snapshot: AiSnapshot;
  thread?: AiThread;
  location: AiLocation;
  providerId: string;
  mode: AiMode;
  sessionId?: string;
  busy: boolean;
  setProviderId: (value: string) => void;
  setMode: (value: AiMode) => void;
  create: (model?: string) => Promise<AiThread>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  configure: () => void;
  executionVisible: boolean;
}) {
  const [drafts, setDrafts, draftError] = useAiDrafts();
  // Submission has its own per-conversation lock; a slow save must not block
  // sending or stopping a different conversation in the same panel.
  const sending = useRef(new Set<string>());
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [pendingSends, setPendingSends] = useState<string[]>([]);
  const [modelChoices,setModelChoices]=useState<{ref:string;model:string;label?:string;available:boolean}[]>([]);
  const [chosenModel,setChosenModel]=useState('');
  const [modelsLoading,setModelsLoading]=useState(false);
  const [modelsError,setModelsError]=useState('');
  const composer = useRef<HTMLTextAreaElement>(null),
    inserted = useRef('');
  useEffect(() => {
    if (!insertion || inserted.current === insertion.id) return;
    inserted.current = insertion.id;
    setDrafts((previous) => ({
      ...previous,
      [insertion.threadId]:
        (previous[insertion.threadId] ? previous[insertion.threadId] + '\n\n' : '') +
        insertion.text,
    }));
    requestAnimationFrame(() => {
      const input = composer.current;
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.scrollTop = input.scrollHeight;
      }
    });
  }, [insertion]);
  const draftId = thread?.id ?? `new:${location}`;
  const text = drafts[draftId] ?? '';
  const active = thread?.state === 'running' || thread?.state === 'approval' || pendingSends.includes(draftId);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const provider = snapshot.providers.find((p) => p.id === (thread?.providerId ?? providerId));
  useEffect(() => {
    follow.current = true;
    setAway(false);
  }, [thread?.id]);
  useEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [
    thread?.id,
    thread?.messages.length,
    thread?.messages.at(-1)?.content,
    thread?.pending?.id,
    thread?.state,
  ]);
  useEffect(()=>{
    let alive=true;setChosenModel('');setModelChoices([]);setModelsError('');
    setModelsLoading(!!provider?.extension && !thread);
    if(provider?.extension && !thread)void window.cshell.aiExtensionCall(provider.extension.id,'choices',{reference:provider.extension.model,refresh:true}).then(v=>{
      if(!alive)return;
      if(!Array.isArray(v))throw Error('模型目录不可用');
      const choices=v as typeof modelChoices;
      setModelChoices(choices);
      const ref=provider.extension!.model;
      setChosenModel(choices.find(c=>c.ref===ref)?.ref ?? choices.find(c=>c.ref===`default/${ref}`)?.ref ?? '');
    }).catch(e=>{if(alive)setModelsError(String(e.message??e))}).finally(()=>{if(alive)setModelsLoading(false)});
    return()=>{alive=false};
  },[provider?.id,provider?.extension?.model,thread?.id]);
  const send = () => {
    if (busy || active || sending.current.has(draftId) || modelsLoading || !text.trim() || !provider) return;
    sending.current.add(draftId);
    setPendingSends([...sending.current]);
    setSendErrors(previous => ({ ...previous, [draftId]: '' }));
    void (async () => {
      let targetId = draftId;
      try {
      const target = thread ?? (await create(chosenModel || undefined));
      targetId = target.id;
      setSendErrors(previous => ({ ...previous, [targetId]: '' }));
      sending.current.delete(draftId);
      sending.current.add(targetId);
      setPendingSends([...sending.current]);
      await window.cshell.aiSend(targetId, text);
      setDrafts((previous) => ({
        ...previous,
        [draftId]: previous[draftId] === text ? '' : previous[draftId],
      }));
      } catch (error) {
        setSendErrors(previous => ({ ...previous, [targetId]: error instanceof Error ? error.message : String(error) }));
        // Keep a newer draft. An unaccepted message remains available to edit.
        setDrafts(previous => ({ ...previous, [targetId]: previous[targetId] || text }));
      } finally {
        sending.current.delete(targetId);
        setPendingSends([...sending.current]);
      }
    })();
  };
  return (
    <>
      {(thread?.target || (!thread && sessionId)) && <div className="agent-context">
        {thread?.sessionId || (!thread && sessionId) ? (
          <Terminal size={14} />
        ) : (
          <MessageSquare size={14} />
        )}
        <span className="agent-target" title="全局智能体权限">
          {thread
            ? thread.target
            : '当前连接 · 新会话'}
        </span>
      </div>}
      <AiTaskTree thread={thread} snapshot={snapshot} open={openThread} />
      <div className="agent-conversation">
        <div
          className="agent-messages"
          ref={viewport}
          onScroll={() => {
            const el = viewport.current!;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            setAway(!follow.current);
          }}
          aria-live="polite"
          aria-relevant="additions text"
        >
          {!thread?.messages.length && (
            <div className="agent-welcome">
              <div className="agent-emblem">
                <MessageSquare size={23} />
              </div>
              <h3>{provider ? '从一个任务开始' : '连接你的 AI'}</h3>
              <p>
                {provider
                  ? '描述要完成的工作，执行过程会显示在这里。'
                  : '添加模型基座，即可在工作台发起对话。'}
              </p>
              {!provider && (
                <button className="primary" onClick={configure}>
                  <Cpu size={14} />
                  配置基座
                </button>
              )}
            </div>
          )}
          {thread?.messages.map((message, i) =>
            message.role === 'tool' ? (
              executionVisible ? (
                <AiToolRecord message={message} key={i} />
              ) : null
            ) : (
              <article className={`agent-message ${message.role}`} key={i}>
                <header>
                  <span>{message.role === 'user' ? '你' : 'CShell AI'}</span>
                  <CopyButton content={message.content} />
                </header>
                <div className="agent-content">
                  {message.role === 'assistant' ? (
                    i === thread.messages.length - 1 && active ? (
                      <AiStreamingMarkdown key={`${thread.id}:${i}`} text={message.content} streaming={thread.state === 'running'} onReveal={() => {
                        if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
                      }} />
                    ) : <AiMarkdown text={message.content} />
                  ) : (
                    message.content
                  )}
                </div>
              </article>
            ),
          )}
          {thread?.pending && (
            <section className="agent-approval">
              <header>
                <ShieldCheck size={16} />
                <strong>等待执行授权</strong>
              </header>
              <p>{thread.pending.reason}</p>
              <small>{thread.pending.target ?? thread.target}</small>
              <div className="agent-code">
                <header>{thread.pending.tool}</header>
                {toolInput(thread.pending.arguments) && (
                  <>
                    <small>输入</small>
                    <pre>{toolInput(thread.pending.arguments)}</pre>
                  </>
                )}
              </div>
              <footer>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => window.cshell.aiApprove(thread.id, thread.pending!.id, false))
                  }
                >
                  拒绝
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => window.cshell.aiApprove(thread.id, thread.pending!.id, true))
                  }
                >
                  <Check size={14} />
                  允许本次
                </button>
              </footer>
            </section>
          )}
          {thread?.checkpoint && <details className="agent-checkpoint"><summary>任务检查点 · {thread.checkpoint.phase}</summary>{thread.checkpoint.memory&&<><p>{thread.checkpoint.memory.objective}</p><p>待完成：{thread.checkpoint.memory.remaining.join('；')||'未记录'}</p><p>验证：{thread.checkpoint.memory.verification.join('；')||'尚未记录验收证据'}</p></>}{thread.checkpoint.pending&&<p>结果待核查：{thread.checkpoint.pending.tool}。继续前检查实际状态，勿直接重跑。</p>}<small>{new Date(thread.checkpoint.updatedAt).toLocaleString()}</small></details>}
          {thread?.error && (
            <ErrorNotice title="这次回复未完成" error={thread.error} />
          )}
          {draftError && <ErrorNotice title="草稿保存" error={draftError} />}
          {sendErrors[draftId] && <ErrorNotice title="消息未发送" error={sendErrors[draftId]} />}
          {thread?.state === 'running' && (
            <div className="agent-running" role="status">
              <span className="agent-wait-dots" aria-hidden="true"><i/><i/><i/></span>
              {thread.messages.at(-1)?.role === 'assistant' && thread.messages.at(-1)?.content ? '正在生成回复' : '正在思考与处理'}
            </div>
          )}
        </div>
        {away && (
          <button
            className="agent-latest icon"
            title="回到最新消息"
            aria-label="回到最新消息"
            onClick={() => {
              follow.current = true;
              viewport.current!.scrollTop = viewport.current!.scrollHeight;
              setAway(false);
            }}
          >
            <ArrowDown size={15} />
          </button>
        )}
      </div>
      <form
        className="agent-composer"
        hidden={!provider}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={composer}
          aria-label="发送给智能体"
          placeholder={active ? '可以先写下一个任务…' : '描述任务或提出问题…'}
          value={text}
          onChange={(e) => setDrafts((previous) => ({ ...previous, [draftId]: e.target.value }))}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="agent-composer-tools">
          <div className="agent-model">
            <Cpu size={13} />
            {(
              <div
                className="agent-model-picker"
                title={thread ? '切换模型并开始新会话，保留当前会话' : provider?.model}
              >
                <span>
                  {provider?.name || '选择基座'}
                </span>
                <select
                  aria-label="AI 基座"
                  value={thread?.providerId ?? providerId}
                  disabled={active || busy}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!thread) { setProviderId(next); return; }
                    void run(async () => {
                      const created = await window.cshell.aiThreadCreate(thread.location, next, thread.mode, thread.sessionId);
                      setDrafts(previous => ({ ...previous, [created.id]: text }));
                      setProviderId(next);
                      openThread(created.id);
                    });
                  }}
                >
                  <option value="" disabled>
                    选择基座
                  </option>
                  {snapshot.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.model}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {!thread && modelChoices.length>0 && <select className="agent-account-model" aria-label="账号模型" value={chosenModel} onChange={e=>setChosenModel(e.target.value)}>{modelChoices.map(c=><option key={c.ref} value={c.ref} disabled={!c.available}>{c.label??c.model}</option>)}</select>}
          {modelsLoading && <span className="agent-thread-model" role="status">加载模型…</span>}
          {modelsError && <span className="agent-thread-model" title={modelsError}>模型目录暂不可用</span>}
          {thread?.extensionModel && <span className="agent-thread-model" title={thread.extensionModel}>{thread.extensionModel.split('/').slice(1).join(' / ')}</span>}
          <div className="agent-policy">
            <ShieldCheck size={13} />
            <select
              aria-label="审核等级"
              title="执行审核策略；始终遵守已授权的机器与工具范围"
              disabled={active || busy || !!thread?.parentId}
              value={thread?.mode ?? mode}
              onChange={(e) => {
                const value = e.target.value as AiMode;
                setMode(value);
                if (thread) void run(() => window.cshell.aiMode(thread.id, value));
              }}
            >
              <option value="review">全提示</option>
              <option value="restricted">限制执行</option>
              <option value="allow">全放行</option>
            </select>
          </div>
          {active ? (
            <button
              type="button"
              className="icon agent-send"
              title="停止执行"
              aria-label="停止 AI"
              disabled={busy || !thread}
              onClick={() => void run(() => window.cshell.aiStop(thread!.id))}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              className="primary icon agent-send"
              title="发送 · Enter（Shift+Enter 换行）"
              aria-label="发送"
              disabled={busy || !text.trim() || !provider}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </>
  );
}
