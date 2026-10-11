import { useState } from 'react';
import type { ToolsSettings } from '../../shared/docker';
import { useI18n } from '../i18n';
export function ToolSettings({
  value,
  onSave,
}: {
  value: ToolsSettings;
  onSave: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  return (
    <section className="tool-settings">
      <h2>{zh ? '插件设置' : 'Plugin settings'}</h2>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('cshell:open-extensions'))}
      >
        {zh ? '管理插件' : 'Manage plugins'}
      </button>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setSaved(false);
          try {
            await window.cshell.configureTools({ ...value, dockerSocket: draft.dockerSocket });
            await onSave();
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          {value.dockerEnabled && (
            <label>
              {zh ? '远端 Docker Socket' : 'Remote Docker socket'}
              <input
                value={draft.dockerSocket}
                onChange={(e) => {
                  setDraft({ ...draft, dockerSocket: e.target.value });
                  setSaved(false);
                }}
                placeholder="/var/run/docker.sock"
              />
              <small>
                {zh
                  ? '通过当前 SSH 连接访问；rootless Docker 可填写 /run/user/UID/docker.sock。'
                  : 'Uses the current SSH connection. Rootless Docker: /run/user/UID/docker.sock.'}
              </small>
            </label>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <footer>
            {saved && <span role="status">{zh ? '已保存' : 'Saved'}</span>}
            <button className="primary">{zh ? '保存工具设置' : 'Save tool settings'}</button>
          </footer>
        </fieldset>
      </form>
    </section>
  );
}
