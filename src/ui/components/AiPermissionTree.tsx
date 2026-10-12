import { useState } from 'react';
import { Check, ShieldCheck, Server, Monitor } from 'lucide-react';
import { aiCapabilities, type AiPolicy, type AiSnapshot } from '../../shared/ai';
import type { Profile } from '../../shared/contracts';
const names = {
  'metrics.read': '资源监控',
  'files.read': '读取文件',
  'commands.execute': '执行命令 / 修改文件',
};
export function AiPermissionTree({
  snapshot,
  profiles,
  groups,
  refresh,
}: {
  snapshot: AiSnapshot;
  profiles: Profile[];
  groups: string[];
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<AiPolicy | null>(null);
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState(''),
    [failed, setFailed] = useState(false);
  const p = draft ?? snapshot.policy;
  const edit = (next: AiPolicy) => {
    setDraft(next);
    setFeedback('');
    setFailed(false);
  };
  const toggle = <T extends string>(values: T[], id: T, on: boolean) =>
    on ? [...new Set([...values, id])] : values.filter((v) => v !== id);
  const save = async () => {
    setBusy(true);
    setFailed(false);
    setFeedback('正在保存…');
    try {
      await window.cshell.aiPolicySave(p);
      await refresh();
      setDraft(null);
      setFeedback('权限已保存，所有会话立即生效');
    } catch (e) {
      setFailed(true);
      setFeedback(`保存失败：${(e as Error).message}。修改已保留。`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="permission-tree" aria-label="权限节点">
      <div className="ai-section-heading">
        <h3>智能体权限</h3>
        <ShieldCheck size={16} />
      </div>
      <p className="ai-section-note">所有会话共用。审核模式只决定操作是否需要确认。</p>
      <fieldset disabled={busy} className="permission-tree-nodes">
        <section className="permission-global-section">
          <h4>
            <Monitor size={15} /> CShell 本身
          </h4>
          <label>
            <input
              type="checkbox"
              checked={p.application.includes('connections.read')}
              onChange={(e) =>
                edit({
                  ...p,
                  application: toggle(p.application, 'connections.read', e.target.checked),
                })
              }
            />
            查询连接目标、分组与会话
          </label>
          <small>可查询尚未连接的目标；不会读取凭据或连接机器。</small>
          <label>
            <input
              type="checkbox"
              checked={p.application.includes('connections.open')}
              onChange={(e) =>
                edit({
                  ...p,
                  application: toggle(p.application, 'connections.open', e.target.checked),
                })
              }
            />
            为授权机器新建连接
          </label>
          <small>使用已保存的凭据打开终端，后续操作仍受机器权限限制。</small>
        </section>
        <section className="permission-global-section">
          <h4>
            <Server size={15} /> 机器操作
          </h4>
          <div className="permission-default-tools">
            {aiCapabilities.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  aria-label={`默认：${names[c]}`}
                  checked={p.capabilities.includes(c)}
                  onChange={(e) =>
                    edit({ ...p, capabilities: toggle(p.capabilities, c, e.target.checked) })
                  }
                />
                {names[c]}
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={p.allMachines}
              onChange={(e) => edit({ ...p, allMachines: e.target.checked })}
            />
            允许访问所有已保存的机器
          </label>
          <small>包含以后新增的机器。关闭后，勾选下面的分组或机器。</small>
          {!p.allMachines && (
            <div className="permission-scope-groups">
              {groups.filter(Boolean).map((g) => (
                <label key={g}>
                  <input
                    type="checkbox"
                    checked={p.groups.includes(g)}
                    onChange={(e) => edit({ ...p, groups: toggle(p.groups, g, e.target.checked) })}
                  />
                  {g} 分组
                </label>
              ))}
            </div>
          )}
        </section>
        <section className="permission-global-section">
          <h4>单台机器</h4>
          <small>默认继承上面的操作权限；可直接为某台机器调整。</small>
          {!profiles.length && <p className="muted">尚无已保存的机器</p>}
          {profiles.map((m) => {
            const inheritedScope = p.allMachines || p.groups.includes(m.group);
            const accessible = inheritedScope || p.profiles.includes(m.id);
            const override = p.overrides.find((o) => o.profileId === m.id);
            return (
              <div className="permission-machine-card" key={m.id}>
                <div className="permission-machine-heading">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`允许访问 ${m.name}`}
                      disabled={inheritedScope}
                      checked={accessible}
                      onChange={(e) =>
                        edit({ ...p, profiles: toggle(p.profiles, m.id, e.target.checked) })
                      }
                    />
                    <Server size={14} />
                    <span>
                      {m.name}
                      <small>{m.host}</small>
                    </span>
                  </label>
                  {override ? (
                    <button
                      type="button"
                      className="permission-reset"
                      onClick={() =>
                        edit({ ...p, overrides: p.overrides.filter((o) => o.profileId !== m.id) })
                      }
                    >
                      恢复默认
                    </button>
                  ) : (
                    <small>使用默认权限</small>
                  )}
                </div>
                <div className="permission-default-tools">
                  {aiCapabilities.map((c) => (
                    <label key={c}>
                      <input
                        type="checkbox"
                        disabled={!accessible}
                        aria-label={`${m.name}：${names[c]}`}
                        checked={(override?.capabilities ?? p.capabilities).includes(c)}
                        onChange={(e) =>
                          edit({
                            ...p,
                            overrides: [
                              ...p.overrides.filter((o) => o.profileId !== m.id),
                              {
                                profileId: m.id,
                                capabilities: toggle(
                                  override?.capabilities ?? p.capabilities,
                                  c,
                                  e.target.checked,
                                ),
                              },
                            ],
                          })
                        }
                      />
                      {names[c]}
                    </label>
                  ))}
                </div>
                {accessible && override && !override.capabilities.length && (
                  <small>此机器的所有操作已禁止</small>
                )}
              </div>
            );
          })}
        </section>
      </fieldset>
      <footer className="permission-tree-footer">
        <span role={failed ? 'alert' : 'status'} className={failed ? 'form-error' : ''}>
          {feedback || (draft ? '有未保存的修改' : '未授权的能力不可调用')}
        </span>
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          <Check size={14} />
          {busy ? '保存中…' : '保存权限'}
        </button>
      </footer>
    </section>
  );
}
