import { useEffect, useState } from 'react';
import type { McpSettings as Settings, McpStatus, Profile } from '../../shared/contracts';
import { useI18n } from '../i18n';
export function useMcpSettings() {
  const [status, setStatus] = useState<McpStatus | null>(null),
    [draft, setDraft] = useState<Settings | null>(null),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    void Promise.all([window.cshell.mcpStatus(), window.cshell.config()])
      .then(([status, config]) => {
        setStatus(status);
        setDraft(status.settings);
        setProfiles(config.profiles);
      })
      .catch((e) => setError(e.message));
  }, []);
  const save = async (retry = false) => {
    // Appearance imports never supply MCP grants. Only this explicit draft is saved.
    if (!draft || !status) return;
    if (JSON.stringify(draft) === JSON.stringify(status.settings) && !(retry && status.error))
      return;
    const next = await window.cshell.mcpConfigure(draft);
    setStatus(next);
    setDraft(next.settings);
    if (next.error) throw new Error(next.error);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return {
    status,
    setStatus,
    draft,
    setDraft,
    profiles,
    error,
    busy,
    copied,
    setCopied,
    run,
    save,
  };
}
export function McpSettings({
  state,
  saving,
}: {
  state: ReturnType<typeof useMcpSettings>;
  saving: boolean;
}) {
  const { t, locale } = useI18n();
  const { status, setStatus, draft, setDraft, profiles, error, busy, copied, setCopied, run } =
    state;
  return (
    <section className="mcp-settings">
      <h2>{t('mcpService')}</h2>
      <p className="muted">{t('mcpHint')}</p>
      {draft && (
        <fieldset disabled={busy || saving}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            {t('mcpEnable')}
          </label>
          <label>
            {t('mcpPort')}
            <input
              type="number"
              min={1024}
              max={65535}
              value={draft.port}
              onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })}
            />
          </label>
          <p>
            <code>http://127.0.0.1:{draft.port}/mcp</code>
          </p>
          <p className="muted">{t('mcpScope')}</p>
          <div className="mcp-profiles">
            {profiles
              .filter((p) => !p.protocol || p.protocol === 'ssh')
              .map((profile) => (
                <label className="checkbox" key={profile.id}>
                  <input
                    type="checkbox"
                    checked={draft.allowedProfiles.includes(profile.id)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        allowedProfiles: e.target.checked
                          ? [...draft.allowedProfiles, profile.id]
                          : draft.allowedProfiles.filter((id) => id !== profile.id),
                      })
                    }
                  />
                  {profile.name} · {profile.host}
                </label>
              ))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.allowCommands}
              onChange={(e) => setDraft({ ...draft, allowCommands: e.target.checked })}
            />
            {t('mcpCommands')}
          </label>
          <div className="preset-row">
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await window.cshell.mcpCopyToken();
                  setCopied(true);
                })
              }
            >
              {copied ? t('copied') : t('copyToken')}
            </button>
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await window.cshell.mcpRotateToken();
                  setStatus(await window.cshell.mcpStatus());
                  setCopied(false);
                })
              }
            >
              {t('rotateToken')}
            </button>
          </div>
          <p className="muted">
            {locale === 'zh-CN'
              ? '修改后点击底部“保存”生效。'
              : 'Click Save below to apply changes.'}
          </p>
        </fieldset>
      )}
      {status && <p role="status">{status.running ? t('mcpRunning') : t('mcpStopped')}</p>}
      {(error || status?.error) && (
        <p className="form-error" role="alert">
          {error || status?.error}
        </p>
      )}
    </section>
  );
}
