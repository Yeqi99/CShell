import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  Download,
  RefreshCw,
  Settings2,
  Trash2,
  Link,
  HardDrive,
  Activity as ActivityIcon,
} from 'lucide-react';
import { activityKinds, type ActivitySnapshot } from '../../shared/activity';
import { useI18n } from '../i18n';
const names = {
  connection: '连接',
  file: '文件操作请求',
  transfer: '文件传输',
  ai: 'AI 请求',
  tool: '工具操作',
  deployment: '安装请求',
};
const date = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function ActivityPage({ active, servers }: { active: boolean; servers: number }) {
  const { locale } = useI18n(),
    cn = locale === 'zh-CN';
  const [snapshot, setSnapshot] = useState<ActivitySnapshot>({
    enabled: true,
    since: Date.now(),
    events: [],
  });
  const [from, setFrom] = useState(date(Date.now() - 29 * 86400000)),
    [to, setTo] = useState(date(Date.now()));
  const [tab, setTab] = useState('overview'),
    [kind, setKind] = useState('all'),
    [search, setSearch] = useState('');
  const [settings, setSettings] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  const refresh = async () => {
    setSnapshot(await window.cshell.activitySnapshot());
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const load = () =>
      void window.cshell
        .activitySnapshot()
        .then((s) => {
          if (!disposed) setSnapshot(s);
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    load();
    const timer = setInterval(load, 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [active]);
  useEffect(() => setPage(0), [from, to, kind, search]);
  const lower = new Date(from + 'T00:00:00').getTime(),
    upper = new Date(to + 'T23:59:59.999').getTime();
  const events = useMemo(
    () =>
      snapshot.events.filter(
        (e) =>
          e.time >= lower &&
          e.time <= upper &&
          (kind === 'all' || e.kind === kind) &&
          (!search ||
            `${names[e.kind]} ${e.action} ${e.provider}`
              .toLowerCase()
              .includes(search.toLowerCase())),
      ),
    [snapshot, lower, upper, kind, search],
  );
  const days = new Map<string, number>();
  for (const e of events) days.set(date(e.time), (days.get(date(e.time)) || 0) + 1);
  const providers = new Map<string, number>();
  for (const e of events) providers.set(e.provider, (providers.get(e.provider) || 0) + 1);
  const bytes = events.reduce((n, e) => n + (e.bytes || 0), 0),
    success = events.filter((e) => e.status === 'success').length;
  const tiles = Array.from({ length: 91 }, (_, i) => {
    const day = date(Date.now() - (90 - i) * 86400000);
    return { day, count: days.get(day) || 0 };
  });
  const peak = Math.max(1, ...tiles.map((t) => t.count));
  const exportFile = (format: 'csv' | 'html') =>
    run(() => window.cshell.activityExport(lower, upper, format));
  const stats = [
    { label: cn ? '记录的操作' : 'Recorded operations', value: events.length, Icon: ActivityIcon },
    {
      label: cn ? '成功连接' : 'Connections',
      value: events.filter((e) => e.kind === 'connection' && e.status === 'success').length,
      Icon: Link,
    },
    { label: cn ? '当前已保存连接' : 'Saved connections', value: servers, Icon: HardDrive },
    {
      label: cn ? '传输数据' : 'Transferred',
      value: (bytes / 1048576).toFixed(1) + ' MiB',
      Icon: Download,
    },
    { label: cn ? '活跃天数' : 'Active days', value: days.size, Icon: CalendarDays },
  ];
  return (
    <section className="activity-page" aria-label={cn ? '统计与历史' : 'Activity & history'}>
      <div className="activity-main">
        <header className="activity-heading">
          <span className="activity-emblem">
            <BarChart3 size={22} />
          </span>
          <div>
            <h1>{cn ? '统计与历史' : 'Activity & history'}</h1>
            <p>
              {cn
                ? '此设备上的连接、文件与 AI 操作记录'
                : 'Connections, files and AI activity on this device'}
            </p>
          </div>
          <button
            className="icon"
            title={cn ? '刷新统计' : 'Refresh'}
            aria-label={cn ? '刷新统计' : 'Refresh'}
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="icon"
            title={cn ? '统计设置' : 'Activity settings'}
            aria-label={cn ? '统计设置' : 'Activity settings'}
            aria-pressed={settings}
            onClick={() => setSettings(!settings)}
          >
            <Settings2 size={16} />
          </button>
        </header>
        <div className="activity-filters">
          <label>
            {cn ? '开始日期' : 'From'}
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                if (e.target.value) setFrom(e.target.value);
              }}
            />
          </label>
          <span>—</span>
          <label>
            {cn ? '结束日期' : 'To'}
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                if (e.target.value) setTo(e.target.value);
              }}
            />
          </label>
          <select
            aria-label={cn ? '记录类型' : 'Activity type'}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">{cn ? '所有操作' : 'All activity'}</option>
            {activityKinds.map((k) => (
              <option key={k} value={k}>
                {cn ? names[k] : k}
              </option>
            ))}
          </select>
        </div>
        <nav className="activity-tabs" aria-label={cn ? '统计视图' : 'Activity views'}>
          {[
            ['overview', cn ? '概览' : 'Overview'],
            ['records', cn ? '操作记录' : 'History'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {(error || snapshot.error) && (
          <p role="alert" className="form-error">
            {error || snapshot.error}
          </p>
        )}
        {!snapshot.enabled && (
          <p className="activity-notice">
            {cn
              ? '记录已暂停，已有历史仍可查看。'
              : 'Recording paused. Existing history remains available.'}
          </p>
        )}
        {tab === 'overview' ? (
          <>
            <div className="activity-stats">
              {stats.map(({ label, value, Icon }) => (
                <article key={label}>
                  <Icon size={18} />
                  <div>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                </article>
              ))}
            </div>
            <div className="activity-chart-grid">
              <section className="activity-card">
                <h2>{cn ? '操作活跃图' : 'Activity calendar'}</h2>
                <p className="muted">
                  {cn
                    ? '最近 13 周 · 所选日期范围内的记录'
                    : 'Last 13 weeks · Records within selected dates'}
                </p>
                <div className="activity-heatmap">
                  {tiles.map((t) => (
                    <div
                      key={t.day}
                      title={`${t.day} · ${t.count}`}
                      style={{
                        background: t.count
                          ? `color-mix(in srgb, var(--accent) ${25 + (75 * t.count) / peak}%, var(--panel))`
                          : undefined,
                      }}
                    />
                  ))}
                </div>
                <small>
                  {cn
                    ? '仅统计 CShell 已记录的操作，不读取终端输入内容。'
                    : 'Counts recorded operations; terminal input is never collected.'}
                </small>
              </section>
              <section className="activity-card">
                <h2>{cn ? '能力来源' : 'Capability sources'}</h2>
                {[...providers]
                  .sort((a, b) => b[1] - a[1])
                  .map(([provider, count]) => (
                    <div className="activity-provider" key={provider}>
                      <span>{provider}</span>
                      <meter value={count} max={events.length || 1} />
                      <strong>{count}</strong>
                    </div>
                  ))}
                {!events.length && (
                  <p className="muted">
                    {cn
                      ? '完成操作后显示真实分布。'
                      : 'Distribution appears after recorded activity.'}
                  </p>
                )}
              </section>
            </div>
            <section className="activity-card">
              <div className="activity-card-heading">
                <h2>{cn ? '近期记录' : 'Recent activity'}</h2>
                <button onClick={() => setTab('records')}>{cn ? '查看全部' : 'View all'}</button>
              </div>
              {events
                .slice(-6)
                .reverse()
                .map((e) => (
                  <div className="activity-recent" key={e.id}>
                    <span className={`activity-state ${e.status}`} />
                    <strong>{cn ? names[e.kind] : e.kind}</strong>
                    <span>{e.action}</span>
                    <time>{new Date(e.time).toLocaleString(locale)}</time>
                  </div>
                ))}
              {!events.length && (
                <div className="activity-empty">
                  <BarChart3 size={28} />
                  <h3>{cn ? '这个时间范围还没有记录' : 'No activity in this date range'}</h3>
                  <p>
                    {cn
                      ? '记录从启用此版本起开始，历史数据不会补造。'
                      : 'Records begin with this version; earlier activity is not reconstructed.'}
                  </p>
                </div>
              )}
            </section>
            <p className="activity-footnote">
              {cn
                ? `已完成请求 ${success} · 失败 ${events.filter((e) => e.status === 'failed').length} · 从 ${date(snapshot.since)} 开始记录`
                : `Completed requests ${success} · Recording since ${date(snapshot.since)}`}
            </p>
          </>
        ) : (
          <section className="activity-card">
            <input
              className="activity-search"
              aria-label={cn ? '搜索记录' : 'Search activity'}
              placeholder={cn ? '搜索操作或 Provider' : 'Search activity or provider'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="activity-table-wrap">
              <table>
                <thead>
                  <tr>
                    {(cn
                      ? ['时间', '类型', '操作', '结果', '耗时']
                      : ['Time', 'Type', 'Action', 'Result', 'Duration']
                    ).map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events
                    .slice()
                    .reverse()
                    .slice(page * 50, page * 50 + 50)
                    .map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.time).toLocaleString(locale)}</td>
                        <td>{cn ? names[e.kind] : e.kind}</td>
                        <td>{e.action}</td>
                        <td>
                          {cn
                            ? { success: '完成', failed: '失败', cancelled: '取消' }[e.status]
                            : e.status}
                        </td>
                        <td>{e.duration == null ? '—' : e.duration + ' ms'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="activity-pagination">
              <button disabled={!page} onClick={() => setPage(page - 1)}>
                {cn ? '上一页' : 'Previous'}
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(events.length / 50))}
              </span>
              <button disabled={(page + 1) * 50 >= events.length} onClick={() => setPage(page + 1)}>
                {cn ? '下一页' : 'Next'}
              </button>
            </div>
          </section>
        )}
      </div>
      {settings && (
        <aside className="activity-settings">
          <h2>{cn ? '统计设置' : 'Activity settings'}</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={snapshot.enabled}
              disabled={busy}
              onChange={(e) => {
                const enabled = e.currentTarget.checked;
                setSnapshot((s) => ({ ...s, enabled }));
                void run(() => window.cshell.activityEnable(enabled));
              }}
            />
            {cn ? '记录本机操作' : 'Record local activity'}
          </label>
          <p>
            {cn
              ? '仅保存在此设备，保留最近一年，最多 50,000 条。不保存密码、命令正文、文件路径或聊天内容。'
              : 'Stored on this device for up to one year / 50,000 records. No passwords, command text, file paths or chat content.'}
          </p>
          <h3>{cn ? '导出所选日期' : 'Export date range'}</h3>
          <button className="secondary" disabled={busy} onClick={() => void exportFile('csv')}>
            <Download size={14} />
            CSV
          </button>
          <button className="secondary" disabled={busy} onClick={() => void exportFile('html')}>
            <Download size={14} />
            HTML
          </button>
          <p>
            {cn
              ? '导出包含所选日期内所有类型的记录。连接次数为成功建立连接；文件与 AI 为请求次数，未统计手动 Shell 命令或 Token。'
              : 'Export includes all types in the date range. Connections count successful sessions. File and AI counts are requests, not shell commands or tokens.'}
          </p>
          <button
            className="danger secondary"
            disabled={busy}
            onClick={() => void run(() => window.cshell.activityClear())}
          >
            <Trash2 size={14} />
            {cn ? '清空记录' : 'Clear history'}
          </button>
        </aside>
      )}
    </section>
  );
}
