import {ErrorNotice} from './ErrorNotice';
import { useDesktopText } from '../desktop-i18n';
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
  'browser.read': '读取机器浏览器页面与截图',
  'browser.control': '操作机器浏览器（包括已登录网站）',
  'desktop.view': '查看远程桌面与截图',
  'desktop.control': '远程桌面键鼠输入',
  'http.send': '从此机器发送 HTTP 请求',
  'agent.manage': '管理 CAgent 与系统环境',
  'agent.hosting': '管理 CAgent HTTP 服务',
  'agent.relay': '管理 CAgent 中继',
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
  const tr = useDesktopText();
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
    setFeedback(tr("正在保存…"));
    try {
      await window.cshell.aiPolicySave(p);
      await refresh();
      setDraft(null);
      setFeedback(tr("权限已保存"));
    } catch (e) {
      setFailed(true);
      setFeedback(`${tr("保存失败")}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="permission-tree" aria-label={tr("权限节点")}>
      <div className="ai-section-heading">
        <h3>{tr("智能体权限")}</h3>
        <ShieldCheck size={16} />
      </div>
      <p className="ai-section-note">{tr("所有会话共用。审核模式只决定操作是否需要确认。")}</p>
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
        >{tr("全选")}</button>
        <button type="button" disabled={busy} onClick={() => edit(emptyAiPolicy())}>{tr("全取消")}</button>
        <small>{tr("全选包含当前已保存的目标和全部能力，不包含以后新增的机器；保存后生效。")}</small>
      </div>
      <fieldset disabled={busy} className="permission-tree-nodes">
        <section className="permission-global-section">
          <h4>
            <Monitor size={15} />{tr("CShell 本身")}</h4>
          <div className="permission-bulk-actions" role="group" aria-label={tr("应用权限批量选择")}>
            <button type="button" onClick={() => edit({...p, application: [...aiPolicySchema.shape.application.element.options]})}>{tr("全选应用权限")}</button>
            <button type="button" onClick={() => edit({...p, application: []})}>{tr("清空应用权限")}</button>
          </div>
          <div className="permission-application-list">
            {([
              ['connections.read', tr("查询连接目标、分组与会话"), tr("可查询尚未连接的目标；不会读取凭据或连接机器。")],
              ['connections.manage', tr("新建和修改连接配置"), tr("不会自动连接或扩大机器授权。")],
              ['credentials.manage', tr("保存和更换连接凭据"), tr("仅写入加密存储，不读取或返回密码、私钥。")],
              ['identity.trust', tr("接受 SSH 主机身份"), tr("先探测真实指纹，再显式确认；已改变的主机密钥不会自动接受。")],
              ['http.use', tr("使用 HTTP 扩展工具"), tr("还需选择允许的 HTTP 工作区；远端请求使用发送方机器的授权。")],
              ['connections.open', tr("为授权机器新建连接"), tr("使用已保存的凭据连接；后续操作仍受目标机器权限限制。")],
              ['agents.manage', tr("分配与管理子任务"), tr("子任务和定期目标不会扩大机器范围或操作权限。")],
              ['goals.manage', tr("管理定期目标"), ''],
              ['events.manage', tr("管理事件订阅与触发任务"), ''],
              ['web.search', tr("网络搜索（Tavily）"), ''],
              ['ai.providers.manage', tr("查询、添加与测试 AI 基座"), tr("基座地址、模型与密钥来源需确认；密钥不会返回对话。")],
              ['wechat.read', tr("读取本机微信状态、联系人与授权消息"), ''],
              ['wechat.send', tr("向授权联系人发送微信文本"), ''],
              ['wechat.payments.receive', tr("领取本机微信转账或红包"), tr("另需开启对应领取功能。")],
              ['wechat.contacts.manage', tr("修改授权微信联系人的备注"), ''],
            ] as const).map(([id, label, description]) => (
              <label className="permission-application-option" key={id} data-permission-node={`application/${id}`}>
                <input type="checkbox" checked={p.application.includes(id)}
                  onChange={(e) => edit({ ...p, application: toggle(p.application, id, e.target.checked) })} />
                <span><span className="permission-option-title">{tr(label)}</span>{description && <small>{tr(description)}</small>}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="permission-global-section">
          <h4>
            <Server size={15} />{tr("机器操作")}</h4>
          <div className="permission-bulk-actions" role="group" aria-label={tr("默认机器权限批量选择")}>
            <button type="button" onClick={() => edit({...p, capabilities: [...aiCapabilities]})}>{tr("全选默认操作")}</button>
            <button type="button" onClick={() => edit({...p, capabilities: []})}>{tr("清空默认操作")}</button>
          </div>
          <div className="permission-default-tools">
            {aiCapabilities.map((c) => (
              <label key={c} data-permission-node={`capability/${c}`}>
                <input
                  type="checkbox"
                  aria-label={`${tr("默认：")}${tr(names[c])}`}
                  checked={p.capabilities.includes(c)}
                  onChange={(e) =>
                    edit({ ...p, capabilities: toggle(p.capabilities, c, e.target.checked) })
                  }
                />
                {tr(names[c])}
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={p.allMachines}
              onChange={(e) => edit({ ...p, allMachines: e.target.checked })}
            />{tr("允许访问所有已保存的机器")}</label>
          <small>{tr("包含以后新增的机器。关闭后，勾选下面的分组或机器。")}</small>
          {!p.allMachines && (
            <div className="permission-scope-groups">
              {groups.filter(Boolean).map((g) => (
                <label key={g}>
                  <input
                    type="checkbox"
                    checked={p.groups.includes(g)}
                    onChange={(e) => edit({ ...p, groups: toggle(p.groups, g, e.target.checked) })}
                  />
                  {g} {tr("分组")}
                </label>
              ))}
            </div>
          )}
        </section>
        <section className="permission-global-section" data-permission-node="machines/scope">
          <h4>{tr("单台机器")}</h4>
          <div className="permission-bulk-actions" role="group" aria-label={tr("机器范围批量选择")}>
            <button type="button" onClick={() => edit({...p, allMachines: false, groups: [], profiles: profiles.map(m => m.id)})}>{tr("选择当前全部机器")}</button>
            <button type="button" onClick={() => edit({...p, allMachines: false, groups: [], profiles: []})}>{tr("清空机器范围")}</button>
          </div>
          <small>{tr("默认继承上面的操作权限；可直接为某台机器调整。")}</small>
          {!profiles.length && <p className="muted">{tr("尚无已保存的机器")}</p>}
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
                      aria-label={`${tr("允许访问 ")}${m.name}`}
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
                    >{tr("恢复默认")}</button>
                  ) : (
                    <small>{tr("使用默认权限")}</small>
                  )}
                </div>
                <div className="permission-bulk-actions" role="group" aria-label={`${m.name}${tr("权限批量选择")}`}>
                  <button type="button" disabled={!accessible} onClick={() => edit({...p, overrides: [...p.overrides.filter(o => o.profileId !== m.id), {profileId: m.id, capabilities: [...aiCapabilities]}]})}>{tr("全选此机器操作")}</button>
                  <button type="button" disabled={!accessible} onClick={() => edit({...p, overrides: [...p.overrides.filter(o => o.profileId !== m.id), {profileId: m.id, capabilities: []}]})}>{tr("禁止此机器操作")}</button>
                </div>
                <div className="permission-default-tools">
                  {aiCapabilities.map((c) => (
                    <label key={c}>
                      <input
                        type="checkbox"
                        disabled={!accessible}
                        aria-label={`${m.name}：${tr(names[c])}`}
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
                      {tr(names[c])}
                    </label>
                  ))}
                </div>
                {accessible && override && !override.capabilities.length && (
                  <small>{tr("此机器的所有操作已禁止")}</small>
                )}
              </div>
            );
          })}
        </section>
      </fieldset>
      <footer className="permission-tree-footer">
        {failed ? <ErrorNotice title={tr("权限保存未完成")} error={feedback}/> : <span role="status">{feedback || (draft ? tr("有未保存的修改") : tr("未授权的能力不可调用"))}</span>}
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          <Check size={14} />
          {busy ? tr("保存中…") : tr("保存权限")}
        </button>
      </footer>
    </section>
  );
}
