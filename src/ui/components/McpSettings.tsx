import { defaultMcpPort } from '../../shared/mcp-endpoint';
import { selectAllMcpPermissions } from './mcp-all-permissions';
import { apiCapabilitySchema } from '../../shared/contracts';
import { CapabilitySelection } from './CapabilitySelection';
import { ApiTargetPolicies } from './ApiTargetPolicies';
import { ApiLocalScopes } from './ApiLocalScopes';
import { ApiFileRoots } from './ApiFileRoots';
import { ApiApplicationGrants } from './ApiApplicationGrants';
import { useEffect, useState } from 'react';
import type {
  McpSettings as Settings,
  McpStatus,
  Profile,
  ApiClient,
} from '../../shared/contracts';
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
    const next = await window.cshell.mcpConfigure(draft, status.revision);
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
  const updateClient = (id: string, change: Partial<ApiClient>) => {
    if (draft)
      setDraft({
        ...draft,
        clients: draft.clients?.map((c) => (c.id === id ? { ...c, ...change } : c)),
      });
  };
  return (
    <section className="mcp-settings">
      <h2>{t('mcpService')}</h2>
      <p className="muted">{t('mcpHint')}</p>
      {draft && (
        <fieldset disabled={busy || saving}>
          <div className="capability-selection mcp-global-actions">
            <strong>{locale === 'zh-CN' ? '全局权限' : 'Global permissions'}</strong>
            <button type="button" onClick={() => void run(async () => {
              const shells = await window.cshell.apiLocalShells();
              setDraft(current => current ? selectAllMcpPermissions(current, profiles, shells) : current);
            })}>{locale === 'zh-CN' ? '一键全选所有权限' : 'Select all permissions'}</button>
          </div>
          <details className="mcp-global-help"><summary>{locale === 'zh-CN' ? '全选会开放哪些范围' : 'What selecting all includes'}</summary><p className="muted">{locale === 'zh-CN'
            ? '包含当前所有可用连接、本机终端、全部能力、已添加目录的读写，以及独立客户端；取消机器级限制并设为授权范围内直接执行。保存后生效，服务与客户端启用状态保持不变。'
            : 'Includes all current supported connections, local terminals, capabilities, configured folder mutations and API clients. Removes target overrides and enables execution within grants. Save to apply; service and client enabled states stay unchanged.'}</p></details>
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
            {status?.running && status.endpoint ? <code>{status.endpoint}/mcp</code> : <span>{t('mcpStopped')}</span>}
            <button type="button" onClick={() => setDraft({...draft,port:defaultMcpPort()})}>{locale === 'zh-CN' ? '使用本版默认端口' : 'Use edition default port'} {defaultMcpPort()}</button>
          </p>
          <p className="muted">{t('mcpScope')}</p>
          <div className="mcp-profiles">
            {profiles
              .filter((p) => !p.protocol || ['ssh', 'sftp', 'ftp', 'ftps', 'client', 'http'].includes(p.protocol))
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
                  <span className="mcp-profile-copy"><strong>{profile.name}</strong><small>{profile.host}</small></span>
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
          <label>
            {locale === 'zh-CN' ? '已授权操作的审核' : 'Review authorized operations'}
            <select
              value={draft.review ?? 'always'}
              onChange={(e) => setDraft({ ...draft, review: e.target.value as Settings['review'] })}
            >
              <option value="always">
                {locale === 'zh-CN' ? '每次审核' : 'Review every call'}
              </option>
              <option value="mutations">
                {locale === 'zh-CN' ? '审核需确认的操作' : 'Review flagged operations'}
              </option>
              <option value="authorized">
                {locale === 'zh-CN' ? '授权范围内直接执行' : 'Execute within grants'}
              </option>
            </select>
          </label>
          <ApiTargetPolicies
            settings={draft}
            profiles={profiles}
            change={(targetPolicies) => setDraft({ ...draft, targetPolicies })}
          />
          <ApiFileRoots value={draft.localFileRoots} change={(localFileRoots) => setDraft({ ...draft, localFileRoots })} />
          <ApiLocalScopes
            value={draft.allowedLocalShells}
            change={(allowedLocalShells) => setDraft({ ...draft, allowedLocalShells })}
          />
          <ApiApplicationGrants
            value={draft.applicationCapabilities}
            change={(applicationCapabilities) => setDraft({ ...draft, applicationCapabilities })}
          />
          <details>
            <summary>
              {locale === 'zh-CN' ? '扩展能力授权' : 'Additional capability grants'}
            </summary>
            <CapabilitySelection options={apiCapabilitySchema.options} value={draft.capabilities} change={capabilities=>setDraft({...draft,capabilities})} />
            {(
              [
                ['files.read', '读取文件内容', 'Read file contents'],
                ['files.create', '创建文件（不覆盖）', 'Create files (no overwrite)'],
                ['directories.create', '创建目录（不递归）', 'Create directories (non-recursive)'],
                ['directories.manage', '移动或删除目录树', 'Move or delete directory trees'],
                ['files.rename', '重命名文件', 'Rename files'],
                ['files.delete', '永久删除文件', 'Permanently delete files'],
                ['files.write', '修改文件内容', 'Write file content'],
                ['docker.read', '读取 Docker', 'Read Docker'],
                ['docker.manage', '管理 Docker', 'Manage Docker'],
                ['terminal.read', '读取 API 终端输出', 'Read API terminal output'],
                [
                  'terminal.input',
                  '输入 API 终端（可执行命令）',
                  'Input to API terminal (can execute commands)',
                ],
                ['metrics.read', '资源指标', 'Resource metrics'],
                ['browser.read', '读取浏览器页面与截图', 'Read browser pages and screenshots'],
                ['browser.control', '操作浏览器（包括已登录网站）', 'Control browser (including signed-in sites)'],
                ['desktop.view', '查看远程桌面与截图', 'View remote desktop and screenshots'],
                ['desktop.control', '远程桌面键鼠输入', 'Remote desktop input'],
                ['agent.manage', 'Agent 管理', 'Agent management'],
                ['agent.hosting', 'HTTP 服务托管', 'HTTP hosting'],
                ['agent.relay', 'Agent 中继', 'Agent relay'],
                ['http.use', 'HTTP 工作区', 'HTTP workspaces'],
                [
                  'http.send',
                  '通过授权远端发送 HTTP',
                  'Send HTTP through authorized remote targets',
                ],
                ['http.send.local', '从本机发送 HTTP', 'Send HTTP from this machine'],
                ['environments.read', '读取环境', 'Read environments'],
                ['environments.manage', '修改环境', 'Manage environments'],
                ['applications.read', '应用安装计划', 'Application plans'],
                ['applications.install', '安装应用', 'Install applications'],
              ] as const
            ).map(([id, zh, en]) => (
              <label className="checkbox" key={id}>
                <input
                  type="checkbox"
                  checked={draft.capabilities?.includes(id) ?? false}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      capabilities: e.target.checked
                        ? [...(draft.capabilities ?? []), id]
                        : draft.capabilities?.filter((c) => c !== id),
                    })
                  }
                />
                {locale === 'zh-CN' ? zh : en}
              </label>
            ))}
          </details>
          <details>
            <summary>
              {locale === 'zh-CN' ? 'API 与能力披露' : 'API and capability discovery'}
            </summary>
            <p>
              {status?.running && status.endpoint ? <code>{status.endpoint}/api/v1/capabilities</code> : <span>{t('mcpStopped')}</span>}
            </p>
            <label>
              {locale === 'zh-CN' ? '披露模式' : 'Discovery mode'}
              <select
                aria-label={locale === 'zh-CN' ? '披露模式' : 'Discovery mode'}
                value={draft.disclosure?.mode ?? 'full'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    disclosure: {
                      level: 'contract',
                      budgetBytes: 32768,
                      ...draft.disclosure,
                      mode: e.target.value as 'full' | 'progressive' | 'adaptive',
                    },
                  })
                }
              >
                <option value="full">
                  {locale === 'zh-CN' ? '完整工具列表' : 'Full tool list'}
                </option>
                <option value="progressive">
                  {locale === 'zh-CN' ? '渐进发现' : 'Progressive discovery'}
                </option>
                <option value="adaptive">
                  {locale === 'zh-CN' ? '按目录大小自动选择' : 'Adapt to catalog size'}
                </option>
              </select>
            </label>
            <label>
              {locale === 'zh-CN' ? '目录默认详情' : 'Default catalog detail'}
              <select
                aria-label={locale === 'zh-CN' ? '目录默认详情' : 'Default catalog detail'}
                value={draft.disclosure?.level ?? 'contract'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    disclosure: {
                      mode: 'full',
                      budgetBytes: 32768,
                      ...draft.disclosure,
                      level: e.target.value as 'names' | 'summary' | 'contract' | 'guide',
                    },
                  })
                }
              >
                <option value="names">{locale === 'zh-CN' ? '名称索引' : 'Names'}</option>
                <option value="summary">{locale === 'zh-CN' ? '简要说明' : 'Summary'}</option>
                <option value="contract">
                  {locale === 'zh-CN' ? '完整参数与返回结构' : 'Complete contract'}
                </option>
                <option value="guide">
                  {locale === 'zh-CN' ? '契约与示例' : 'Contract and examples'}
                </option>
              </select>
            </label>
            <label>
              {locale === 'zh-CN' ? '目录响应预算（字节）' : 'Catalog response budget (bytes)'}
              <input
                type="number"
                min={1024}
                max={262144}
                step={1024}
                value={draft.disclosure?.budgetBytes ?? 32768}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    disclosure: {
                      mode: 'full',
                      level: 'contract',
                      ...draft.disclosure,
                      budgetBytes: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </details>
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
          <details>
            <summary>{locale === 'zh-CN' ? '独立 API 客户端' : 'Independent API clients'}</summary>
            {(draft.clients ?? []).map((client) => (
              <details key={client.id}>
                <summary>{client.name}</summary>
                <label>
                  {locale === 'zh-CN' ? '客户端名称' : 'Client name'}
                  <input
                    value={client.name}
                    maxLength={80}
                    onChange={(e) => updateClient(client.id, { name: e.target.value })}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={client.enabled}
                    onChange={(e) => updateClient(client.id, { enabled: e.target.checked })}
                  />
                  {locale === 'zh-CN' ? '允许此客户端接入' : 'Enable this client'}
                </label>
                <div className="mcp-profiles">
                  {profiles
                    .filter((p) => !p.protocol || ['ssh', 'sftp', 'ftp', 'ftps', 'client', 'http'].includes(p.protocol))
                    .map((p) => (
                      <label className="checkbox" key={p.id}>
                        <input
                          type="checkbox"
                          checked={client.allowedProfiles.includes(p.id)}
                          onChange={(e) =>
                            updateClient(client.id, {
                              allowedProfiles: e.target.checked
                                ? [...client.allowedProfiles, p.id]
                                : client.allowedProfiles.filter((id) => id !== p.id),
                            })
                          }
                        />
                        {p.name} · {p.host}
                      </label>
                    ))}
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={client.allowCommands}
                    onChange={(e) => updateClient(client.id, { allowCommands: e.target.checked })}
                  />
                  {locale === 'zh-CN' ? '执行命令' : 'Execute commands'}
                </label>
                <CapabilitySelection options={apiCapabilitySchema.options} value={client.capabilities} change={capabilities=>updateClient(client.id,{capabilities})} />
                {(
                  [
                    ['files.read', '读取文件', 'Read files'],
                    ['files.create', '创建文件（不覆盖）', 'Create files (no overwrite)'],
                    ['directories.create', '创建目录（不递归）', 'Create directories (non-recursive)'],
                    ['directories.manage', '移动或删除目录树', 'Move or delete directory trees'],
                    ['files.rename', '重命名文件', 'Rename files'],
                    ['files.delete', '永久删除文件', 'Permanently delete files'],
                    ['files.write', '修改文件内容', 'Write file content'],
                    ['docker.read', '读取 Docker', 'Read Docker'],
                    ['docker.manage', '管理 Docker', 'Manage Docker'],
                    ['terminal.read', '读取 API 终端输出', 'Read API terminal output'],
                    [
                      'terminal.input',
                      '输入 API 终端（可执行命令）',
                      'Input to API terminal (can execute commands)',
                    ],
                    ['metrics.read', '资源指标', 'Resource metrics'],
                ['browser.read', '读取浏览器页面与截图', 'Read browser pages and screenshots'],
                ['browser.control', '操作浏览器（包括已登录网站）', 'Control browser (including signed-in sites)'],
                ['desktop.view', '查看远程桌面与截图', 'View remote desktop and screenshots'],
                ['desktop.control', '远程桌面键鼠输入', 'Remote desktop input'],
                    ['agent.manage', 'Agent 管理', 'Agent management'],
                    ['agent.hosting', 'HTTP 服务托管', 'HTTP hosting'],
                    ['agent.relay', 'Agent 中继', 'Agent relay'],
                    ['http.use', 'HTTP 工作区', 'HTTP workspaces'],
                    [
                      'http.send',
                      '通过授权远端发送 HTTP',
                      'Send HTTP through authorized remote targets',
                    ],
                    ['http.send.local', '从本机发送 HTTP', 'Send HTTP from this machine'],
                    ['environments.read', '读取环境', 'Read environments'],
                    ['environments.manage', '修改环境', 'Manage environments'],
                    ['applications.read', '应用安装计划', 'Application plans'],
                    ['applications.install', '安装应用', 'Install applications'],
                  ] as const
                ).map(([id, zh, en]) => (
                  <label className="checkbox" key={id}>
                    <input
                      type="checkbox"
                      checked={client.capabilities.includes(id)}
                      onChange={(e) =>
                        updateClient(client.id, {
                          capabilities: e.target.checked
                            ? [...client.capabilities, id]
                            : client.capabilities.filter((c) => c !== id),
                        })
                      }
                    />
                    {locale === 'zh-CN' ? zh : en}
                  </label>
                ))}
                <ApiTargetPolicies
                  settings={client}
                  profiles={profiles}
                  change={(targetPolicies) => updateClient(client.id, { targetPolicies })}
                />
                <ApiFileRoots value={client.localFileRoots} change={(localFileRoots) => updateClient(client.id, { localFileRoots })} />
                <ApiLocalScopes
                  value={client.allowedLocalShells}
                  change={(allowedLocalShells) => updateClient(client.id, { allowedLocalShells })}
                />
                <ApiApplicationGrants
                  value={client.applicationCapabilities}
                  change={(applicationCapabilities) =>
                    updateClient(client.id, { applicationCapabilities })
                  }
                />
                <label>
                  {locale === 'zh-CN' ? '审核策略' : 'Review policy'}
                  <select
                    value={client.review}
                    onChange={(e) =>
                      updateClient(client.id, { review: e.target.value as ApiClient['review'] })
                    }
                  >
                    <option value="always">
                      {locale === 'zh-CN' ? '每次审核' : 'Review every call'}
                    </option>
                    <option value="mutations">
                      {locale === 'zh-CN' ? '审核需确认的操作' : 'Review flagged operations'}
                    </option>
                    <option value="authorized">
                      {locale === 'zh-CN' ? '授权范围内直接执行' : 'Execute within grants'}
                    </option>
                  </select>
                </label>
                <label>
                  {locale === 'zh-CN' ? '能力披露' : 'Discovery'}
                  <select
                    value={client.disclosure.mode}
                    onChange={(e) =>
                      updateClient(client.id, {
                        disclosure: {
                          ...client.disclosure,
                          mode: e.target.value as ApiClient['disclosure']['mode'],
                        },
                      })
                    }
                  >
                    <option value="full">
                      {locale === 'zh-CN' ? '完整工具列表' : 'Full tool list'}
                    </option>
                    <option value="progressive">
                      {locale === 'zh-CN' ? '渐进发现' : 'Progressive discovery'}
                    </option>
                    <option value="adaptive">{locale === 'zh-CN' ? '自动选择' : 'Adaptive'}</option>
                  </select>
                </label>
                <label>
                  {locale === 'zh-CN' ? '目录默认详情' : 'Catalog detail'}
                  <select
                    value={client.disclosure.level}
                    onChange={(e) =>
                      updateClient(client.id, {
                        disclosure: {
                          ...client.disclosure,
                          level: e.target.value as ApiClient['disclosure']['level'],
                        },
                      })
                    }
                  >
                    <option value="names">{locale === 'zh-CN' ? '名称索引' : 'Names'}</option>
                    <option value="summary">{locale === 'zh-CN' ? '简要说明' : 'Summary'}</option>
                    <option value="contract">{locale === 'zh-CN' ? '完整契约' : 'Contract'}</option>
                    <option value="guide">{locale === 'zh-CN' ? '契约与示例' : 'Guide'}</option>
                  </select>
                </label>
                <label>
                  {locale === 'zh-CN' ? '目录响应预算（字节）' : 'Catalog response budget (bytes)'}
                  <input
                    type="number"
                    min={1024}
                    max={262144}
                    step={1024}
                    value={client.disclosure.budgetBytes}
                    onChange={(e) =>
                      updateClient(client.id, {
                        disclosure: {
                          ...client.disclosure,
                          budgetBytes: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <div className="preset-row">
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await state.save();
                        await window.cshell.mcpCopyToken(client.id);
                      })
                    }
                  >
                    {locale === 'zh-CN' ? '保存并复制令牌' : 'Save and copy token'}
                  </button>
                  <button
                    type="button"
                    disabled={!client.enabled}
                    onClick={() =>
                      void run(async () => {
                        await state.save();
                        await window.cshell.mcpRotateToken(client.id);
                      })
                    }
                  >
                    {t('rotateToken')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        clients: draft.clients?.filter((c) => c.id !== client.id),
                      })
                    }
                  >
                    {locale === 'zh-CN' ? '移除客户端' : 'Remove client'}
                  </button>
                </div>
              </details>
            ))}
            <button
              type="button"
              disabled={(draft.clients?.length ?? 0) >= 20}
              onClick={() =>
                setDraft({
                  ...draft,
                  clients: [
                    ...(draft.clients ?? []),
                    {
                      id: crypto.randomUUID(),
                      name: locale === 'zh-CN' ? '新客户端' : 'New client',
                      enabled: false,
                      allowedProfiles: [],
                      allowCommands: false,
                      capabilities: [],
                      review: 'always',
                      disclosure: { mode: 'adaptive', level: 'summary', budgetBytes: 32768 },
                    },
                  ],
                })
              }
            >
              {locale === 'zh-CN' ? '添加客户端' : 'Add client'}
            </button>
          </details>
          <p className="muted">
            {locale === 'zh-CN'
              ? '保存后生效，并断开 API 创建的连接。工作区终端不受影响。'
              : 'Saving applies changes and closes API-owned connections. Workbench terminals stay open.'}
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
