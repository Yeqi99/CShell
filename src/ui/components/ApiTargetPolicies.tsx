import { CapabilitySelection } from './CapabilitySelection';
import { apiCapabilitySchema, type McpSettings } from '../../shared/contracts';
import type { Profile } from '../../shared/contracts';
import { useI18n } from '../i18n';

export function ApiTargetPolicies({
  settings,
  profiles,
  change,
}: {
  settings: Pick<
    McpSettings,
    'targetPolicies' | 'allowedProfiles' | 'allowCommands' | 'capabilities' | 'review'
  >;
  profiles: Profile[];
  change: (targetPolicies: McpSettings['targetPolicies']) => void;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  const labels: Record<string, string> = {
    'browser.read': '读取浏览器页面与截图',
    'browser.control': '操作浏览器（包括已登录网站）',
    'desktop.view': '查看远程桌面',
    'desktop.control': '远程桌面键鼠输入',
    'environments.read': '读取环境',
    'environments.manage': '修改环境',
    'applications.read': '应用安装计划',
    'applications.install': '安装应用',
    'files.write': '修改文件内容',
    'docker.read': '读取 Docker',
    'docker.manage': '管理 Docker',
    'files.read': '读取文件',
    'files.create': '创建文件',
    'directories.create': '创建目录',
    'directories.manage': '移动或删除目录树',
    'files.rename': '重命名文件',
    'files.delete': '永久删除文件',
    'terminal.read': '读取终端',
    'terminal.input': '终端输入',
    'metrics.read': '读取监控',
    'agent.manage': 'Agent 管理',
    'agent.hosting': 'HTTP 托管',
    'agent.relay': '中继',
    'http.use': 'HTTP 工作区',
    'http.send': '远端 HTTP 请求',
    'http.send.local': '本机 HTTP 请求',
  };
  return (
    <details>
      <summary>{cn ? '按目标覆盖权限' : 'Per-target permissions'}</summary>
      {profiles
        .filter((p) => settings.allowedProfiles.includes(p.id))
        .map((profile) => {
          const policy = settings.targetPolicies?.[profile.id];
          const update = (value: typeof policy) => {
            const next = { ...settings.targetPolicies };
            if (value) next[profile.id] = value;
            else delete next[profile.id];
            change(next);
          };
          return (
            <details key={profile.id}>
              <summary>{profile.name}</summary>
              <label>
                <input
                  type="checkbox"
                  checked={!!policy}
                  onChange={(event) =>
                    update(
                      event.target.checked
                        ? {
                            allowCommands: settings.allowCommands,
                            capabilities: [...(settings.capabilities ?? [])],
                            review: settings.review ?? 'always',
                          }
                        : undefined,
                    )
                  }
                />
                {cn ? '使用此目标的独立权限' : 'Override permissions for this target'}
              </label>
              {policy && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={policy.allowCommands}
                      onChange={(event) =>
                        update({ ...policy, allowCommands: event.target.checked })
                      }
                    />
                    {cn ? '执行命令' : 'Execute commands'}
                  </label>
                  <CapabilitySelection options={apiCapabilitySchema.options} value={policy.capabilities} change={capabilities=>update({...policy,capabilities})} />
                  {apiCapabilitySchema.options.map((capability) => (
                    <label key={capability}>
                      <input
                        type="checkbox"
                        checked={policy.capabilities.includes(capability)}
                        onChange={(event) =>
                          update({
                            ...policy,
                            capabilities: event.target.checked
                              ? [...policy.capabilities, capability]
                              : policy.capabilities.filter((c) => c !== capability),
                          })
                        }
                      />
                      {cn ? (labels[capability] ?? capability) : capability}
                    </label>
                  ))}
                  <label>
                    {cn ? '审核策略' : 'Review policy'}
                    <select
                      value={policy.review}
                      onChange={(event) =>
                        update({ ...policy, review: event.target.value as typeof policy.review })
                      }
                    >
                      <option value="always">{cn ? '每次审核' : 'Always review'}</option>
                      <option value="mutations">
                        {cn ? '审核需确认的操作' : 'Review flagged operations'}
                      </option>
                      <option value="authorized">
                        {cn ? '授权范围内直接执行' : 'Execute within grants'}
                      </option>
                    </select>
                  </label>
                </>
              )}
            </details>
          );
        })}
    </details>
  );
}
