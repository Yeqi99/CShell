import {LinuxDesktop} from './LinuxDesktop';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileKey2, LoaderCircle } from 'lucide-react';
import type { Credentials, Profile } from '../../shared/contracts';
import { useI18n } from '../i18n';
import { useConnectionAttempt } from '../use-connection-attempt';
import { connectionErrorMessage, isConnectionCancelled } from '../../shared/connection-errors';

export function SavedConnection({
  profile,
  saved,
  persist = true,
  visual = true,
  onConnect,
  onDone,
}: {
  profile: Profile;
  saved: boolean;
  persist?: boolean;
  visual?: boolean;
  onConnect: (
    profile: Profile,
    credentials: Credentials,
    persist: boolean,
    signal?: AbortSignal,
  ) => Promise<void>;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const attempt = useConnectionAttempt();
  const cn = locale === 'zh-CN';
  const started = useRef(false),
    running = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const [secret, setSecret] = useState(''),
    [remember, setRemember] = useState(saved);
  const [key, setKey] = useState<{ token: string; name: string } | null>(null);
  const start = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setCancelled(false);
    try {
      await attempt.run((signal) =>
        onConnect(
          profile,
          {
            ...(profile.auth === 'password'
              ? { password: secret || undefined }
              : { passphrase: secret || undefined, keyToken: key?.token }),
            remember: persist && remember,
          },
          persist,
          signal,
        ),
      );
      onDone();
    } catch (e) {
      setCancelled(isConnectionCancelled(e));
      setError(connectionErrorMessage(e, locale));
      setKey(null);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (saved) void start();
  }, []);
  const authentication = (
    <section className="saved-connection editor-page" aria-busy={busy}>
      <h1>{profile.name}</h1>
      <p className="saved-connection-target">
        {profile.username}@{profile.host}:{profile.port}
      </p>
      {busy ? (
        <div className="saved-connection-progress" role="status">
          <LoaderCircle size={18} className="connection-spinner" />
          {t('connecting')}
          <button className="secondary" onClick={attempt.cancel}>
            {t('cancelConnection')}
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <p className="muted">{cn ? '确认身份后连接此服务器' : 'Authenticate to connect'}</p>
          {profile.auth === 'key' && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void window.cshell
                  .pickKey()
                  .then((value) => {
                    if (value) setKey(value);
                  })
                  .catch((e) => setError(String(e)))
              }
            >
              <FileKey2 size={14} />
              {key?.name || (saved ? t('savedKey') : t('chooseKey'))}
            </button>
          )}
          <label>
            {profile.auth === 'password' ? t('password') : t('passphrase')}
            <input
              autoFocus
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          {persist && (
            <label className="connection-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              {t('remember')}
            </label>
          )}
          {error && (
            <p
              className={cancelled ? 'connection-notice' : 'form-error'}
              role={cancelled ? 'status' : 'alert'}
            >
              {error}
            </p>
          )}
          <button className="primary" disabled={profile.auth === 'key' && !key && !saved}>
            <ArrowRight size={14} />
            {t('connect')}
          </button>
        </form>
      )}
    </section>
  );
  if (!visual) return authentication;
  return <div className="linux-desktop-host"><LinuxDesktop name={profile.name} machine={{deviceId:profile.id,platform:'unknown',sshOnly:true}} target={'pending:'+profile.id} call={async()=>{throw Error('连接尚未建立');}} active={true} closed={true} initialApp="terminal" connectionLabel={busy?'正在连接…':error?'无法连接 · 点击重试':'等待连接'} onRetry={()=>{if(!busy)void start();}} files={authentication} terminal={()=>authentication}/></div>;

}
