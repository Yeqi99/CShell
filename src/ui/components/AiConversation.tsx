import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Cpu,
  MessageSquare,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import {
  aiLocations,
  type AiSnapshot,
  type AiLocation,
  type AiMode,
  type AiThread,
} from '../../shared/ai';
const names = { workspace: '工作台', terminal: '终端', files: '文件', python: 'Python' };
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon"
      title={copied ? '已复制' : '复制内容'}
      aria-label="复制内容"
      onClick={() =>
        void navigator.clipboard
          .writeText(content)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }
      onBlur={() => setCopied(false)}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
function Content({ text }: { text: string }) {
  return (
    <>
      {text.split(/(```[\s\S]*?```)/g).map((part, i) => {
        const code = /^```([^\n]*)\n?([\s\S]*?)```$/.exec(part);
        return code ? (
          <div className="agent-code" key={i}>
            <header>
              <span>{code[1] || '代码'}</span>
              <CopyButton content={code[2].trimEnd()} />
            </header>
            <pre>{code[2].trimEnd()}</pre>
          </div>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}
export function AiConversation({
  snapshot,
  thread,
  location,
  providerId,
  mode,
  sessionId,
  busy,
  changeLocation,
  setProviderId,
  setMode,
  create,
  run,
  configure,
}: {
  snapshot: AiSnapshot;
  thread?: AiThread;
  location: AiLocation;
  providerId: string;
  mode: AiMode;
  sessionId?: string;
  busy: boolean;
  changeLocation: (value: AiLocation) => void;
  setProviderId: (value: string) => void;
  setMode: (value: AiMode) => void;
  create: () => Promise<AiThread>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  configure: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftId = thread?.id ?? `new:${location}`;
  const text = drafts[draftId] ?? '';
  const active = thread?.state === 'running' || thread?.state === 'approval';
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
  }, [thread?.id, thread?.messages.length, thread?.pending?.id, thread?.state]);
  const send = () => {
    if (busy || active || !text.trim() || !provider) return;
    void run(async () => {
      const target = thread ?? (await create());
      if (!thread) setDrafts((previous) => ({ ...previous, [target.id]: text }));
      await window.cshell.aiSend(target.id, text);
      setDrafts((previous) => ({
        ...previous,
        [draftId]: previous[draftId] === text ? '' : previous[draftId],
        [target.id]: previous[target.id] === text ? '' : previous[target.id],
      }));
    });
  };
  return (
    <>
      <div className="agent-context">
        <Terminal size={14} />
        {thread ? (
          <span>{names[thread.location]}</span>
        ) : (
          <select
            aria-label="AI 位置"
            value={location}
            onChange={(e) => changeLocation(e.target.value as AiLocation)}
          >
            {aiLocations.map((l) => (
              <option key={l} value={l}>
                {names[l]}
              </option>
            ))}
          </select>
        )}
        <span className="agent-target" title={thread?.target}>
          {thread?.target ?? (sessionId ? '当前服务器 · 新会话' : '仅对话 · 未绑定机器')}
        </span>
      </div>
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
              <details className="agent-tool" key={i}>
                <summary>
                  <Terminal size={13} />
                  工具执行记录
                </summary>
                <pre>{message.content}</pre>
                <CopyButton content={message.content} />
              </details>
            ) : (
              <article className={`agent-message ${message.role}`} key={i}>
                <header>
                  <span>{message.role === 'user' ? '你' : 'CShell AI'}</span>
                  <CopyButton content={message.content} />
                </header>
                <div className="agent-content">
                  <Content text={message.content} />
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
              <small>{thread.target}</small>
              <div className="agent-code">
                <header>{thread.pending.tool}</header>
                <pre>{thread.pending.arguments}</pre>
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
          {thread?.error && (
            <p className="form-error" role="alert">
              {thread.error}
            </p>
          )}
          {thread?.state === 'running' && (
            <div className="agent-running" role="status">
              <span />
              正在处理
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
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
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
            {thread ? (
              <span title={provider?.model}>{provider?.name ?? '基座已删除'}</span>
            ) : (
              <select
                aria-label="AI 基座"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
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
            )}
          </div>
          <div className="agent-policy">
            <ShieldCheck size={13} />
            <select
              aria-label="审核等级"
              title="执行审核策略；始终遵守已授权的机器与工具范围"
              disabled={active || busy}
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
              disabled={busy}
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
