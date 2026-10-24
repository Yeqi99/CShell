import { useEffect, useState } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import type { UpdateState } from '../../shared/updates';
export function UpdateSettings({ english }: { english: boolean }) {
  const [state, setState] = useState<UpdateState | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const t = (zh: string, en: string) => (english ? en : zh);
  useEffect(() => {
    let disposed = false;
    const refresh = () =>
      void window.cshell
        .updateState()
        .then((s) => {
          if (!disposed) setState(s);
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  const run = async (fn: () => Promise<unknown>, phase?: UpdateState['phase']) => {
    if (pending) return;
    setPending(true);
    setError('');
    if (phase) setState((s) => (s ? { ...s, phase, error: undefined } : s));
    try {
      await fn();
      setState(await window.cshell.updateState());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const busy = pending || !state || ['checking', 'downloading'].includes(state.phase);
  const failure = error || state?.error || '';
  const failureHint = /HTTP (403|429)/.test(failure)
    ? t(
        '香港下载服务 限制了当前网络的请求。请稍后重试，或打开下载页。',
        'The Hong Kong download service limited requests from this network. Retry later or open the downloads page.',
      )
    : /timeout|aborted|timed out/i.test(failure)
      ? t(
          '检查或下载超时，请检查网络和系统代理后重试。',
          'The request timed out. Check your network and system proxy, then retry.',
        )
      : /fetch|net::|network/i.test(failure)
        ? t(
            '无法连接香港下载服务，请检查网络和系统代理。',
            'Cannot reach the Hong Kong download service. Check your network and system proxy.',
          )
        : failure;
  const labels = {
    idle: t('从香港更新服务检查更新', 'Check the Hong Kong service for updates'),
    checking: t('正在检查更新…', 'Checking…'),
    current: t('当前已是最新可用版本', 'You have the latest available version'),
    unavailable: t(
      '尚未找到适用于此系统的完整安装包',
      'No complete package is available for this system',
    ),
    available: t('发现更新', 'Update available'),
    downloading: t('正在下载并校验…', 'Downloading and verifying…'),
    ready: t('安装包已通过 SHA256 校验', 'Package verified with SHA256'),
    error: t('更新未完成，可以重试', 'Update failed; retry available'),
  };
  return (
    <section className="update-settings">
      <h2>
        {t('应用更新', 'App updates')}
        <span className="update-version">v{state?.current || '…'}</span>
      </h2>
      {window.cshell.updateAutomatic && <label className="check"><input type="checkbox" checked={state?.automatic!==false} disabled={!state||pending} onChange={e=>void run(()=>window.cshell.updateAutomatic!(e.target.checked))}/>{t('自动检查并下载更新（安装前保留当前工作）','Automatically check and download updates')}</label>}
      <p className="muted">
        {t('当前版本', 'Current version')} {state?.current || '…'} ·{' '}
        {t('香港更新源', 'Hong Kong update service')}
      </p>
      <p role="status">
        {state ? labels[state.phase] : '…'}
        {state?.version && state.phase !== 'current' ? ' · ' + state.version : ''}
      </p>
      {state?.phase === 'downloading' && <progress max={100} value={state.progress || 0} />}
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={() => void run(() => window.cshell.checkUpdate(), 'checking')}
        >
          <RefreshCw size={14} />
          {state?.phase === 'checking'
            ? t('正在检查…', 'Checking…')
            : t('检查更新', 'Check for updates')}
        </button>
        {(state?.phase === 'available' ||
          (state?.phase === 'error' && state.retry === 'download')) && (
          <button
            type="button"
            className="primary"
            disabled={!!busy}
            onClick={() => void run(async () => { const result = await window.cshell.downloadUpdate(); if (result.phase === 'ready') await window.cshell.installUpdate(); }, 'downloading')}
          >
            <Download size={14} />
            {state.retry === 'download'
              ? t('重试更新', 'Retry update')
              : t('立即更新', 'Update now')}
          </button>
        )}
        {state?.phase === 'ready' && (
          <button
            type="button"
            className="primary"
            disabled={!!busy}
            onClick={() => void run(() => window.cshell.installUpdate())}
          >
            {t('安装并重新打开', 'Install and reopen')}
          </button>
        )}
        <button
          type="button"
          onClick={() => void window.cshell.openUpdatePage().catch((e) => setError(e.message))}
        >
          {t('其他设备下载', 'Downloads for other devices')}
        </button>
      </div>
      <p className="muted">
        {state?.platform === 'linux'
          ? t(
              'AppImage 更新会保留旧程序，保存工作后自动替换并重新打开。',
              'AppImage updates keep the previous program, replace it and reopen after saving work.',
            )
          : t(
              '安装通过系统安装程序完成，请先保存工作。',
              'Installation uses the system installer. Save your work first.',
            )}
      </p>
      <section className="settings-section">
        <h3>{t('错误日志', 'Error logs')}</h3>
        <p className="muted">{t('运行错误保存在本机，日志自动轮换。分享前请检查内容。', 'Runtime errors stay on this device and logs rotate automatically. Review before sharing.')}</p>
        <button type="button" className="secondary" onClick={() => void window.cshell.openDiagnostics().catch(e => setError(e.message))}>
          {t('打开日志目录', 'Open log folder')}
        </button>
      </section>
      {(error || state?.error) && (
        <p role="alert" className="error">
          {failureHint}
        </p>
      )}
    </section>
  );
}
