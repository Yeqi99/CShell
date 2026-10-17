import { useI18n } from '../i18n';
export function ApiApplicationGrants({
  value = [],
  change,
}: {
  value?: ('plugins.read' | 'plugins.manage')[];
  change: (value: ('plugins.read' | 'plugins.manage')[]) => void;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  return (
    <details>
      <summary>{cn ? 'CShell 应用权限' : 'CShell application grants'}</summary>
      {(['plugins.read', 'plugins.manage'] as const).map((id) => (
        <label className="checkbox" key={id}>
          <input
            type="checkbox"
            checked={value.includes(id)}
            onChange={(e) =>
              change(e.target.checked ? [...value, id] : value.filter((v) => v !== id))
            }
          />
          {id === 'plugins.read'
            ? cn
              ? '查看插件'
              : 'Read plugins'
            : cn
              ? '管理插件（影响整个应用）'
              : 'Manage plugins (application-wide)'}
        </label>
      ))}
    </details>
  );
}
