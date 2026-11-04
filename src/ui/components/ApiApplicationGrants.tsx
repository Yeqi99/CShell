import { CapabilitySelection } from './CapabilitySelection';
import { useI18n } from '../i18n';
export function ApiApplicationGrants({
  value = [],
  change,
}: {
  value?: ('plugins.read' | 'plugins.manage' | 'connections.read' | 'connections.manage' | 'credentials.manage' | 'identity.trust' | 'http.use' | 'domains.read' | 'domains.manage' | 'updates.manage' | 'account.read')[];
  change: (value: ('plugins.read' | 'plugins.manage' | 'connections.read' | 'connections.manage' | 'credentials.manage' | 'identity.trust' | 'http.use' | 'domains.read' | 'domains.manage' | 'updates.manage' | 'account.read')[]) => void;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  return (
    <details>
      <summary>{cn ? 'CShell 应用权限' : 'CShell application grants'}</summary>
      <CapabilitySelection options={['plugins.read','plugins.manage','connections.read','connections.manage','credentials.manage','identity.trust','http.use','domains.read','domains.manage','updates.manage', 'account.read'] as const} value={value} change={change} />
      {(['plugins.read', 'plugins.manage', 'connections.read', 'connections.manage', 'credentials.manage', 'identity.trust', 'http.use', 'domains.read', 'domains.manage', 'updates.manage', 'account.read'] as const).map((id) => (
        <label className="checkbox" key={id}>
          <input
            type="checkbox"
            checked={value.includes(id)}
            onChange={(e) =>
              change(e.target.checked ? [...value, id] : value.filter((v) => v !== id))
            }
          />
          {{'updates.manage':cn?'更新 CShell（安装会重启）':'Update CShell (installation restarts)', 'account.read':cn?'查看本账号流量与额度':'Read own account traffic allowance','domains.read':cn?'查看会员域名与 DNS':'Read member domains and DNS','domains.manage':cn?'管理会员域名与 DNS':'Manage member domains and DNS','plugins.read':cn?'查看插件':'Read plugins','plugins.manage':cn?'管理插件（影响整个应用）':'Manage plugins (application-wide)','connections.read':cn?'查看连接与机器代理规则':'Read connections and machine proxy rules','connections.manage':cn?'新建和修改连接':'Create and edit connections','credentials.manage':cn?'保存和更换连接凭据（不可读取）':'Save and replace credentials (write only)','identity.trust':cn?'显式接受 SSH 主机身份':'Explicitly accept SSH host identity','http.use':cn?'设置机器网络出口':'Configure machine network routes'}[id]}
        </label>
      ))}
    </details>
  );
}
