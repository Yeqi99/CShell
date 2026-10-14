import { useEffect, useState } from 'react';
import type { AgentShellOption } from '../../shared/agent';
import type { ClientShell } from '../../shared/client';
import type { Profile } from '../../shared/contracts';
import { ClientConnectForm, type ClientConnected } from './ClientConnectForm';
import { useI18n } from '../i18n';
export function ClientProfileEditor({
  profile,
  onSave,
  onConnect,
  onClient,
}: {
  profile: Profile;
  onSave: (p: Profile) => Promise<void>;
  onConnect: (p: Profile) => void;
  onClient: ClientConnected;
}) {
  const { locale } = useI18n(),
    cn = locale === 'zh-CN';
  const [draft, setDraft] = useState(profile),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const [shells, setShells] = useState<AgentShellOption[]>([]);
  useEffect(() => {
    void window.cshell
      .clientShells(profile.id)
      .then(setShells)
      .catch(() => {});
  }, [profile.id]);
  const update = (patch: Partial<Profile>) => {
    setDraft((p) => ({ ...p, ...patch }));
    setSaved(false);
  };
  const save = async (connect: boolean) => {
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
      setSaved(true);
      if (connect) onConnect(draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="client-page client-profile-editor">
      <h1>{cn ? '编辑连接' : 'Edit connection'}</h1>
      <p>
        CShell Agent · {profile.host}:{profile.port}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <fieldset disabled={busy}>
          <label>
            {cn ? '名称' : 'Name'}
            <input
              required
              maxLength={255}
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <label>
            {cn ? '分组' : 'Group'}
            <input
              maxLength={100}
              value={draft.group}
              onChange={(e) => update({ group: e.target.value })}
            />
          </label>
          <label>
            {cn ? '默认终端' : 'Default terminal'}
            <select
              aria-label={cn ? '默认终端' : 'Default terminal'}
              value={(draft.clientShell ?? 'powershell') + '|' + (draft.clientDistribution ?? '')}
              onChange={(e) => {
                const choice = shells.find(
                  (s) => s.shell + '|' + (s.distribution ?? '') === e.target.value,
                )!;
                update({
                  clientShell: choice.shell as ClientShell,
                  clientDistribution: choice.distribution,
                });
              }}
            >
              {!shells.length && (
                <option
                  value={
                    (draft.clientShell ?? 'powershell') + '|' + (draft.clientDistribution ?? '')
                  }
                >
                  {draft.clientDistribution ?? draft.clientShell ?? 'PowerShell'}（已保存）
                </option>
              )}
              {shells.map((s) => (
                <option
                  key={s.shell + '|' + (s.distribution ?? '')}
                  value={s.shell + '|' + (s.distribution ?? '')}
                >
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="client-favorite">
            <input
              type="checkbox"
              checked={draft.favorite}
              onChange={(e) => update({ favorite: e.target.checked })}
            />
            {cn ? '收藏' : 'Favorite'}
          </label>
          <div className="client-actions">
            <button type="submit">{cn ? '保存' : 'Save'}</button>
            <button
              type="button"
              className="client-primary"
              disabled={!draft.name.trim()}
              onClick={() => void save(true)}
            >
              {cn ? '保存并连接' : 'Save and connect'}
            </button>
          </div>
        </fieldset>
      </form>
      {saved && <p role="status">{cn ? '已保存' : 'Saved'}</p>}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>{cn ? '更新地址或认证' : 'Update address or authentication'}</summary>
        <ClientConnectForm key={profile.id} profile={draft} onConnect={onClient} />
      </details>
    </div>
  );
}
