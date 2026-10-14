import { useState } from 'react';
import { Pause, Play, Target, X } from 'lucide-react';
import type { AiSnapshot, AiThread } from '../../shared/ai';
import { goalStates } from '../../shared/ai-work';

export function AiTaskTree({
  thread,
  snapshot,
  open,
}: {
  thread?: AiThread;
  snapshot: AiSnapshot;
  open: (id: string) => void;
}) {
  if (!thread) return null;
  const children = snapshot.threads.filter((t) => t.parentId === thread.id);
  if (!children.length && !thread.parentId && !thread.goal) return null;
  const needsApproval = (t: AiThread): boolean =>
    t.state === 'approval' ||
    snapshot.threads.some((c) => c.parentId === t.id && c.state === 'approval');
  const waiting = children.filter(needsApproval).length;
  return (
    <div className="agent-task-tree">
      {thread.parentId && (
        <button className="secondary" onClick={() => open(thread.parentId!)}>
          返回主任务
        </button>
      )}
      {thread.goal && (
        <small>
          <Target size={13} /> {goalStates[thread.goal.state]} · {thread.goal.reason}
        </small>
      )}
      {!!children.length && (
        <details open={waiting > 0 || undefined}>
          <summary>
            子任务 · {children.length}
            {waiting ? ` · ${waiting} 项等待授权` : ''}
          </summary>
          {children.map((t) => (
            <button key={t.id} onClick={() => open(t.id)}>
              <span>{t.title}</span>
              <small>
                {needsApproval(t)
                  ? '等待授权'
                  : t.state === 'running'
                    ? '运行中'
                    : t.state === 'approval'
                      ? '等待授权'
                      : t.state === 'error'
                        ? '已停止 / 出错'
                        : '已完成'}
              </small>
            </button>
          ))}
        </details>
      )}
    </div>
  );
}

export function AiGoals({
  snapshot,
  sessionId,
  create,
  run,
  open,
  busy,
}: {
  snapshot: AiSnapshot;
  sessionId?: string;
  create: () => Promise<AiThread>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  open: (id: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [interval, setInterval] = useState(15);
  const goals = snapshot.threads.filter((t) => t.goal);
  const edit = (t?: AiThread) => {
    setEditing(t?.id ?? 'new');
    setObjective(t?.goal?.objective ?? '');
    setInterval(t?.goal?.intervalMinutes ?? 15);
  };
  return (
    <div className="agent-goals">
      <div className="ai-section-heading">
        <h3>目标</h3>
        <button
          className="secondary"
          disabled={busy || !snapshot.providers.length}
          onClick={() => edit()}
        >
          新建目标
        </button>
      </div>
      <p className="ai-section-note">
        默认每 15 分钟检查一次，仅在 CShell 打开时运行。达成或缺少条件时停止；运行中不重复触发。
      </p>
      {editing && (
        <form
          className="agent-goal-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!snapshot.policy.application.includes('goals.manage'))
                throw new Error('请先在“基座与权限”中开启“管理定期目标”');
              const target =
                editing === 'new'
                  ? await create()
                  : snapshot.threads.find((t) => t.id === editing)!;
              await window.cshell.aiGoalSave(target.id, { objective, intervalMinutes: interval });
              setEditing(null);
            });
          }}
        >
          <label>
            目标与完成条件
            <textarea
              aria-label="目标与完成条件"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="说明目标机器、检查范围和完成条件。删除容器时注明状态与停用时长。"
              required
              maxLength={8000}
            />
          </label>
          <label>
            检查间隔（分钟）
            <input
              aria-label="检查间隔（分钟）"
              type="number"
              min={1}
              max={10080}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </label>
          <small>
            {editing === 'new'
              ? sessionId
                ? '绑定当前连接，新建独立目标会话'
                : '请先连接目标机器'
              : snapshot.threads.find((t) => t.id === editing)?.target}
          </small>
          <footer>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              取消
            </button>
            <button className="primary" disabled={busy || (editing === 'new' && !sessionId)}>
              保存目标
            </button>
          </footer>
        </form>
      )}
      {!goals.length && !editing && (
        <p className="ai-section-note">暂无目标。也可在对话中请智能体设置定期检查。</p>
      )}
      {goals.map((t) => (
        <article key={t.id} className="agent-goal-card">
          <header>
            <button onClick={() => open(t.id)}>
              <strong>{t.goal!.objective}</strong>
            </button>
            <small>{goalStates[t.goal!.state]}</small>
          </header>
          <small>
            {t.target} · {snapshot.providers.find((p) => p.id === t.providerId)?.name} · 每{' '}
            {t.goal!.intervalMinutes} 分钟
          </small>
          <p>
            {t.state === 'approval'
              ? '等待执行授权，请打开会话查看'
              : t.state === 'running'
                ? '正在检查'
                : t.goal!.reason}
          </p>
          <small>
            {t.goal!.nextRun
              ? `下次 ${new Date(t.goal!.nextRun).toLocaleString()}`
              : `已检查 ${t.goal!.runs} 次`}
          </small>
          <footer>
            <button
              className="secondary"
              disabled={busy || t.state === 'running' || t.state === 'approval'}
              onClick={() => void run(() => window.cshell.aiGoalAction(t.id, 'run', sessionId))}
            >
              <Play size={13} />
              立即检查
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  window.cshell.aiGoalAction(
                    t.id,
                    t.goal!.state === 'active' ? 'pause' : 'resume',
                    sessionId,
                  ),
                )
              }
            >
              {t.goal!.state === 'active' ? <Pause size={13} /> : <Play size={13} />}
              {t.goal!.state === 'active' ? '暂停' : '恢复'}
            </button>
            <button
              className="secondary"
              disabled={busy || t.state === 'running' || t.state === 'approval'}
              onClick={() => edit(t)}
            >
              编辑
            </button>
            <button
              className="icon"
              aria-label="移除目标并保留会话"
              title="移除目标并保留会话"
              disabled={busy}
              onClick={() => void run(() => window.cshell.aiGoalAction(t.id, 'remove'))}
            >
              <X size={14} />
            </button>
          </footer>
          {!!t.goal!.history.length && (
            <details>
              <summary>检查记录</summary>
              {t
                .goal!.history.slice()
                .reverse()
                .map((h, i) => (
                  <p key={i}>
                    <small>{new Date(h.time).toLocaleString()}</small>
                    <br />
                    {h.summary}
                  </p>
                ))}
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
