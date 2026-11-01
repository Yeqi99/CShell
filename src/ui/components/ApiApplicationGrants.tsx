import { CapabilitySelection } from './CapabilitySelection';
import { useI18n } from '../i18n';
export function ApiApplicationGrants({
  value = [],
  change,
}: {
  value?: ('plugins.read' | 'plugins.manage' | 'connections.read' | 'http.use')[];
  change: (value: ('plugins.read' | 'plugins.manage' | 'connections.read' | 'http.use')[]) => void;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  return (
    <details>
      <summary>{cn ? 'CShell 应用权限' : 'CShell application grants'}</summary>
      <CapabilitySelection options={['plugins.read','plugins.manage','connections.read','http.use'] as const} value={value} change={change} />
      {(['plugins.read', 'plugins.manage', 'connections.read', 'http.use'] as const).map((id) => (
        <label className="checkbox" key={id}>
          <input
            type="checkbox"
            checked={value.includes(id)}
            onChange={(e) =>
              change(e.target.checked ? [...value, id] : value.filter((v) => v !== id))
            }
          />
          {{'plugins.read':cn?'查看插件':'Read plugins','plugins.manage':cn?'管理插件（影响整个应用）':'Manage plugins (application-wide)','connections.read':cn?'查看机器代理规则':'Read machine proxy rules','http.use':cn?'设置机器网络出口':'Configure machine network routes'}[id]}
        </label>
      ))}
    </details>
  );
}
