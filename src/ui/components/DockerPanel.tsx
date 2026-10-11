import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Layers,
  Play,
  Square,
  RotateCcw,
  Pause,
  Trash2,
  RefreshCw,
  Network,
  Plus,
  X,
  Search,
  ArrowLeft,
} from 'lucide-react';
import type {
  DockerAction,
  DockerContainer,
  DockerImage,
  DockerSnapshot,
  DockerStats,
  PortMapping,
} from '../../shared/docker';
import { useI18n } from '../i18n';

const size = (value: number) =>
  value >= 1073741824
    ? `${(value / 1073741824).toFixed(1)} GiB`
    : `${(value / 1048576).toFixed(1)} MiB`;
export function DockerPanel({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN';
  const [data, setData] = useState<DockerSnapshot | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loadError, setLoadError] = useState('');
  const [view, setView] = useState<'containers' | 'images'>('containers'),
    [filter, setFilter] = useState('all'),
    [query, setQuery] = useState('');
  const [selected, setSelected] = useState(''),
    [stats, setStats] = useState<DockerStats | null>(null),
    [statsError, setStatsError] = useState('');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [edit, setEdit] = useState<{ container?: DockerContainer; image?: DockerImage } | null>(null);
  const [ports, setPorts] = useState<PortMapping[]>([]),
    [name, setName] = useState(''),
    [restart, setRestart] = useState<'no' | 'unless-stopped' | 'always' | 'on-failure'>(
      'unless-stopped',
    );
  const alive = useRef(true),
    running = useRef(false),
    mutation = useRef(false),
    generation = useRef(0);
  const context = useRef({ active, selected });
  context.current = { active, selected };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  const refresh = async () => {
    if (running.current || mutation.current || !context.current.active) return;
    running.current = true;
    setLoading(true);
    const current = generation.current;
    try {
      const next = await window.cshell.dockerSnapshot(sessionId);
      if (!alive.current || current !== generation.current) return;
      setData(next);
      setLoadError('');
      if (!next.containers.some((c) => c.id === context.current.selected))
        setSelected(
          next.containers.find((c) => c.state === 'running')?.id || next.containers[0]?.id || '',
        );
    } catch (e) {
      if (alive.current && current === generation.current) {
        setData(null);
        setStats(null);
        setLoadError((e as Error).message);
      }
    } finally {
      running.current = false;
      if (alive.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [active, sessionId]);
  const container = data?.containers.find((c) => c.id === selected);
  useEffect(() => {
    setStats(null);
    setStatsError('');
    if (!active || view !== 'containers' || container?.state !== 'running' || busy) return;
    let disposed = false,
      pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await window.cshell.dockerStats(sessionId, selected);
        if (!disposed) {
          setStats(next);
          setStatsError('');
        }
      } catch (e) {
        if (!disposed) {
          setStats(null);
          setStatsError((e as Error).message);
        }
      } finally {
        pending = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [active, selected, container?.state, view, busy, sessionId]);
  const act = async (action: DockerAction) => {
    if (mutation.current) return;
    mutation.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await window.cshell.dockerAction(sessionId, action);
      if (!alive.current) return;
      if (result.id) setSelected(result.id);
      if (result.backup)
        setNotice(`${zh ? '已重建，旧容器保留为' : 'Recreated; backup'} ${result.backup}`);
      if (action.type === 'create' || (action.type === 'ports' && result.id)) {
        setEdit(null);
        setView('containers');
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      mutation.current = false;
      if (alive.current) {
        setBusy(false);
        void refresh();
      }
    }
  };
  const openPorts = async (item: DockerContainer) => {
    setError('');
    setBusy(true);
    try {
      const details = await window.cshell.dockerDetails(sessionId, item.id);
      if (details.managed)
        throw new Error(
          zh
            ? '此容器由 Compose / Swarm 管理，请在其部署配置中修改端口。'
            : 'Edit ports in the Compose / Swarm deployment definition.',
        );
      if (alive.current) {
        setPorts(details.ports);
        setEdit({ container: item });
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const icon = (label: string, node: React.ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="button"
      className="icon"
      title={label}
      aria-label={label}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {node}
    </button>
  );
  const list =
    data?.containers.filter(
      (c) =>
        (filter === 'all' ||
          (filter === 'running' && c.state === 'running') ||
          (filter === 'stopped' && ['exited', 'created', 'dead'].includes(c.state)) ||
          (filter === 'paused' && c.state === 'paused')) &&
        `${c.name} ${c.image} ${c.project} ${c.id}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const images =
    data?.images.filter((i) =>
      `${i.tags.join(' ')} ${i.id}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  return (
    <section className="docker-panel" aria-label="Docker">
      <div className="docker-toolbar">
        {edit ? (
          icon(zh ? '返回列表' : 'Back to list', <ArrowLeft size={15} />, () => setEdit(null))
        ) : (
          <div className="docker-view-switch">
            <button aria-pressed={view === 'containers'} onClick={() => setView('containers')}>
              <Box size={14} />
              {zh ? '容器' : 'Containers'}
            </button>
            <button aria-pressed={view === 'images'} onClick={() => setView('images')}>
              <Layers size={14} />
              {zh ? '镜像' : 'Images'}
            </button>
          </div>
        )}
        {icon(
          zh ? '刷新 Docker' : 'Refresh Docker',
          <RefreshCw size={15} className={loading ? 'spinning' : ''} />,
          () => void refresh(),
          loading,
        )}
      </div>
      {(error || loadError) && (
        <div className="docker-error" role="alert">
          {(error || loadError).replace(/^Error invoking remote method '[^']+': Error: /, '')}
          {!data && (
            <small>
              {zh
                ? '检查远端 Docker 是否运行，以及 SSH 用户的 Socket 访问和转发权限。'
                : 'Check Docker, socket permissions and SSH stream forwarding.'}
            </small>
          )}
        </div>
      )}
      {notice && (
        <div className="docker-notice" role="status">
          {notice}
        </div>
      )}
      {busy && (
        <div className="docker-progress" role="status">
          {zh ? '正在执行…' : 'Working…'}
        </div>
      )}
      {edit ? (
        <form
          className="docker-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              edit.container
                ? { type: 'ports', id: edit.container.id, ports }
                : { type: 'create', image: edit.image!.id, name, ports, restart, start: true },
            );
          }}
        >
          <fieldset disabled={busy}>
            <h3>
              {edit.container
                ? zh
                  ? '端口映射'
                  : 'Port mappings'
                : zh
                  ? '创建并启动'
                  : 'Create & start'}
            </h3>
            <p className="docker-resource-name">
              {edit.container?.name || edit.image?.tags[0] || edit.image?.id.slice(0, 19)}
            </p>
            {!edit.container && (
              <>
                <label>
                  {zh ? '容器名称' : 'Container name'}
                  <input
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  {zh ? '自动重启' : 'Restart policy'}
                  <select
                    value={restart}
                    onChange={(e) => setRestart(e.target.value as typeof restart)}
                  >
                    <option value="no">{zh ? '不自动重启' : 'Never'}</option>
                    <option value="unless-stopped">{zh ? '除非手动停止' : 'Unless stopped'}</option>
                    <option value="always">{zh ? '始终重启' : 'Always'}</option>
                    <option value="on-failure">{zh ? '失败时重启' : 'On failure'}</option>
                  </select>
                </label>
              </>
            )}
            <datalist id="docker-bind-addresses">
              <option value="127.0.0.1" />
              <option value="0.0.0.0" />
              <option value="::1" />
              <option value="::" />
            </datalist>
            <div className="docker-port-list">
              {ports.map((p, index) => (
                <div className="docker-port" key={index}>
                  <label>
                    {zh ? '监听地址' : 'Bind address'}
                    <input
                      required
                      aria-label={`${zh ? '监听地址' : 'Bind address'} ${index + 1}`}
                      list="docker-bind-addresses"
                      value={p.host}
                      onChange={(e) =>
                        setPorts(
                          ports.map((v, i) => (i === index ? { ...v, host: e.target.value } : v)),
                        )
                      }
                    />
                  </label>
                  <div className="docker-port-numbers">
                    {(['hostPort', 'containerPort'] as const).map((key) => (
                      <label key={key}>
                        {key === 'hostPort'
                          ? zh
                            ? '宿主端口'
                            : 'Host port'
                          : zh
                            ? '容器端口'
                            : 'Container port'}
                        <input
                          aria-label={`${key} ${index + 1}`}
                          required
                          type="number"
                          min={1}
                          max={65535}
                          value={p[key]}
                          onChange={(e) =>
                            setPorts(
                              ports.map((v, i) =>
                                i === index ? { ...v, [key]: Number(e.target.value) } : v,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                    <select
                      aria-label={`protocol ${index + 1}`}
                      value={p.protocol}
                      onChange={(e) =>
                        setPorts(
                          ports.map((v, i) =>
                            i === index ? { ...v, protocol: e.target.value as 'tcp' | 'udp' } : v,
                          ),
                        )
                      }
                    >
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                    </select>
                    {icon(zh ? '移除端口' : 'Remove port', <X size={14} />, () =>
                      setPorts(ports.filter((_, i) => i !== index)),
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="docker-add-port"
              onClick={() =>
                setPorts([
                  ...ports,
                  { host: '127.0.0.1', hostPort: 8080, containerPort: 80, protocol: 'tcp' },
                ])
              }
            >
              <Plus size={14} />
              {zh ? '添加端口' : 'Add port'}
            </button>
            {ports.some((p) => p.host === '0.0.0.0' || p.host === '::') && (
              <p className="muted">
                {zh ? '映射端口将监听所有网卡。' : 'Published ports will listen on all interfaces.'}
              </p>
            )}
            {edit.container && (
              <p className="muted">
                {zh
                  ? '应用时重建容器，保留文件层、挂载卷和旧容器备份。'
                  : 'Recreates the container, preserving its writable layer, volumes and a stopped backup.'}
              </p>
            )}
            <footer>
              <button type="button" onClick={() => setEdit(null)}>
                {zh ? '取消' : 'Cancel'}
              </button>
              <button className="primary">
                {edit.container
                  ? zh
                    ? '应用端口并重建'
                    : 'Apply & recreate'
                  : zh
                    ? '创建并启动'
                    : 'Create & start'}
              </button>
            </footer>
          </fieldset>
        </form>
      ) : (
        <>
          <div className="docker-search">
            <Search size={14} />
            <input
              aria-label={zh ? '搜索 Docker 资源' : 'Search Docker resources'}
              placeholder={zh ? '名称、镜像、项目…' : 'Name, image, project…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {view === 'containers' && (
            <div className="docker-filters">
              {[
                ['all', '全部', 'All'],
                ['running', '运行中', 'Running'],
                ['stopped', '已停止', 'Stopped'],
                ['paused', '已暂停', 'Paused'],
              ].map(([id, cn, en]) => (
                <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {zh ? cn : en}
                </button>
              ))}
            </div>
          )}
          <div className="docker-list">
            {!data && loading && (
              <p className="empty-small">{zh ? '正在读取 Docker…' : 'Loading Docker…'}</p>
            )}
            {data && !(view === 'containers' ? list : images).length && (
              <p className="empty-small">
                {query
                  ? zh
                    ? '没有匹配的资源'
                    : 'No matching resources'
                  : zh
                    ? '暂无资源'
                    : 'No resources'}
              </p>
            )}
            {view === 'containers'
              ? list.map((c) => (
                  <article
                    className={`docker-row ${selected === c.id ? 'selected' : ''}`}
                    key={c.id}
                  >
                    <button
                      className="docker-select"
                      onClick={() => setSelected(c.id)}
                      aria-pressed={selected === c.id}
                    >
                      <span className={`docker-dot ${c.state}`} />
                      <strong>{c.name}</strong>
                      <small>
                        {c.state === 'running'
                          ? zh
                            ? '运行中'
                            : 'Running'
                          : c.state === 'exited' || c.state === 'created'
                            ? zh
                              ? '已停止'
                              : 'Stopped'
                            : c.state}
                      </small>
                    </button>
                    <div className="docker-row-meta" title={c.image}>
                      {c.image}
                    </div>
                    {c.project && <span className="docker-project">{c.project}</span>}
                    {c.ports && <div className="docker-row-ports">{c.ports}</div>}
                    <div className="docker-row-actions">
                      {c.state === 'paused' ? (
                        icon(
                          zh ? '恢复容器' : 'Unpause container',
                          <Play size={14} />,
                          () => void act({ type: 'unpause', id: c.id }),
                        )
                      ) : c.state === 'running' ? (
                        <>
                          {icon(
                            zh ? '停止容器' : 'Stop container',
                            <Square size={14} />,
                            () => void act({ type: 'stop', id: c.id }),
                          )}
                          {icon(
                            zh ? '重启容器' : 'Restart container',
                            <RotateCcw size={14} />,
                            () => void act({ type: 'restart', id: c.id }),
                          )}
                          {icon(
                            zh ? '暂停容器' : 'Pause container',
                            <Pause size={14} />,
                            () => void act({ type: 'pause', id: c.id }),
                          )}
                        </>
                      ) : (
                        icon(
                          zh ? '启动容器' : 'Start container',
                          <Play size={14} />,
                          () => void act({ type: 'start', id: c.id }),
                        )
                      )}
                      {icon(
                        zh ? '设置端口映射' : 'Port mappings',
                        <Network size={14} />,
                        () => void openPorts(c),
                      )}
                      {icon(
                        zh ? '删除容器' : 'Delete container',
                        <Trash2 size={14} />,
                        () => void act({ type: 'remove', id: c.id }),
                        !['exited', 'created', 'dead'].includes(c.state),
                      )}
                      <small title={c.status}>{c.status}</small>
                    </div>
                  </article>
                ))
              : images.map((i) => (
                  <article className="docker-row" key={i.id}>
                    <strong className="docker-image-name">
                      {i.tags.join(', ') || (zh ? '未标记镜像' : 'Untagged image')}
                    </strong>
                    <div className="docker-row-meta">
                      {i.id.slice(7, 19)} · {size(i.size)}
                    </div>
                    <div className="docker-row-actions">
                      {icon(
                        zh ? '从镜像创建容器' : 'Create container from image',
                        <Play size={14} />,
                        () => {
                          setEdit({ image: i });
                          setPorts([]);
                          setName('');
                          setError('');
                        },
                      )}
                      {icon(
                        zh ? '删除镜像' : 'Delete image',
                        <Trash2 size={14} />,
                        () => void act({ type: 'removeImage', id: i.id }),
                      )}
                    </div>
                  </article>
                ))}
          </div>
          {view === 'containers' && container && (
            <section className="docker-stats" aria-label={zh ? '容器监控' : 'Container metrics'}>
              <header>
                <strong>{container.name}</strong>
                <small>{zh ? '每 5 秒' : 'Every 5s'}</small>
              </header>
              {container.state !== 'running' ? (
                <p className="muted">{zh ? '容器未运行' : 'Container is not running'}</p>
              ) : statsError ? (
                <p role="alert" className="form-error">
                  {statsError}
                </p>
              ) : !stats ? (
                <p className="muted">{zh ? '正在采集…' : 'Collecting…'}</p>
              ) : (
                <dl>
                  <div>
                    <dt>CPU</dt>
                    <dd>{stats.cpu === null ? '—' : `${stats.cpu.toFixed(1)}%`}</dd>
                  </div>
                  <div>
                    <dt>{zh ? '内存' : 'Memory'}</dt>
                    <dd>
                      {size(stats.memory)} / {size(stats.memoryLimit)}
                    </dd>
                  </div>
                  <div>
                    <dt>{zh ? '网络累计' : 'Network total'}</dt>
                    <dd>
                      ↓ {size(stats.rx)} · ↑ {size(stats.tx)}
                    </dd>
                  </div>
                  <div>
                    <dt>PIDs</dt>
                    <dd>{stats.pids ?? '—'}</dd>
                  </div>
                </dl>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
