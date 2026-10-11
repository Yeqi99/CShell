import { useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  Database,
  HardDrive,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import type { Metrics } from '../../shared/contracts';
import { useI18n } from '../i18n';

function capacity(bytes: number | null | undefined, locale: string) {
  if (bytes == null) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const unit = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log2(bytes || 1) / 10)));
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit) +
    ' ' +
    units[unit]
  );
}

export function MonitorPanel({
  sessionId,
  active = true,
}: {
  sessionId?: string;
  active?: boolean;
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [retry, setRetry] = useState(0);
  const [cpuUnavailable, setCpuUnavailable] = useState(false);
  const [failed, setFailed] = useState(false);
  const { t, locale } = useI18n();
  useEffect(() => {
    setMetrics(null);
    setHistory([]);
    setFailed(false);
    setCpuUnavailable(false);
    if (!sessionId || !expanded || !active) return;
    let missedCpu = 0;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await window.cshell.monitor(sessionId);
        if (!disposed) {
          missedCpu = next.cpu === null ? missedCpu + 1 : 0;
          setCpuUnavailable(missedCpu >= 3);
          setMetrics(next);
          setFailed(Boolean(next.error));
          if (next.cpu !== null) setHistory((h) => [...h, next.cpu!].slice(-30));
          else setHistory([]);
        }
      } catch {
        if (!disposed) {
          setFailed(true);
          setMetrics(null);
          setHistory([]);
        }
      } finally {
        if (!disposed) timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [sessionId, expanded, retry, active]);
  if (!sessionId || !active) return null;
  const percent = (n: number | null | undefined) =>
    n == null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n) + '%';
  const missing = failed || (metrics && (metrics.memory === null || metrics.disk === null));
  return (
    <section className="monitor-panel compact-monitor" aria-label={t('monitor')}>
      <header>
        <button
          className="resource-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Activity size={14} />
          {t('resources')}
        </button>
        {expanded && (
          <span className="resource-refresh">
            <small>{missing || cpuUnavailable ? t('unavailable') : t('metricsRefreshing')}</small>
            <button
              className="icon"
              title={t('retry')}
              aria-label={t('retry')}
              onClick={() => setRetry((v) => v + 1)}
            >
              <RefreshCw size={12} />
            </button>
          </span>
        )}
      </header>
      {expanded && (
        <div className="resource-rows">
          <div className="resource-row metric-cpu" data-tooltip={t('cpuMetricHint')} tabIndex={0}>
            <span className="resource-name">
              <Cpu size={13} />
              CPU
            </span>
            <span className="resource-detail">
              {metrics?.cpuCount ? metrics.cpuCount + ' ' + t('logicalCores') : '—'}
            </span>
            <strong>{percent(metrics?.cpu)}</strong>
            {history.length > 1 && (
              <svg
                className="resource-history"
                viewBox="0 0 100 20"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  points={history
                    .map((n, i) => (i * 100) / (history.length - 1) + ',' + (19 - n * 0.18))
                    .join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
          {metrics?.cpu == null && (
            <p className="resource-message">
              {failed || cpuUnavailable ? t('cpuUnavailable') : t('cpuSampling')}
            </p>
          )}
          {(['memory', 'disk'] as const).map((key) => {
            const Icon = key === 'memory' ? Database : HardDrive;
            const used = key === 'memory' ? metrics?.memoryUsed : metrics?.diskUsed;
            const total = key === 'memory' ? metrics?.memoryTotal : metrics?.diskTotal;
            return (
              <div
                className={'resource-row metric-' + key}
                key={key}
                data-tooltip={t(key === 'memory' ? 'memoryMetricHint' : 'diskMetricHint')}
                tabIndex={0}
              >
                <span className="resource-name">
                  <Icon size={13} />
                  {t(key)}
                </span>
                <span className="resource-detail" aria-label={t('usedTotal')}>
                  {capacity(used, locale)} / {capacity(total, locale)}
                </span>
                <strong>{percent(metrics?.[key])}</strong>
                {metrics?.[key] != null && (
                  <div
                    className="resource-meter"
                    role="meter"
                    aria-label={t(key)}
                    aria-valuenow={Math.min(100, metrics[key])}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: Math.max(0, Math.min(100, metrics[key])) + '%' }} />
                  </div>
                )}
              </div>
            );
          })}
          <div className="resource-row metric-latency">
            <span className="resource-name">
              <Activity size={13} />
              {t('latencyShort')}
            </span>
            <span className="resource-detail">SSH RTT</span>
            <strong>{metrics ? metrics.latency + ' ms' : '—'}</strong>
          </div>
          {missing && (
            <p className="resource-message" role="status">
              {t('monitorUnavailable')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
