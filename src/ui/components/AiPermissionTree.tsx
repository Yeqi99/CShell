import { usePermissionFocus } from '../permission-navigation';
import { useState } from 'react';
import { Check, ShieldCheck, Server, Monitor } from 'lucide-react';
import {
  aiCapabilities,
  aiPolicySchema,
  emptyAiPolicy,
  type AiPolicy,
  type AiSnapshot,
} from '../../shared/ai';
import type { Profile } from '../../shared/contracts';
const names = {
  'http.send': '从此机器发送 HTTP 请求',
  'agent.manage': '管理 Agent 与系统环境',
  'agent.hosting': '管理 Agent HTTP 服务',
  'agent.relay': '管理 Agent 中继',
  'metrics.read': '资源监控',
  'files.read': '读取文件',
  'files.create': '创建文件（不覆盖）',
  'commands.execute': '执行命令 / 修改文件',
};
export function AiPermissionTree({
  visible,
  snapshot,
  profiles,
  groups,
  refresh,
}: {
  visible: boolean;
  snapshot: AiSnapshot;
  profiles: Profile[];
  groups: string[];
  refresh: () => Promise<void>;
}) {
  usePermissionFocus('ai',visible);
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
      <div className="permission-bulk-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            edit({
              ...emptyAiPolicy(),
              application: [...aiPolicySchema.shape.application.element.options],
              capabilities: [...aiCapabilities],
              profiles: profiles.map((profile) => profile.id),
            })
          }
        >
          全选
        </button>
        <button type="button" disabled={busy} onClick={() => edit(emptyAiPolicy())}>
          全取消
        </button>
        <small>全选包含当前已保存的目标和全部能力，不包含以后新增的机器；保存后生效。</small>
      </div>
      <fieldset disabled={busy} className="permission-tree-nodes">
        <section className="permission-global-section">
          <h4>
            <Monitor size={15} /> CShell 本身
          </h4>
          <label data-permission-node="application/connections.read">
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
          <label data-permission-node="application/http.use">
            <input
              type="checkbox"
              checked={p.application.includes('http.use')}
              onChange={(e) =>
                edit({ ...p, application: toggle(p.application, 'http.use', e.target.checked) })
              }
            />
            使用 HTTP 扩展工具
          </label>
          <small>需同时勾选允许的 HTTP 工作区；远端发送还需授权发送方机器的 HTTP 能力。</small>
          <label data-permission-node="application/connections.open">
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
          {(
            [
              ['agents.manage', '分配与管理子任务'],
              ['goals.manage', '管理定期目标'],
              ['events.manage', '管理事件订阅与触发任务'],
              ['ai.providers.manage', '查询、添加与测试 AI 基座'],
              ['wechat.read', '读取本机微信状态、联系人与授权消息'],
              ['wechat.send', '向授权联系人发送微信文本'],
              ['wechat.contacts.manage', '修改授权微信联系人的备注'],
            ] as const
          ).map(([id, label]) => (
            <label key={id} data-permission-node={`application/${id}`}>
              <input
                type="checkbox"
                checked={p.application.includes(id)}
                onChange={(e) =>
                  edit({ ...p, application: toggle(p.application, id, e.target.checked) })
                }
              />
              {label}
            </label>
          ))}
          <small>默认关闭。子任务和定期目标不会增加机器或操作权限。</small>
          <small>基座保存需确认地址、模型与密钥来源；密钥由后端保管，不返回对话。</small>
        </section>
        <section className="permission-global-section">
          <h4>
            <Server size={15} /> 机器操作
          </h4>
          <div className="permission-default-tools">
            {aiCapabilities.map((c) => (
              <label key={c} data-permission-node={`capability/${c}`}>
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
        <section className="permission-global-section" data-permission-node="machines/scope">
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
