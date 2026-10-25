import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { HardwareInfo, ProcessSnapshot } from '../../shared/resources';
import { useI18n } from '../i18n';

export function ResourceDetails({ sessionId, mode }: { sessionId: string; mode: 'gpu' | 'processes' | null }) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [gpuError, setGpuError] = useState(false);
  const [gpuRetry, setGpuRetry] = useState(0);
  const open = mode === 'processes';
  const [snapshot, setSnapshot] = useState<ProcessSnapshot | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [interval, setIntervalValue] = useState(() => {
    try {
      const v = Number(localStorage.getItem('cshell:process-refresh'));
      return [0, 5, 15, 30, 60].includes(v) ? v : 0;
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    if (mode !== 'gpu') return;
    let disposed = false;
    setHardware(null);
    setGpuError(false);
    void window.cshell.resourceHardware(sessionId).then(
      (value) => {
        if (!disposed) setHardware(value);
      },
      () => {
        if (!disposed) setGpuError(true);
      },
    );
    return () => {
      disposed = true;
    };
  }, [sessionId, gpuRetry, mode]);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      setBusy(true);
      try {
        const result = await window.cshell.resourceProcesses(sessionId);
        if (!disposed) {
          setSnapshot(result);
          setError('');
        }
      } catch {
        if (!disposed) { setSnapshot(null); setError(cn ? '获取失败，可重试' : 'Request failed. Retry.'); }
      } finally {
        if (!disposed) {
          setBusy(false);
          if (interval) timer = setTimeout(poll, interval * 1000);
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [sessionId, open, interval, refresh]);
  const rows =
    snapshot?.entries.filter((row) =>
      `${row.pid} ${row.user} ${row.command}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  return (
    <div className="resource-details" hidden={!mode}>
      <div className="gpu-inventory" hidden={mode !== 'gpu'}>
        <span>GPU</span>
        {hardware?.gpus.length ? (
          <div>
            {hardware.gpus.map((gpu, i) => (
              <div key={i} className="gpu-device">
                <span title={gpu.name}>{gpu.name}</span>
                {gpu.utilization != null && <strong>{gpu.utilization}%</strong>}
                {gpu.memoryTotal != null && (
                  <small>
                    {gpu.memoryUsed ?? '—'} / {gpu.memoryTotal} MiB
                  </small>
                )}
              </div>
            ))}
          </div>
        ) : (
          <small>
            {gpuError || hardware ? (cn ? '未检测到 / 不支持' : 'Unavailable / unsupported') : '—'}
          </small>
        )}
        <button
          className="icon"
          title={cn ? '重新检测 GPU' : 'Detect GPU'}
          aria-label={cn ? '重新检测 GPU' : 'Detect GPU'}
          onClick={() => setGpuRetry((v) => v + 1)}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="process-heading" hidden={!open}>
        <strong style={{marginRight: 'auto'}}>{cn ? '进程' : 'Processes'}</strong>
        {open && (
          <>
            <select
              aria-label={cn ? '进程刷新间隔' : 'Process refresh interval'}
              value={interval}
              onChange={(e) => {
                const value = Number(e.target.value);
                setIntervalValue(value);
                try {
                  localStorage.setItem('cshell:process-refresh', String(value));
                } catch {
                  /* Preferences may be unavailable. */
                }
              }}
            >
              <option value={0}>{cn ? '手动刷新' : 'Manual'}</option>
              {[5, 15, 30, 60].map((value) => (
                <option key={value} value={value}>
                  {value}s
                </option>
              ))}
            </select>
            <button
              className="icon"
              disabled={busy}
              title={cn ? '刷新进程' : 'Refresh processes'}
              aria-label={cn ? '刷新进程' : 'Refresh processes'}
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={12} />
            </button>
          </>
        )}
      </div>
      {open && (
        <div className="process-content" aria-busy={busy}>
          <input
            aria-label={cn ? '筛选进程' : 'Filter processes'}
            placeholder={cn ? '搜索名称、PID、用户' : 'Name, PID, user'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="process-status" role="status">
            {error ||
              (busy
                ? cn
                  ? '正在获取…'
                  : 'Refreshing…'
                : snapshot
                  ? `${new Date(snapshot.sampledAt).toLocaleTimeString(locale)}${snapshot.truncated ? ' · Top 500' : ''}`
                  : '—')}
          </div>
          <div className="process-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PID / {cn ? '进程' : 'Process'}</th>
                  <th
                    title={
                      cn
                        ? '进程生命周期平均 CPU，单核为 100%'
                        : 'Lifetime CPU average; 100% per core'
                    }
                  >
                    CPU
                  </th>
                  <th>RAM</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.pid}>
                    <td title={`${row.pid} · ${row.user} · ${row.command}`}>
                      <small>
                        {row.pid} · {row.user}
                      </small>
                      <span>{row.command}</span>
                    </td>
                    <td>{row.cpu}%</td>
                    <td>{row.memory}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
