import { useState } from 'react';
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { aiEventRuleSchema, type AiEventRule, type AiEventSnapshot } from '../../shared/ai-events';
import type { AiThread } from '../../shared/ai';
import './ai-event-subscriptions.css';

export interface AiEventSubscriptionsProps extends AiEventSnapshot {
  error?: string;
  threads: Pick<AiThread, 'id' | 'title' | 'target' | 'providerId'>[];
  subscriptions?: { id: string; name: string; source: string }[];
  onSave: (rule: AiEventRule) => Promise<AiEventRule>;
  onRemove: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenThread: (id: string) => void;
  onStartSubscription?: (input: { source?:string; targets: string[]; leaseSeconds: number }) => Promise<unknown>;
}
const states = {
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  unknown: '结果未知',
  skipped: '已跳过',
};
const list = (text: string) => [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];

export function AiEventSubscriptions(props: AiEventSubscriptionsProps) {
  const { rules, sources, runs, threads, subscriptions = [] } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AiEventRule>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [listenTargets, setListenTargets] = useState('');
  const [leaseSeconds, setLeaseSeconds] = useState(1200);
  const [listenSource,setListenSource]=useState('wechat');
  const draft = selected ? drafts[selected] : undefined;
  const saved = rules.find((r) => r.id === selected);
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const source = sources.find((s) => s.id === draft?.source);
  const select = (rule: AiEventRule) => {
    setDrafts((old) => (old[rule.id] ? old : { ...old, [rule.id]: structuredClone(rule) }));
    setSelected(rule.id);
    setError('');
    setNotice('');
    setRemoveConfirm(false);
  };
  const patch = (value: Partial<AiEventRule>) => {
    if (draft) setDrafts((old) => ({ ...old, [draft.id]: { ...draft, ...value } }));
    setNotice('');
  };
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const create = () => {
    const available = sources.find((s) => s.available && s.eventTypes.length);
    select({
      id: crypto.randomUUID(),
      name: '',
      enabled: false,
      source: available?.id ?? '',
      eventType: available?.eventTypes[0]?.id ?? '',
      threadId: threads[0]?.id ?? '',
      prompt: '',
      filter: { conversationIds: [], senderIds: [], privateOnly: true, excludeSelf: true },
      cooldownSeconds: 30,
      maxRunsPerHour: 6,
      maxRunsPerDay: 30,
      reservedTokensPerRun: 32768,
      maxReservedTokensPerDay: 131072,
      maxModelCalls: 2,
    });
  };
  return (
    <section className="ai-event-subscriptions" aria-label="事件订阅">
      <div className="ai-section-heading">
        <h3>事件订阅</h3>
        <div className="event-actions">
          <button
            className="icon"
            title="刷新事件来源和执行记录"
            aria-label="刷新事件订阅"
            disabled={busy}
            onClick={() => void perform(props.onRefresh)}
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="icon"
            title="新建事件订阅"
            aria-label="新建事件订阅"
            disabled={
              busy || !sources.some((s) => s.available && s.eventTypes.length) || !threads.length
            }
            onClick={create}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      {(error || props.error) && (
        <p role="alert" className="form-error">
          {error || props.error}
        </p>
      )}
      {notice && (
        <p role="status" className="ai-section-note">
          {notice}
        </p>
      )}
      {!draft ? (
        <div className="event-list">
          {sources.some((s) => s.available) && props.onStartSubscription && (
            <details className="event-listener">
              <summary>
                微信消息监听 · {subscriptions.length} 个订阅
              </summary>
              <div className="event-options">
                <p className="ai-section-note">
                  触发规则使用插件推送的事件。监听到期后停止接收，启用规则不会自动开启监听。
                </p>
                <label>监听机器<select aria-label="监听机器" value={listenSource} onChange={e=>setListenSource(e.target.value)}>
                  {!sources.some(s=>s.id===listenSource&&s.available)&&<option value={listenSource}>请选择可用机器</option>}
                  {sources.filter(s=>s.available).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select></label>
                <label>
                  监听聊天内部 ID（每行一个）
                  <textarea
                    rows={3}
                    value={listenTargets}
                    onChange={(e) => setListenTargets(e.target.value)}
                    placeholder="filehelper"
                  />
                </label>
                <label>
                  监听时长（秒）
                  <input
                    type="number"
                    min={60}
                    max={86400}
                    step={1}
                    value={leaseSeconds}
                    onChange={(e) => setLeaseSeconds(Number(e.target.value))}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    !sources.some(s=>s.id===listenSource&&s.available)||
                    !list(listenTargets).length ||
                    !Number.isInteger(leaseSeconds) ||
                    leaseSeconds < 60 ||
                    leaseSeconds > 86400
                  }
                  onClick={() =>
                    void perform(async () => {
                      await props.onStartSubscription!({
                        source:listenSource,
                        targets: list(listenTargets),
                        leaseSeconds,
                      });
                      await props.onRefresh();
                      setNotice('消息监听已开启。请在规则中选择来源订阅。');
                    })
                  }
                >
                  开启消息监听
                </button>
                <p className="ai-section-note">只能监听已授权接收的聊天，不会修改微信权限。</p>
              </div>
            </details>
          )}
          {!sources.some((s) => s.available && s.eventTypes.length) && (
            <p className="ai-section-note">
              当前没有可用事件源。请先启用支持事件推送的扩展并配置订阅。
            </p>
          )}
          {!threads.length && (
            <p className="ai-section-note">先创建一个智能体会话，再选择由它处理事件。</p>
          )}
          {!rules.length && <p className="ai-section-note">还没有事件订阅。</p>}
          {rules.map((rule) => (
            <button key={rule.id} className="event-rule" onClick={() => select(rule)}>
              <strong>{rule.name}</strong>
              <span>
                {rule.enabled ? '已启用' : '已停用'} ·{' '}
                {sources.find((s) => s.id === rule.source)?.name ?? rule.source}
              </span>
            </button>
          ))}
          {Object.values(drafts)
            .filter((d) => !rules.some((r) => r.id === d.id))
            .map((d) => (
              <button key={d.id} className="event-rule" onClick={() => select(d)}>
                <strong>{d.name || '未命名订阅'}</strong>
                <span>未保存草稿</span>
              </button>
            ))}
        </div>
      ) : (
        <>
          <div className="event-editor-heading">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setError('');
                setNotice('');
              }}
            >
              <ArrowLeft size={14} />
              返回列表
            </button>
            <span>{dirty ? '未保存' : '已保存'}</span>
          </div>
          <form
            className="event-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const parsed = aiEventRuleSchema.safeParse(draft);
                if (!parsed.success)
                  throw new Error('请填写名称、事件、会话与提示词，并检查频率和预算范围。');
                if (
                  draft.enabled &&
                  (!source?.available || !source.eventTypes.some((t) => t.id === draft.eventType))
                )
                  throw new Error('事件源当前不可用，请恢复来源后启用。');
                const result = await props.onSave(parsed.data);
                setDrafts((old) => ({ ...old, [result.id]: result }));
                setNotice('已保存，后续事件按新配置处理。');
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                名称
                <input
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label>
                事件源
                <select
                  value={draft.source}
                  onChange={(e) => {
                    const s = sources.find((s) => s.id === e.target.value);
                    patch({
                      source: e.target.value,
                      eventType: s?.eventTypes[0]?.id ?? '',
                      subscriptionId: undefined,
                    });
                  }}
                >
                  {!source && <option value={draft.source}>来源不可用</option>}
                  {sources.map((s) => (
                    <option key={s.id} value={s.id} disabled={!s.available}>
                      {s.name}
                      {s.available ? '' : '（不可用）'}
                    </option>
                  ))}
                </select>
              </label>
              {source?.reason && <p className="ai-section-note">{source.reason}</p>}
              <label>
                触发事件
                <select
                  value={draft.eventType}
                  onChange={(e) => patch({ eventType: e.target.value })}
                >
                  {!source?.eventTypes.some((t) => t.id === draft.eventType) && (
                    <option value={draft.eventType}>事件不可用</option>
                  )}
                  {source?.eventTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                来源订阅
                <select
                  value={draft.subscriptionId ?? ''}
                  onChange={(e) => patch({ subscriptionId: e.target.value || undefined })}
                >
                  <option value="">此来源的全部已授权订阅</option>
                  {draft.subscriptionId &&
                    !subscriptions.some((s) => s.id === draft.subscriptionId) && (
                      <option value={draft.subscriptionId}>原订阅（当前不可用）</option>
                    )}
                  {subscriptions
                    .filter((s) => s.source === draft.source)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                处理事件的智能体会话
                <select
                  required
                  value={draft.threadId}
                  onChange={(e) => patch({ threadId: e.target.value })}
                >
                  {!threads.some((t) => t.id === draft.threadId) && (
                    <option value="">请选择会话</option>
                  )}
                  {threads.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} · {t.target || '本机 / 应用能力'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                提示词
                <textarea
                  required
                  maxLength={8000}
                  aria-label="提示词"
                  rows={5}
                  value={draft.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  placeholder="收到事件后，让这个智能体做什么…"
                />
              </label>
              <p className="ai-section-note">
                事件内容会随任务传入；执行仍受所选会话的权限与审核策略约束。
              </p>
              <details>
                <summary>事件筛选</summary>
                <div className="event-options">
                  <label className="event-check">
                    <input
                      type="checkbox"
                      checked={draft.filter.privateOnly}
                      onChange={(e) =>
                        patch({ filter: { ...draft.filter, privateOnly: e.target.checked } })
                      }
                    />
                    仅私聊
                  </label>
                  <label className="event-check">
                    <input
                      type="checkbox"
                      checked={draft.filter.excludeSelf}
                      onChange={(e) =>
                        patch({ filter: { ...draft.filter, excludeSelf: e.target.checked } })
                      }
                    />
                    忽略自己发出的事件
                  </label>
                  <label>
                    发送者内部 ID（每行一个，留空不限）
                    <textarea
                      rows={3}
                      value={draft.filter.senderIds.join('\n')}
                      onChange={(e) =>
                        patch({
                          filter: { ...draft.filter, senderIds: e.target.value.split('\n') },
                        })
                      }
                      onBlur={() =>
                        patch({
                          filter: {
                            ...draft.filter,
                            senderIds: list(draft.filter.senderIds.join('\n')),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    聊天内部 ID（每行一个，留空不限）
                    <textarea
                      rows={3}
                      value={draft.filter.conversationIds.join('\n')}
                      onChange={(e) =>
                        patch({
                          filter: { ...draft.filter, conversationIds: e.target.value.split('\n') },
                        })
                      }
                      onBlur={() =>
                        patch({
                          filter: {
                            ...draft.filter,
                            conversationIds: list(draft.filter.conversationIds.join('\n')),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </details>
              <details>
                <summary>频率与预算</summary>
                <div className="event-options event-limits">
                  {(
                    [
                      ['cooldownSeconds', '冷却秒数', 0, 86400],
                      ['maxRunsPerHour', '每小时最多执行', 1, 60],
                      ['maxRunsPerDay', '每天最多执行', 1, 200],
                      ['reservedTokensPerRun', '每次预留 token', 1024, 128000],
                      ['maxModelCalls', '每次最多模型调用', 1, 4],
                      ['maxReservedTokensPerDay', '每日预留 token 上限', 256, 1000000],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={min}
                        max={max}
                        step={1}
                        required
                        value={draft[key]}
                        onChange={(e) => patch({ [key]: Number(e.target.value) })}
                      />
                    </label>
                  ))}
                </div>
                <p className="ai-section-note">
                  预留预算限制一次任务的输入与输出总量，不代表模型实际计费 token。
                </p>
              </details>
              <label className="event-check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => patch({ enabled: e.target.checked })}
                />
                启用此订阅（保存后生效）
              </label>
              <div className="event-save">
                {!saved && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setDrafts((old) => {
                        const next = { ...old };
                        delete next[draft.id];
                        return next;
                      });
                      setSelected(null);
                      setError('');
                    }}
                  >
                    丢弃草稿
                  </button>
                )}
                <button className="primary" type="submit">
                  {busy ? '保存中…' : '保存'}
                </button>
                {saved && (
                  <button
                    type="button"
                    className="icon"
                    title="删除此事件订阅"
                    aria-label="删除此事件订阅"
                    onClick={() => setRemoveConfirm(true)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              {removeConfirm && (
                <div className="event-delete">
                  <p>删除“{saved?.name}”？后续事件将不再触发此订阅。</p>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setRemoveConfirm(false)}
                  >
                    保留
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() =>
                      void perform(async () => {
                        await props.onRemove(draft.id);
                        setDrafts((old) => {
                          const next = { ...old };
                          delete next[draft.id];
                          return next;
                        });
                        setSelected(null);
                        setRemoveConfirm(false);
                      })
                    }
                  >
                    确认删除
                  </button>
                </div>
              )}
            </fieldset>
          </form>
          <details className="event-runs" open>
            <summary>执行记录</summary>
            {!runs.some((r) => r.ruleId === draft.id) && (
              <p className="ai-section-note">暂无执行记录。</p>
            )}
            {runs
              .filter((r) => r.ruleId === draft.id)
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 50)
              .map((r) => (
                <div className="event-run" key={r.id}>
                  <div>
                    <strong>{states[r.status]}</strong>
                    <time>{new Date(r.createdAt).toLocaleString()}</time>
                  </div>
                  {r.reason && <p>{r.reason}</p>}
                  <button className="secondary" onClick={() => props.onOpenThread(r.threadId)}>
                    查看会话
                  </button>
                </div>
              ))}
          </details>
        </>
      )}
    </section>
  );
}
