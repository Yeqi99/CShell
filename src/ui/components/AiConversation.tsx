import { submitsComposer } from '../composer-keys';
import { encodeComposerAttachments, validateComposerFiles } from '../composer-attachments';
import { conversationRows, ToolActivity, toolInput } from './AiToolRecord';
import { AiTaskTree } from './AiWork';
import { AiModelMenu } from './AiModelMenu';
import { useAiDrafts } from '../ai-drafts';
import { useExtensionCatalog } from '../use-extension-catalog';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Cpu,
  MessageSquare,
  Paperclip,
  Pencil,
  X,
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
  preferredModel,
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
  preferredModel?: string;
  setProviderId: (value: string, model?: string) => void;
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
  const [chosenModel,setChosenModel]=useState('');
  const initializedModel = useRef(false);
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
  const picker = useRef<HTMLInputElement>(null);
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, File[]>>({});
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [edit,setEdit]=useState<{id:string;index:number;time:number;value:string;error?:string}|null>(null);
  const editLock=useRef(false);
  const [forking,setForking]=useState(false);
  const visibleThread=useRef(thread?.id);
  visibleThread.current=thread?.id;
  async function reask(){
    if(!edit||!edit.value.trim()||editLock.current)return;
    editLock.current=true;setForking(true);
    try {
      const id=await window.cshell.aiReask(edit.id,edit.index,edit.time,edit.value);
      setEdit(null);
      if(visibleThread.current===edit.id) openThread(id);
    } catch(err){ setEdit(e=>e&&({...e,error:err instanceof Error?err.message:String(err)})); }
    finally {editLock.current=false;setForking(false);}
  }
  const files = attachmentDrafts[draftId] ?? [];
  function addFiles(incoming: File[]) {
    if (!incoming.length) return;
    try {
      const next = [...files, ...incoming];
      validateComposerFiles(next);
      setAttachmentDrafts(previous => ({ ...previous, [draftId]: next }));
      setSendErrors(previous => ({ ...previous, [draftId]: '' }));
      composer.current?.focus();
    } catch (error) {
      setSendErrors(previous => ({ ...previous, [draftId]: (error as Error).message }));
    }
  }
  const fileDrop = {
    onDragOver(event: React.DragEvent) {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setDraggingFiles(true);
    },
    onDragLeave(event: React.DragEvent) {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDraggingFiles(false);
    },
    onDrop(event: React.DragEvent) {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      setDraggingFiles(false);
      if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        setSendErrors(previous => ({ ...previous, [draftId]: '请选择文件夹中的具体文件。' }));
        return;
      }
      addFiles(Array.from(event.dataTransfer.files));
    },
  };
  const parent = thread?.parentId ? snapshot.threads.find(t => t.id === thread.parentId) : undefined;
  let resumeTarget = parent;
  while (resumeTarget?.parentId && resumeTarget.state !== 'running' && resumeTarget.state !== 'approval') {
    resumeTarget = snapshot.threads.find(t => t.id === resumeTarget!.parentId);
  }
  const resumeInMain = !!resumeTarget && !!parent && parent.state !== 'running' && parent.state !== 'approval';
  const active = thread?.state === 'running' || thread?.state === 'approval' || pendingSends.includes(draftId);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const provider = snapshot.providers.find((p) => p.id === (thread?.providerId ?? providerId));
  const { catalog, loading: modelsLoading, error: modelsError } = useExtensionCatalog(!thread ? provider?.extension : undefined);
  const modelChoices = catalog?.choices ?? [];
  const selectedModel = modelChoices.find(c => c.ref === chosenModel);
  const requiresModel = !thread && !!provider?.extension && !selectedModel?.available;
  const messageBody = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = viewport.current;
    const body = messageBody.current;
    if (!list || !body) return;
    follow.current = true;
    setAway(false);
    const bottom = () => { if (follow.current) list.scrollTop = list.scrollHeight; };
    bottom();
    const observer = new ResizeObserver(bottom);
    observer.observe(list);
    observer.observe(body);
    return () => observer.disconnect();
  }, [thread?.id]);
  useEffect(() => { setChosenModel(''); initializedModel.current = false; }, [provider?.id, provider?.extension?.model, thread?.id]);
  useEffect(() => {
    if (!thread && catalog) {
      const initial = !initializedModel.current;
      initializedModel.current = true;
      setChosenModel(previous => initial ? (catalog.choices.find(c => c.ref === preferredModel && c.available)?.ref ?? (catalog.current.available ? catalog.current.ref : ''))
        : catalog.choices.some(c => c.ref === previous && c.available) ? previous : '');
    }
  }, [catalog, thread?.id, preferredModel]);
  const send = (message = text, attachments = files, resume = false) => {
    if (active && attachments.length) {
      setSendErrors(previous => ({...previous, [draftId]: '运行中可以补充文字。附件可在本轮结束后发送。'}));
      return;
    }
    if (busy || sending.current.has(draftId) || (resumeInMain && sending.current.has(resumeTarget!.id)) || modelsLoading || requiresModel || (!resume && !message.trim() && !attachments.length) || !provider) return;
    follow.current = true;
    setAway(false);
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    sending.current.add(draftId);
    setPendingSends([...sending.current]);
    setSendErrors(previous => ({ ...previous, [draftId]: '' }));
    void (async () => {
      let targetId = draftId;
      try {
      const payload = attachments.length ? await encodeComposerAttachments(attachments) : undefined;
      const target = (resumeInMain ? resumeTarget : thread) ?? (await create(chosenModel || undefined));
      targetId = target.id;
      setSendErrors(previous => ({ ...previous, [targetId]: '' }));
      sending.current.add(targetId);
      setPendingSends([...sending.current]);
      await window.cshell.aiSend(targetId, message, payload, active, resume, resume && !thread?.resumeIdentity && !thread?.boundIdentity ? sessionId : undefined);
      if (attachments.length) setAttachmentDrafts(previous => ({
        ...previous, [draftId]: (previous[draftId] ?? []).filter(file => !attachments.includes(file)),
      }));
      if (resumeInMain) openThread(targetId);
      setDrafts((previous) => ({
        ...previous,
        [draftId]: previous[draftId] === message ? '' : previous[draftId],
      }));
      } catch (error) {
        setSendErrors(previous => ({ ...previous, [resumeInMain ? draftId : targetId]: error instanceof Error ? error.message : String(error) }));
        // Keep a newer draft. An unaccepted message remains available to edit.
        const original = resumeInMain ? draftId : targetId;
        if (original !== draftId && attachments.length) setAttachmentDrafts(previous => ({
          ...previous, [original]: [...attachments, ...(previous[original] ?? [])],
          [draftId]: (previous[draftId] ?? []).filter(file => !attachments.includes(file)),
        }));
        setDrafts(previous => ({ ...previous, [original]: previous[original] || message }));
      } finally {
        sending.current.delete(draftId);
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
      <div className="agent-conversation" {...fileDrop}>
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
          <div ref={messageBody} className="agent-message-body">
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
          {thread && conversationRows(thread.messages).map(({ message, index: i, tools }) =>
            tools ? (
              executionVisible ? (
                <ToolActivity messages={tools} key={`${thread.id}:${i}`} />
              ) : null
            ) : (
              <article className={`agent-message ${message.role}`} key={i}>
                <header>
                  <span className="agent-byline">{message.role === 'assistant' && <MessageSquare size={13} />} {message.role === 'user' ? '你' : 'CShell AI'}</span>
                  <span className="agent-message-actions">{message.role==='user' && !thread.parentId && !message.eventGenerated && <button type="button" className="icon-button" aria-label="编辑并重新提问" title="编辑并重新提问" disabled={forking} onClick={()=>setEdit({id:thread.id,index:i,time:message.time,value:message.attachmentBundle?message.content.split('\n').filter(line=>!line.startsWith('📎 ')).join('\n'):message.content})}><Pencil size={13}/></button>}
                  <CopyButton content={message.content} /></span>
                </header>
                <div className="agent-content">
                  {edit?.id===thread.id && edit.index===i ? <div className="agent-reask">
                    <textarea autoFocus aria-label="编辑之前的问题" value={edit.value} maxLength={32000} disabled={forking} onChange={e=>setEdit({...edit,value:e.target.value})}/>
                    <small>将在新会话中提问，原对话保留。{message.attachmentBundle?'原附件会随问题发送。':''}</small>
                    {edit.error && <small role="alert">{edit.error}</small>}
                    <div><button disabled={forking} onClick={()=>setEdit(null)}>取消</button><button disabled={forking||!edit.value.trim()} onClick={()=>void reask()}>重新提问</button></div>
                  </div> : message.role === 'assistant' ? (
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
          {thread?.error && <>
            <ErrorNotice conversation title={/任务已停止|已中断|应用已重启|已停止|等待授权/.test(thread.error) ? '任务已暂停。' : '这次回复没有完成。'} error={thread.error} />
            {!thread.parentId && !thread.goal && <button className="secondary" disabled={busy || active || !provider}
              onClick={() => send('', [], true)}>{!thread.boundIdentity && !thread.resumeIdentity && thread.sessionId && sessionId && thread.sessionId !== sessionId ? '在当前连接继续' : '继续任务'}</button>}
          </>}
          {draftError && <ErrorNotice conversation title="草稿暂未保存。" error={draftError} />}
          {sendErrors[draftId] && <ErrorNotice title="操作未完成" error={sendErrors[draftId]} />}
          {thread?.state === 'running' && (
            <div className="agent-running" role="status">
              <span className="agent-wait-dots" aria-hidden="true"><i/><i/><i/></span>
              {thread.modelRetry ? `正在重新连接模型（${thread.modelRetry}/2）` : thread.messages.at(-1)?.role === 'assistant' && thread.messages.at(-1)?.content ? '正在生成回复' : '正在思考与处理'}
            </div>
          )}
          </div>
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
        data-file-drag={draggingFiles || undefined}
        {...fileDrop}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {resumeInMain && <small>子任务已结束，下一条消息将发送到主任务。</small>}
        <input type="file" ref={picker} hidden multiple aria-label="选择附件" onChange={event => {
          addFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}/>
        {files.length > 0 && <ul className="agent-file-list" aria-label="待发送附件">{files.map((file, index) =>
          <li key={index}><Paperclip size={13}/><span title={file.name}>{file.name}</span>
            <button type="button" className="icon" aria-label={`移除 ${file.name}`} onClick={() =>
              setAttachmentDrafts(previous => ({ ...previous, [draftId]: previous[draftId].filter((_, i) => i !== index) }))
            }><X size={13}/></button></li>
        )}</ul>}
        <textarea
          onPaste={event => {
            if (event.clipboardData.files.length) {
              event.preventDefault();
              addFiles(Array.from(event.clipboardData.files));
            }
          }}
          ref={composer}
          aria-label="发送给智能体"
          title="Enter 发送，Shift+Enter 换行"
          placeholder={active ? '补充要求，智能体将在下一步处理…' : '描述任务或提出问题…'}
          value={text}
          onChange={(e) => setDrafts((previous) => ({ ...previous, [draftId]: e.target.value }))}
          onKeyDown={(e) => {
            if (
              submitsComposer(e)
            ) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="agent-composer-tools">
          <button className="icon" type="button" title="添加图片或文件" aria-label="添加图片或文件" onClick={() => picker.current?.click()}><Paperclip size={16}/></button>
          <div className="agent-model">
            <Cpu size={13} />
            <AiModelMenu providers={snapshot.providers} providerId={thread?.providerId??providerId} model={thread?.extensionModel??chosenModel} disabled={busy || active} configure={configure} onSelect={async(next,reference)=>{
              await run(async()=>{
                if(thread){await window.cshell.aiThreadProvider(thread.id,next,reference);setProviderId(next,reference);return;}
                const created=await window.cshell.aiThreadCreate(location,next,mode,sessionId,reference);
                setAttachmentDrafts(previous=>({...previous,[created.id]:previous[draftId] ?? [],[draftId]:[]}));
                setDrafts(previous=>({...previous,[created.id]:text}));setProviderId(next,reference);openThread(created.id);
              });
            }}/>
          </div>
          {modelsLoading && <span className="agent-thread-model" role="status">加载模型…</span>}
          {modelsError && <span className="agent-thread-model" title={modelsError}>模型目录暂不可用</span>}
          {requiresModel && !modelsLoading && !modelsError && catalog?.current.reason && <span className="agent-thread-model" role="status" title={catalog.current.reason}>{catalog.current.reason}</span>}
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
          {active && (
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
          )}
          {(!active || text.trim() || files.length > 0) && (
            <button
              className="primary icon agent-send"
              title={active ? '补充到当前任务 · Enter' : resumeInMain ? '发送到主任务 · Enter' : '发送 · Enter（Shift+Enter 换行）'}
              aria-label={active ? '补充到当前任务' : resumeInMain ? '发送到主任务' : '发送'}
              disabled={busy || modelsLoading || requiresModel || (!text.trim() && !files.length) || !provider}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </>
  );
}
