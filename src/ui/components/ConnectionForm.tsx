import { useId, useRef, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileKey2,
  LoaderCircle,
  KeyRound,
  LockKeyhole,
} from 'lucide-react';
import type { Profile, Credentials } from '../../shared/contracts';
import { useI18n } from '../i18n';
import { ConnectionExtractor } from './ConnectionExtractor';
import { useConnectionAttempt } from '../use-connection-attempt';
import { connectionErrorMessage, isConnectionCancelled } from '../../shared/connection-errors';

type Field = 'name' | 'host' | 'port' | 'username';

export function ConnectionForm({
  profile,
  protocol = 'ssh',
  initialPassword = '',
  groups,
  initialPersist = !!profile,
  saved,
  onClose,
  onSave,
  onConnect,
}: {
  profile?: Profile;
  protocol?: 'ssh' | 'sftp' | 'ftp' | 'ftps';
  initialPassword?: string;
  groups: string[];
  initialPersist?: boolean;
  saved: boolean;
  onClose: () => void;
  onSave: (p: Profile) => Promise<void>;
  onConnect: (p: Profile, c: Credentials, persist: boolean, signal?: AbortSignal) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const attempt = useConnectionAttempt();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState<Profile>(
    profile ?? {
      id: crypto.randomUUID(),
      name: '',
      protocol,
      host: '',
      port: protocol === 'ftp' || protocol === 'ftps' ? 21 : 22,
      username: protocol === 'ssh' ? 'root' : '',
      group: '',
      auth: 'password',
      favorite: false,
    },
  );
  const [persist, setPersist] = useState(initialPersist);
  const [port, setPort] = useState(String(value.port));
  const [password, setPassword] = useState(initialPassword);
  const [passphrase, setPassphrase] = useState('');
  const [key, setKey] = useState<{ token: string; name: string } | null>(null);
  const [remember, setRemember] = useState(saved);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<'save' | 'connect' | null>(null);
  const [error, setError] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<'done' | null>(null);
  const [invalid, setInvalid] = useState<Partial<Record<Field, boolean>>>({});
  const canReuse = persist && saved && profile?.auth === value.auth;
  const ftp = value.protocol === 'ftp' || value.protocol === 'ftps';
  const ssh = !value.protocol || value.protocol === 'ssh';
  const update = (field: keyof Profile, next: string | number | boolean) => {
    setExtraction(null);
    setValue((v) => ({ ...v, [field]: next }));
    setInvalid((v) => ({ ...v, [field]: false }));
  };
  const fieldProps = (field: Field) => ({
    id: id + '-' + field,
    name: field,
    'aria-invalid': !!invalid[field],
    'aria-describedby': invalid[field] ? id + '-' + field + '-error' : undefined,
  });
  const fieldError = (field: Field) =>
    invalid[field] && (
      <span className="connection-field-error" id={id + '-' + field + '-error'}>
        {t(
          field === 'port'
            ? 'invalidPort'
            : field === 'host' && value.host.trim()
              ? 'invalidHost'
              : 'requiredField',
        )}
      </span>
    );
  async function submit(connect: boolean) {
    if (busy || extracting) return;
    const host = value.host.trim();
    const username = value.username.trim();
    const connectionPort = port;
    const nextInvalid = {
      name: false,
      host: !host || /\s/.test(host),
      username: !username,
      port:
        !/^\d+$/.test(connectionPort) ||
        Number(connectionPort) < 1 ||
        Number(connectionPort) > 65535,
    };
    setInvalid(nextInvalid);
    setError('');
    setCancelled(false);
    const first = (['name', 'host', 'port', 'username'] as const).find((f) => nextInvalid[f]);
    if (first) {
      form.current?.querySelector<HTMLInputElement>('[name="' + first + '"]')?.focus();
      return;
    }
    if (connect && value.auth === 'key' && !key && !canReuse) {
      setError(t('keyRequired'));
      form.current?.querySelector<HTMLButtonElement>('.connection-key-picker')?.focus();
      return;
    }
    setBusy(connect ? 'connect' : 'save');
    let connectionStarted = false;
    try {
      const next = {
        ...value,
        name: value.name.trim() || host,
        host,
        username,
        group: value.group.trim(),
        port: Number(connectionPort),
      };
      await attempt.run(async (signal) => {
        if (!connect || persist) await onSave(next);
        signal.throwIfAborted();
        if (connect) {
          connectionStarted = true;
          await onConnect(
            next,
            {
              password: value.auth === 'password' ? password || undefined : undefined,
              passphrase: value.auth === 'key' ? passphrase || undefined : undefined,
              keyToken: value.auth === 'key' ? key?.token : undefined,
              remember: persist && remember,
            },
            persist,
            signal,
          );
        }
      });
      onClose();
    } catch (e) {
      setCancelled(isConnectionCancelled(e));
      setError(connectionErrorMessage(e, locale));
      // The backend consumes a selected key token when a connection is attempted.
      if (connectionStarted) setKey(null);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      className="editor-page connection-editor compact-connection"
      aria-labelledby={id + '-title'}
    >
      {ssh ? <ConnectionExtractor
        title={profile ? t('editConnection') : t('sshConnection')}
        titleId={id + '-title'}
        disabled={!!busy}
        onStart={() => setExtraction(null)}
        onBusy={setExtracting}
        onExtract={({ fields }) => {
          const { port: extractedPort, password: extractedPassword, ...profileFields } = fields;
          setValue((current) => ({
            ...current,
            ...profileFields,
            ...(extractedPassword !== undefined ? { auth: 'password' as const } : {}),
          }));
          if (extractedPort !== undefined) setPort(String(extractedPort));
          if (extractedPassword !== undefined) setPassword(extractedPassword);
          setInvalid({});
          setError('');
          setExtraction('done');
        }}
      /> : <header className="connection-protocol-heading"><h2 id={id + '-title'}>{value.protocol?.toUpperCase()} · {locale === 'zh-CN' ? '文件连接' : 'File connection'}</h2>
        <p className="muted">{value.protocol === 'sftp' ? (locale === 'zh-CN' ? '通过 SSH 加密传输文件，无需远端 Shell。' : 'Encrypted file access over SSH; no remote shell required.') : value.protocol === 'ftps' ? (locale === 'zh-CN' ? '显式 TLS 加密连接，校验证书与服务器名称。' : 'Explicit TLS with certificate and hostname verification.') : (locale === 'zh-CN' ? 'FTP 不加密账号和文件内容，请仅在可信网络使用。需要加密时选择 FTPS 或 SFTP。' : 'FTP sends credentials and files without encryption. Use FTPS or SFTP when encryption is needed.')}</p>
      </header>}
      {extraction && (
        <p className="connection-extraction" role="status">
          {t('commandExtracted')}
        </p>
      )}
      <form
        ref={form}
        noValidate
        aria-busy={!!busy || extracting}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
      >
        <fieldset className="connection-fields" disabled={!!busy || extracting}>
          <legend className="sr-only">{t('connectionConfig')}</legend>
          <div className="connection-row connection-address-row">
            <div className="connection-field">
              <label htmlFor={id + '-host'}>{t('host')}</label>
              <input
                {...fieldProps('host')}
                required
                maxLength={255}
                value={value.host}
                spellCheck={false}
                autoFocus
                placeholder={t('hostQuickHint')}
                onChange={(e) => update('host', e.target.value)}
              />
              {fieldError('host')}
            </div>
            <div className="connection-field">
              <label htmlFor={id + '-port'}>{t('port')}</label>
              <input
                {...fieldProps('port')}
                type="number"
                required
                min={1}
                max={65535}
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  setInvalid((v) => ({ ...v, port: false }));
                }}
              />
              {fieldError('port')}
            </div>
          </div>
          {!ftp && <fieldset className="connection-auth">
            <legend>{t('auth')}</legend>
            <div className="connection-auth-options">
              {(['password', 'key'] as const).map((auth) => (
                <label key={auth}>
                  <input
                    type="radio"
                    name={id + '-auth'}
                    value={auth}
                    checked={value.auth === auth}
                    onChange={() => {
                      update('auth', auth);
                      setShowPassword(false);
                      setError('');
                    }}
                  />
                  <span>
                    {auth === 'password' ? (
                      <LockKeyhole size={14} aria-hidden="true" />
                    ) : (
                      <KeyRound size={14} aria-hidden="true" />
                    )}
                    {t(auth)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>}
          <div className="connection-row">
            <div className="connection-field">
              <label htmlFor={id + '-username'}>{t('username')}</label>
              <input
                {...fieldProps('username')}
                required
                maxLength={255}
                autoComplete="off"
                spellCheck={false}
                value={value.username}
                onChange={(e) => update('username', e.target.value)}
              />
              {fieldError('username')}
            </div>
            <div className="connection-field">
              <label htmlFor={id + '-secret'}>
                {t(value.auth === 'password' ? 'password' : 'passphrase')}
              </label>
              <div className="connection-secret">
                <input
                  id={id + '-secret'}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="off"
                  aria-describedby={canReuse ? id + '-saved' : undefined}
                  placeholder={
                    canReuse
                      ? t('reuseSecret')
                      : value.auth === 'key'
                        ? t('optionalField')
                        : t('passwordHint')
                  }
                  value={value.auth === 'password' ? password : passphrase}
                  onChange={(e) =>
                    value.auth === 'password'
                      ? setPassword(e.target.value)
                      : setPassphrase(e.target.value)
                  }
                />
                <button
                  type="button"
                  aria-label={t(showPassword ? 'hideSecret' : 'showSecret')}
                  title={t(showPassword ? 'hideSecret' : 'showSecret')}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>
          {value.auth === 'key' && (
            <button
              type="button"
              className="connection-key-picker"
              onClick={() => {
                void window.cshell
                  .pickKey()
                  .then((selected) => {
                    if (selected) {
                      setKey(selected);
                      setError('');
                    }
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              <FileKey2 size={17} aria-hidden="true" />
              <span>{key?.name || (canReuse ? t('savedKey') : t('chooseKey'))}</span>
              <span className="connection-browse">{t('browse')}</span>
            </button>
          )}
          {canReuse && (
            <p id={id + '-saved'} className="connection-saved">
              {t('savedSecret')}
            </p>
          )}
          <div className="connection-save-options">
            <label className="connection-check">
              <input
                type="checkbox"
                checked={persist}
                onChange={(e) => setPersist(e.target.checked)}
              />
              {t('saveConnection')}
            </label>
            {persist && (
              <>
                <div className="connection-row">
                  <div className="connection-field">
                    <label htmlFor={id + '-name'}>
                      {t('name')}
                      <span aria-hidden="true">{t('optionalField')}</span>
                    </label>
                    <input
                      {...fieldProps('name')}
                      aria-label={t('name')}
                      maxLength={255}
                      value={value.name}
                      onChange={(e) => update('name', e.target.value)}
                      placeholder={value.host || t('autoConnectionName')}
                    />
                  </div>
                  <div className="connection-field">
                    <label htmlFor={id + '-group'}>
                      {t('group')}
                      <span aria-hidden="true">{t('optionalField')}</span>
                    </label>
                    <input
                      id={id + '-group'}
                      aria-label={t('group')}
                      list={id + '-groups'}
                      maxLength={100}
                      value={value.group}
                      onChange={(e) => update('group', e.target.value)}
                      placeholder={t('ungrouped')}
                    />
                    <datalist id={id + '-groups'}>
                      {groups.map((group) => (
                        <option key={group} value={group} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <label className="connection-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  {t('remember')}
                </label>
              </>
            )}
          </div>
        </fieldset>
        {error && (
          <p
            className={cancelled ? 'connection-notice' : 'form-error connection-error'}
            role={cancelled ? 'status' : 'alert'}
          >
            {error}
          </p>
        )}
        <footer className="connection-footer">
          <div className="connection-actions">
            {busy === 'connect' && (
              <button type="button" className="secondary" onClick={attempt.cancel}>
                {t('cancelConnection')}
              </button>
            )}
            <button type="submit" className="primary" disabled={!!busy}>
              {busy === 'connect' ? (
                <LoaderCircle size={15} className="connection-spinner" aria-hidden="true" />
              ) : (
                <ArrowRight size={15} aria-hidden="true" />
              )}
              {t(persist ? 'saveAndConnect' : 'connect')}
            </button>
            {persist && (
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() => void submit(false)}
              >
                {busy === 'save' ? t('saving') : t('saveOnly')}
              </button>
            )}
          </div>
          <span className="connection-action-hint" role="status">
            {busy
              ? t(busy === 'save' ? 'saving' : 'connecting')
              : t(persist ? 'saveBeforeConnectHint' : 'temporaryConnectionHint')}
          </span>
        </footer>
      </form>
    </section>
  );
}
