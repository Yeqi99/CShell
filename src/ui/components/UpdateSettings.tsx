import { useEffect, useState } from 'react';
import type { UpdateState } from '../../shared/updates';
export function UpdateSettings({ english }: { english: boolean }) {
  const [state, setState] = useState<UpdateState | null>(null),
    [error, setError] = useState('');
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
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      setState(await window.cshell.updateState());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const busy = state && ['checking', 'downloading'].includes(state.phase);
  const labels = {
    idle: t('从 GitHub Releases 检查更新', 'Check GitHub Releases for updates'),
    checking: t('正在检查更新…', 'Checking…'),
    current: t('当前已是最新可用版本', 'You have the latest available version'),
    available: t('发现更新', 'Update available'),
    downloading: t('正在下载并校验…', 'Downloading and verifying…'),
    ready: t('安装包已通过 SHA256 校验', 'Package verified with SHA256'),
    error: t('更新未完成，可以重试', 'Update failed; retry available'),
  };
  return (
    <section className="update-settings">
      <h2>{t('应用更新', 'App updates')}</h2>
      <p className="muted">
        {t('当前版本', 'Current version')} {state?.current || '…'} ·{' '}
        {t('包含预览版', 'Includes previews')}
      </p>
      <p role="status">
        {state ? labels[state.phase] : '…'}
        {state?.version && state.phase !== 'current' ? ' · ' + state.version : ''}
      </p>
      {state?.phase === 'downloading' && <progress max={100} value={state.progress || 0} />}
      <div className="form-actions">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run(() => window.cshell.checkUpdate())}
        >
          {t('检查更新', 'Check for updates')}
        </button>
        {state?.phase === 'available' && (
          <button
            type="button"
            className="primary"
            onClick={() => void run(() => window.cshell.downloadUpdate())}
          >
            {t('下载更新', 'Download update')}
          </button>
        )}
        {state?.phase === 'ready' && (
          <button
            type="button"
            className="primary"
            onClick={() => void run(() => window.cshell.installUpdate())}
          >
            {state.platform === 'linux'
              ? t('打开安装包位置', 'Show package')
              : t('安装更新', 'Install update')}
          </button>
        )}
      </div>
      <p className="muted">
        {state?.platform === 'linux'
          ? t(
              'Linux 下载 AppImage；保留原文件后替换并授予执行权限。',
              'Linux downloads an AppImage. Replace the previous file and allow execution.',
            )
          : t(
              '安装通过系统安装程序完成，请先保存工作。',
              'Installation uses the system installer. Save your work first.',
            )}
      </p>
      {(error || state?.error) && (
        <p role="alert" className="error">
          {error || state?.error}
        </p>
      )}
    </section>
  );
}
