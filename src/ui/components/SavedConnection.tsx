import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileKey2, LoaderCircle } from 'lucide-react';
import type { Credentials, Profile } from '../../shared/contracts';
import { useI18n } from '../i18n';

export function SavedConnection({
  profile,
  saved,
  onConnect,
  onDone,
  onBusy,
}: {
  profile: Profile;
  saved: boolean;
  onConnect: (profile: Profile, credentials: Credentials, persist: boolean) => Promise<void>;
  onDone: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const cn = locale === 'zh-CN';
  const started = useRef(false),
    running = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [secret, setSecret] = useState(''),
    [remember, setRemember] = useState(saved);
  const [key, setKey] = useState<{ token: string; name: string } | null>(null);
  const start = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await onConnect(
        profile,
        {
          ...(profile.auth === 'password'
            ? { password: secret || undefined }
            : { passphrase: secret || undefined, keyToken: key?.token }),
          remember,
        },
        true,
      );
      onDone();
    } catch (e) {
      setError(
        String((e as Error).message).replace(/^Error invoking remote method '[^']+': Error: /, ''),
      );
      setKey(null);
    } finally {
      running.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (saved) void start();
  }, []);
  return (
    <section className="saved-connection editor-page" aria-busy={busy}>
      <h1>{profile.name}</h1>
      <p className="saved-connection-target">
        {profile.username}@{profile.host}:{profile.port}
      </p>
      {busy ? (
        <div className="saved-connection-progress" role="status">
          <LoaderCircle size={18} className="connection-spinner" />
          {t('connecting')}
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
          <label className="connection-check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {t('remember')}
          </label>
          {error && (
            <p className="form-error" role="alert">
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
}
