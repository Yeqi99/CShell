import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { NetworkMetrics, ProcessNetworkSnapshot } from '../../shared/network-metrics';
import { useI18n } from '../i18n';
export function networkSize(bytes: number | null | undefined, rate = false) {
  if (bytes == null) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(4, Math.max(0, Math.floor(Math.log2(bytes || 1) / 10)));
  return `${(bytes / 1024 ** i).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[i]}${rate ? '/s' : ''}`;
}
export function NetworkDetails({
  network,
  sessionId,
}: {
  network?: NetworkMetrics;
  sessionId: string;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  const [snapshot, setSnapshot] = useState<ProcessNetworkSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const rows = network?.interfaces || [];
  const external = rows.filter((row) => row.name !== 'lo');
  const sum = (key: 'receivePerSecond' | 'sendPerSecond') =>
    external.length && external.every((row) => row[key] !== null)
      ? external.reduce((a, row) => a + row[key]!, 0)
      : null;
  return (
    <div className="network-details">
      <div className="network-totals">
        <span>
          {cn ? '接口合计' : 'Interface total'}
          <small>{cn ? '不含回环' : 'Excludes loopback'}</small>
        </span>
        <strong title={cn ? '接收' : 'Received'}>
          ↓ {networkSize(sum('receivePerSecond'), true)}
        </strong>
        <strong title={cn ? '发送' : 'Sent'}>↑ {networkSize(sum('sendPerSecond'), true)}</strong>
      </div>
      {network?.status === 'sampling' && (
        <small role="status">{cn ? '正在获取第二次采样…' : 'Waiting for the second sample…'}</small>
      )}
      {(!network || network.status === 'unavailable') && (
        <small role="status">{cn ? '网卡数据暂不可用' : 'Interface data unavailable'}</small>
      )}
      {rows.map((row) => (
        <details className="network-interface" key={row.name}>
          <summary>
            <span title={row.name}>{row.name}</span>
            <span>↓ {networkSize(row.receivePerSecond, true)}</span>
            <span>↑ {networkSize(row.sendPerSecond, true)}</span>
          </summary>
          <dl>
            <dt>{cn ? '累计接收 / 发送' : 'Received / sent total'}</dt>
            <dd>
              {networkSize(row.rxBytes)} / {networkSize(row.txBytes)}
            </dd>
            <dt>{cn ? '数据包 接收 / 发送' : 'Packets RX / TX'}</dt>
            <dd>
              {row.rxPackets.toLocaleString()} / {row.txPackets.toLocaleString()}
            </dd>
            <dt>{cn ? '错误 接收 / 发送' : 'Errors RX / TX'}</dt>
            <dd>
              {row.rxErrors} / {row.txErrors}
            </dd>
            <dt>{cn ? '丢包 接收 / 发送' : 'Drops RX / TX'}</dt>
            <dd>
              {row.rxDropped} / {row.txDropped}
            </dd>
          </dl>
        </details>
      ))}
      {!!rows.length && (
        <small className="network-note">
          {cn
            ? '按目标机内核计数采样；桥接和虚拟网卡可能重复计入合计。'
            : 'Sampled from target kernel counters. Bridges and virtual interfaces may overlap.'}
        </small>
      )}
      <details className="process-network">
        <summary>{cn ? '进程网络占用' : 'Traffic by process'}</summary>
        <div className="network-process-heading">
          <small>
            {snapshot
              ? new Date(snapshot.sampledAt).toLocaleTimeString()
              : cn
                ? '按需采样，不持续抓包'
                : 'On-demand sample, no continuous capture'}
          </small>
          <button
            className="icon"
            aria-label={cn ? '采样进程网络占用' : 'Sample traffic by process'}
            title={cn ? '采样约 3 秒' : 'Sample for about 3 seconds'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setSnapshot(null);
              setError(false);
              try {
                setSnapshot(await window.cshell.resourceProcessNetwork(sessionId));
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={13} />
          </button>
        </div>
        {busy && <small role="status">{cn ? '正在采样…' : 'Sampling…'}</small>}
        {error && (
          <p role="status">
            {cn
              ? '采样失败，请确认连接后重试。'
              : 'Sampling failed. Check the connection and retry.'}
          </p>
        )}
        {snapshot?.status === 'ready' && (
          <>
            <div className="network-process-list">
              {snapshot.entries.map((row, i) => (
                <div className="network-process-row" key={row.pid + ':' + i}>
                  <span title={row.name}>
                    {row.name}
                    <small>
                      PID {row.pid} · UID {row.uid}
                    </small>
                  </span>
                  <span>↓ {networkSize(row.receivePerSecond, true)}</span>
                  <span>↑ {networkSize(row.sendPerSecond, true)}</span>
                </div>
              ))}
            </div>
            {!snapshot.entries.length && (
              <small>
                {cn
                  ? '本次采样没有可归属的进程流量。'
                  : 'No attributable process traffic in this sample.'}
              </small>
            )}
            <small className="network-note">
              {cn
                ? 'NetHogs 捕获结果，不包含无法归属的流量。'
                : 'NetHogs capture excludes unattributed traffic.'}
            </small>
          </>
        )}
        {snapshot && snapshot.status !== 'ready' && (
          <p role="status">
            {snapshot.status === 'missing-tool'
              ? cn
                ? '目标机尚未安装 NetHogs。'
                : 'NetHogs is not installed on the target.'
              : cn
                ? '采样不可用：请检查 NetHogs、timeout 和抓包权限。'
                : 'Capture unavailable: check NetHogs, timeout and capture permissions.'}
          </p>
        )}
        <details className="network-help">
          <summary>{cn ? '如何启用' : 'Setup'}</summary>
          <p>
            {cn
              ? '在目标 Linux 安装 NetHogs。使用有抓包权限的账号连接后点击采样；这里不会自动安装或提权。可先在目标终端执行以下命令验证：'
              : 'Install NetHogs on the target Linux machine and connect with capture permissions. No automatic installation or elevation. Verify in the target terminal:'}
          </p>
          <code>sudo nethogs -t -v 0 -c 3 -d 1</code>
          <p>
            {cn
              ? '非 root 账号需由管理员按 NetHogs 官方说明配置 capabilities；仅能 sudo 不代表当前 SSH 会话已有抓包权限。'
              : 'For non-root accounts, an administrator must configure NetHogs capabilities; sudo access alone does not grant capture permissions to this SSH session.'}
          </p>
        </details>
      </details>
    </div>
  );
}
