import { useEffect, useState } from 'react';
import type { CloudStatus } from '../../shared/cloud-sync';

export function CloudSettings() {
  const [passwordMode, setPasswordMode] = useState(true);
  const [status, setStatus] = useState<CloudStatus>();
  const [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [key, setKey] = useState('');
  const [recovery, setRecovery] = useState(''),
    [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [direction, setDirection] = useState<'upload' | 'download'>();
  const refresh = () => window.cshell.cloudStatus().then(setStatus);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section cloud-settings">
      <h3>账号与云同步 · Pro</h3>
      <p className="muted">
        连接、已保存凭据、基座模型、设置方案和视图加密同步。机器权限与运行中的会话保留在各自设备。
      </p>
      {!status?.email ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await window.cshell.cloudLogin(email, code, passwordMode);
              setCode('');
            });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              邮箱
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button type="button" className="secondary" onClick={() => {setPasswordMode(!passwordMode);setCode('');}}>{passwordMode ? '使用邮箱验证码' : '使用密码登录'}</button>
            {!passwordMode && <button
              type="button"
              className="secondary"
              onClick={() =>
                void run(async () => {
                  await window.cshell.cloudRequestCode(email);
                  setMessage('验证码已发送，10 分钟内有效。');
                })
              }
            >
              发送验证码
            </button>}
            <label>
              {passwordMode ? '密码' : '验证码'}
              <input
                type={passwordMode ? 'password' : 'text'}
                inputMode={passwordMode ? undefined : 'numeric'}
                autoComplete={passwordMode ? 'current-password' : 'one-time-code'}
                pattern={passwordMode ? undefined : '[0-9]{6}'}
                maxLength={passwordMode ? 128 : 6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className="primary">注册 / 登录</button>
          </fieldset>
        </form>
      ) : (
        <>
          <p>
            <strong>{status.email}</strong> · 云端版本 {status.revision}
          </p>
          {!status.unlocked ? (
            <fieldset disabled={busy}>
              <label>
                保险库恢复密钥
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <button
                className="primary"
                onClick={() =>
                  void run(async () => {
                    await window.cshell.cloudUnlock(key);
                    setKey('');
                  })
                }
              >
                解锁已有保险库
              </button>
              <button
                className="secondary"
                onClick={() =>
                  void run(async () => {
                    const result = await window.cshell.cloudCreateVault();
                    setRecovery(result.recoveryKey);
                    setSaved(false);
                  })
                }
              >
                首次使用：创建保险库
              </button>
            </fieldset>
          ) : (
            <>
              {recovery && (
                <div className="cloud-recovery">
                  <strong>请保存恢复密钥</strong>
                  <p>新设备需要它解密配置。邮箱验证码不能找回密钥。</p>
                  <textarea readOnly aria-label="保险库恢复密钥" value={recovery} />
                  <label>
                    <input
                      type="checkbox"
                      checked={saved}
                      onChange={(e) => setSaved(e.target.checked)}
                    />
                    我已保存在安全位置
                  </label>
                </div>
              )}
              <p className="muted">
                {status.lastSync
                  ? '最近同步：' + new Date(status.lastSync).toLocaleString()
                  : '尚未同步。首次在原设备上传，在其他设备恢复。'}
              </p>
              <div className="cloud-actions">
                <button
                  className="primary"
                  disabled={busy || (!!recovery && !saved)}
                  onClick={() =>
                    void run(async () => {
                      await window.cshell.cloudSync();
                      setRecovery('');
                      setMessage('同步完成');
                    })
                  }
                >
                  立即同步
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setDirection('upload')}
                >
                  用本机更新云端
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setDirection('download')}
                >
                  恢复云端到本机
                </button>
              </div>
              {direction && (
                <div className="cloud-confirm" role="group" aria-label="确认同步方向">
                  <p>
                    {direction === 'upload'
                      ? '云端连接、模型和设置将以本机为准。'
                      : '本机连接、模型和设置将以云端为准。未保存的设置草稿不会同步。'}
                    覆盖前会保留加密备份。
                  </p>
                  <button
                    className="primary"
                    disabled={busy || (!!recovery && !saved)}
                    onClick={() =>
                      void run(async () => {
                        await window.cshell.cloudSync(direction);
                        setDirection(undefined);
                        setRecovery('');
                        setMessage('同步完成');
                      })
                    }
                  >
                    确认{direction === 'upload' ? '上传' : '恢复'}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setDirection(undefined)}
                  >
                    取消
                  </button>
                </div>
              )}
            </>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.cshell.cloudLogout();
                setRecovery('');
                setKey('');
              })
            }
          >
            退出账号
          </button>
        </>
      )}
      <p
        role={error || status?.error ? 'alert' : 'status'}
        className={error || status?.error ? 'form-error' : 'muted'}
      >
        {busy ? '正在处理…' : error || status?.error || message}
      </p>
    </section>
  );
}
