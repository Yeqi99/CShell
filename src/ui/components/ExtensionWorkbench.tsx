import {TavilyView} from '../../extensions/tavily/View';
import {ClassroomView} from '../../extensions/classroom/View';
import type {ClassroomBridge,ClassroomSource} from '../../shared/classroom';
import { usePermissionNavigation } from '../permission-navigation';
import {OpenCodeView} from '../../extensions/opencode/View';
import './extension-market.css';
import './category-workspace.css';
import { WechatPlugin } from './WechatPlugin';
import { AgentWorkbench } from './AgentWorkbench';
import { WslPlugin } from './WslPlugin';
import type { LocalShell } from '../../shared/local-terminal';
import { useEffect, useRef, useState } from 'react';
import { pluginCatalogUrl } from '../../shared/market';
import {
  Blocks,
  Package,
  Search,
  RefreshCw,
  Trash2,
  Terminal,
  Play,
  Square,
  Plus,
  Download,
  Code2,
  Layers,
  Box,
  FileCode2,
} from 'lucide-react';
import {
  builtinPlugins,
  applications,
  pluginEnabled,
  type InstalledPlugin,
  type CatalogEntry,
  type ApplicationId,
  type InstallationPlan,
  type EnvironmentSnapshot,
  type RemoteJob,
} from '../../shared/plugins';
import { useI18n } from '../i18n';
import { PythonEditor } from './PythonEditor';
import { availablePluginViews } from './plugin-views';
import { ToolSettings } from './ToolSettings';
import type { ToolsSettings } from '../../shared/docker';
export type ExtensionSession = { id: string; label: string; closed: boolean };
export type PythonFileRequest = { sessionId: string; path: string; serial: number };
export function ExtensionWorkbench({
  tools,
  onLocal,
  visible,
  plugins,
  sessions,
  onChange,
  onTerminal,
  request,
  classroomBridge,
  onClassroomWatch,
}: {
  onLocal: (shell: LocalShell) => Promise<void>;
  tools: ToolsSettings;
  visible: boolean;
  plugins: InstalledPlugin[];
  sessions: ExtensionSession[];
  onChange: () => Promise<void>;
  onTerminal: (parent: string, id: string, name: string, python: string) => void;
  request: PythonFileRequest | null;
  classroomBridge?: ClassroomBridge;
  onClassroomWatch?: (source:ClassroomSource)=>void;
}) {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN';
  const [section, setSection] = useState<
    'plugins' | 'apps' | 'environment' | 'python' | 'wsl' | 'agent' | 'wechat' | 'opencode' | 'tavily' | 'classroom'
  >('plugins');
  const [settingsPlugin, setSettingsPlugin] = useState<string | null>(null);
  const [importPreview,setImportPreview]=useState<Awaited<ReturnType<typeof window.cshell.pluginImportPreview>>>(null);
  const [importNotice,setImportNotice]=useState('');
  const [processStatus,setProcessStatus]=useState<Awaited<ReturnType<typeof window.cshell.pluginProcessStatus>>>([]);
  const [dragging,setDragging]=useState(false);
  const views = availablePluginViews(plugins);
  const permissionRequest=usePermissionNavigation();
  useEffect(()=>{if(permissionRequest?.node.page==='wechat')setSection(views.some(v=>v.id==='wechat')?'wechat':'plugins');},[permissionRequest,plugins]);
  const currentView = views.find((view) => view.id === section);
  const [target, setTarget] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [catalogUrl, setCatalogUrl] = useState(pluginCatalogUrl),
    [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  useEffect(()=>{if(!plugins.some(item=>item.manifest.provider==='process')){setProcessStatus([]);return;}let active=true;void window.cshell.pluginProcessStatus().then(items=>{if(active)setProcessStatus(items);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[plugins,visible]);
  useEffect(() => {
    void window.cshell
      .pluginSource()
      .then((source) => {
        if (source) {
          setCatalogUrl(source.url);
          setCatalog(source.entries);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);
  const [appRequest, setAppRequest] = useState<{ app: ApplicationId; python?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!target && sessions.some((s) => !s.closed)) setTarget(sessions.find((s) => !s.closed)!.id);
  }, [sessions, target]);
  useEffect(() => {
    if (request) {
      setTarget(request.sessionId);
      setSection(views.some((view) => view.id === 'python') ? 'python' : 'plugins');
    }
  }, [request]);
  useEffect(() => {
    if (section !== 'plugins' && section !== 'apps' && !currentView) setSection('plugins');
  }, [section, currentView]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const openApp = (app: ApplicationId, python?: string) => {
    setAppRequest({ app, python });
    setSection('apps');
  };
  const manifests = [
    ...builtinPlugins.filter((p) => !catalog.some((c) => c.manifest.id === p.id)),
    ...catalog.map((p) => p.manifest),
    ...plugins
      .filter(
        (p) =>
          !builtinPlugins.some((b) => b.id === p.manifest.id) &&
          !catalog.some((c) => c.manifest.id === p.manifest.id),
      )
      .map((p) => p.manifest),
  ];
  return (
    <div className="workspace-category-container"><div className="extension-workbench" data-section={section}>
      <nav className="extension-nav" aria-label={zh ? '扩展导航' : 'Extension navigation'} onFocus={event => {
        if (event.target instanceof HTMLButtonElement) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }}>
        <h2>{zh ? '扩展' : 'Extensions'}</h2>
        {(
          [
            ['plugins', Blocks, zh ? '插件市场' : 'Plugins'],
            ['apps', Package, zh ? '应用市场' : 'Applications'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      <div className="extension-main">
        <header className="extension-heading">
          <div>
            {currentView && (
              <button className="plugin-back" onClick={() => setSection('plugins')}>
                ← {zh ? '插件市场' : 'Plugins'} / {currentView.title}
              </button>
            )}
            <h1>
              {section === 'plugins'
                ? zh
                  ? '插件市场'
                  : 'Plugin marketplace'
                : section === 'apps'
                  ? zh
                    ? '应用市场'
                    : 'Application marketplace'
                  : section === 'environment'
                    ? zh
                      ? 'Anaconda 环境'
                      : 'Anaconda environments'
                    : section === 'wsl'
                      ? 'WSL Linux'
                      : section === 'agent'
                        ? 'CAgent'
                        : section === 'classroom' ? '机房屏幕共享' : section === 'tavily' ? 'Tavily 搜索' : section === 'opencode' ? 'OpenCode' : section === 'wechat' ? '微信' : 'Python'}
            </h1>
            <p>
              {section === 'plugins'
                ? zh
                  ? '按需添加，随时停用。'
                  : 'Add the tools you need.'
                : section === 'classroom' ? '局域网共享 · 仅观看画面' : section === 'tavily' ? '网络搜索扩展' : section === 'opencode' ? '模型接入扩展' : section === 'wechat' ? '本机微信 · 独立授权' : section === 'agent'
                  ? zh
                    ? '配置所选 Agent 的连接、权限与服务。'
                    : 'Manage connections, permissions and services on the selected Agent.'
                  : section === 'wsl'
                    ? '本机 Linux 环境 · Windows WSL'
                    : zh
                      ? '操作仅作用于所选连接。'
                      : 'Actions belong to the selected connection.'}
            </p>
          </div>
          {section !== 'plugins' && section !== 'wsl' && section !== 'agent' && section !== 'wechat' && section !== 'opencode' && section !== 'tavily' && section !== 'classroom' && (
            <label className="extension-server">
              {zh ? '目标服务器' : 'Target server'}
              <select
                aria-label={zh ? '目标服务器' : 'Target server'}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{zh ? '选择连接' : 'Select connection'}</option>

                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.closed ? (zh ? ' · 已断开' : ' · Disconnected') : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        {error && (
          <div className="extension-error" role="alert">
            {error}
          </div>
        )}
        <div hidden={section !== 'plugins'} className={`plugin-market${dragging?' extension-drop-active':''}`}
          onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';setDragging(true);}}}
          onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}}
          onDrop={e=>{e.preventDefault();setDragging(false);if(busy)return;const files=Array.from(e.dataTransfer.files);if(files.length!==1){setError(zh?'请每次导入一个扩展包':'Import one extension at a time');return;}void run(async()=>{setImportNotice('');setImportPreview(await window.cshell.pluginImportPreview(files[0]));});}}>
          <div className="extension-toolbar">
            <div className="extension-search">
              <Search size={15} />
              <input
                aria-label={zh ? '搜索插件' : 'Search plugins'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={zh ? '搜索插件' : 'Search plugins'}
              />
            </div>
            <select
              aria-label={zh ? '插件筛选' : 'Plugin filter'}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">{zh ? '全部' : 'All'}</option>
              <option value="installed">{zh ? '已安装' : 'Installed'}</option>
              <option value="custom">{zh ? '自定义扩展' : 'Custom extensions'}</option>
            </select>
            <button disabled={busy} onClick={()=>void run(async()=>{setImportNotice('');setImportPreview(await window.cshell.pluginImportPreview());})}><Plus size={15}/>{zh?'导入扩展':'Import extension'}</button>
          </div>
          <p className="custom-extension-hint">{zh?'可将 .cshellext 文件拖入此处。自定义扩展单独管理，导入后由你启用。':'Drop a .cshellext file here. Imported extensions remain disabled until you enable them.'}</p>
          {dragging&&<div className="custom-extension-drop" role="status">{zh?'放开以预览扩展包':'Drop to preview extension'}</div>}
          {importNotice&&<p role="status" className="custom-extension-hint">{importNotice}</p>}
          {importPreview&&<section className="custom-extension-preview" aria-label={zh?'扩展导入预览':'Extension import preview'}>
            <div><strong>{importPreview.manifest.name}</strong> <span>{importPreview.manifest.version}</span><p>{importPreview.manifest.description}</p></div>
            <p>{importPreview.manifest.publisher} · {importPreview.trusted?(zh?'签名已验证':'Signature verified'):importPreview.manifest.provider==='process'?(zh?'未签名 · 含可执行代码':'Unsigned · contains executable code'):(zh?'自定义声明包 · 无可执行代码':'Custom declarative package · no executable code')}</p>
            {importPreview.manifest.provider==='process'&&<p>{zh?'代码在此电脑的独立进程中运行，具有当前系统用户权限。导入后仍需单独授权，独立进程不是安全沙箱。':'Code runs in a separate process on this computer with your OS user’s privileges. Importing does not authorize execution; a separate process is not a security sandbox.'}</p>}
            <p>{zh?'权限：':'Permissions: '}{importPreview.manifest.provider==='wechat'?(zh?'微信读取、发送、联系人管理均需另外授权；导入不会访问微信。':'WeChat operations require separate grants; importing does not access WeChat.'):importPreview.manifest.permissions.join(' · ')||(zh?'无':'None')}</p>
            <div className="custom-extension-actions"><button disabled={busy} onClick={()=>setImportPreview(null)}>{zh?'取消':'Cancel'}</button><button className="primary" disabled={busy} onClick={()=>void run(async()=>{await window.cshell.pluginImportApply(importPreview.token);await onChange();setFilter('custom');setImportPreview(null);setImportNotice(zh?'已导入。请启用扩展；微信运行包首次载入需要重新打开 CShell / CAgent。':'Imported. Enable the extension; restart CShell / CAgent to load the WeChat runtime.');})}>{zh?'确认导入':'Import'}</button></div>
          </section>}
          <div className="plugin-list">
            {manifests
              .filter(
                (p) =>
                  (filter==='custom' ? plugins.some(i=>i.manifest.id===p.id&&(i.source.startsWith('custom:')||p.provider==='wechat')) : p.provider!=='wechat'&&!plugins.some(i=>i.manifest.id===p.id&&i.source.startsWith('custom:'))) &&
                  (p.provider !== 'wsl' || navigator.platform.startsWith('Win')) &&
                  `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()) &&
                  (filter !== 'installed' || plugins.some((i) => i.manifest.id === p.id)),
              )
              .map((p) => {
                const installed = plugins.find((i) => i.manifest.id === p.id),
                  entry = catalog.find((c) => c.manifest.id === p.id);
                return (
                  <article className="plugin-row" data-provider={p.provider} key={p.id}>
                    <div className="plugin-symbol">
                      {p.provider === 'python' ? (
                        <Code2 size={22} />
                      ) : p.provider === 'conda' ? (
                        <Layers size={22} />
                      ) : p.provider === 'docker' ? (
                        <Box size={22} />
                      ) : p.provider === 'commands' ? (
                        <Terminal size={22} />
                      ) : ['vim', 'nano'].includes(p.provider) ? (
                        <FileCode2 size={22} />
                      ) : (
                        <Blocks size={22} />
                      )}
                    </div>
                    <div className="plugin-description">
                      <h3>
                        {p.name}
                        <small>{p.version}</small>
                      </h3>
                      <p>{!zh && p.descriptionEn ? p.descriptionEn : p.description}</p>
                      <small>
                        {p.publisher} ·{' '}
                        {p.provider==='process'?(zh?'本机独立进程 · 需单独授权':'Local process · separate authorization required'):p.permissions
                          .map(
                            (permission) =>
                              ({
                                'terminal.input': zh ? '终端输入' : 'Terminal input',
                                'remote.read': zh ? '读取服务器' : 'Read server',
                                'remote.execute': zh ? '执行远端操作' : 'Remote actions',
                                'remote.forward': zh ? 'SSH 隧道' : 'SSH forwarding',
                              })[permission],
                          )
                          .join(' · ')}
                      </small>
                    </div>
                    <div className="plugin-actions">
                      {p.provider==='process'&&installed?.enabled&&<button disabled={busy} onClick={()=>void run(async()=>{const allowed=processStatus.find(item=>item.id===p.id)?.grants.includes('extension.execute')??false;setProcessStatus(await window.cshell.pluginProcessAuthorize(p.id,!allowed));})}>{processStatus.find(item=>item.id===p.id)?.grants.includes('extension.execute')?(zh?'撤销运行权限':'Revoke execution'):(zh?'授权运行':'Authorize execution')}</button>}
                      {p.id === 'cshell.docker' && installed?.enabled && (
                        <button
                          onClick={() => setSettingsPlugin(settingsPlugin === p.id ? null : p.id)}
                          aria-expanded={settingsPlugin === p.id}
                        >
                          {zh ? '设置' : 'Settings'}
                        </button>
                      )}
                      {views
                        .filter((view) => view.pluginId === p.id)
                        .map((view) => (
                          <button key={view.id} onClick={() => setSection(view.id)}>
                            {zh ? '打开插件' : 'Open plugin'}
                          </button>
                        ))}
                      {installed ? (
                        <>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await window.cshell.pluginToggle(p.id, !installed.enabled);
                                await onChange();
                              })
                            }
                          >
                            {installed.enabled ? (zh ? '停用' : 'Disable') : zh ? '启用' : 'Enable'}
                          </button>
                          <button
                            className="icon"
                            disabled={busy}
                            aria-label={`${zh ? '卸载' : 'Uninstall'} ${p.name}`}
                            title={zh ? '卸载插件' : 'Uninstall plugin'}
                            onClick={() =>
                              void run(async () => {
                                await window.cshell.pluginRemove(p.id);
                                await onChange();
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              if (entry) await window.cshell.pluginDownload(entry);
                              else await window.cshell.pluginInstall(p.id);
                              await onChange();
                              if (p.provider === 'wsl') setSection('wsl');
                              if (p.provider === 'agent') setSection('agent');
                            })
                          }
                        >
                          <Download size={14} />
                          {entry ? (zh ? '下载并安装' : 'Download') : zh ? '安装' : 'Install'}
                        </button>
                      )}
                    </div>
                    {settingsPlugin === p.id && p.id === 'cshell.docker' && installed?.enabled && (
                      <div className="plugin-inline-settings">
                        <ToolSettings value={tools} onSave={onChange} />
                      </div>
                    )}
                  </article>
                );
              })}
          </div>
          <details className="plugin-source">
            <summary>{zh ? '插件源' : 'Plugin source'}</summary>
            <p className="muted">
              {zh
                ? '默认目录托管于 GitHub；离线时保留随版本提供的目录。下载后验证 SHA-256。'
                : 'GitHub hosts the catalog. The bundled catalog remains available offline. Downloads are SHA-256 verified.'}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => setCatalog(await window.cshell.pluginCatalog(catalogUrl)));
              }}
            >
              <input
                type="url"
                required
                placeholder="https://…/catalog.json"
                aria-label={zh ? '插件目录地址' : 'Catalog URL'}
                value={catalogUrl}
                onChange={(e) => setCatalogUrl(e.target.value)}
              />
              <button disabled={busy}>{zh ? '读取目录' : 'Load catalog'}</button>
            </form>
          </details>
        </div>
        {section === 'agent' && currentView && <AgentWorkbench />}
        {section === 'wechat' && currentView && <WechatPlugin />}
        {section === 'opencode' && currentView && <OpenCodeView />}
        {section === 'tavily' && currentView && <TavilyView />}
        {section === 'classroom' && currentView && (classroomBridge && onClassroomWatch ? <ClassroomView bridge={classroomBridge} onWatch={onClassroomWatch}/> : <p role="status">屏幕共享服务尚未就绪。</p>)}
        {section === 'wsl' && currentView && <WslPlugin onOpen={onLocal} />}
        {section !== 'plugins' && section !== 'wsl' && section !== 'agent' && section !== 'wechat' && section !== 'opencode' && section !== 'tavily' && section !== 'classroom' && !target && (
          <div className="extension-empty">
            {zh
              ? '先连接一台服务器，再选择安装或管理环境。'
              : 'Connect to a server to install applications or manage environments.'}
          </div>
        )}
        {sessions.map((s) => (
          <div
            className="extension-session"
            key={s.id}
            hidden={
              section === 'plugins' || section === 'wsl' || section === 'agent' || section === 'wechat' || section === 'opencode' || section === 'tavily' || section === 'classroom' || target !== s.id
            }
          >
            <ServerExtensions
              session={s}
              active={
                visible &&
                target === s.id &&
                section !== 'plugins' &&
                section !== 'wsl' &&
                section !== 'wechat' && section !== 'opencode' && section !== 'tavily' && section !== 'classroom' &&
                section !== 'agent'
              }
              section={section === 'wsl' || section === 'wechat' || section === 'opencode' || section === 'tavily' || section === 'classroom' ? 'plugins' : section}
              plugins={plugins}
              appRequest={appRequest}
              fileRequest={request?.sessionId === s.id ? request : null}
              onApp={openApp}
              onTerminal={onTerminal}
            />
          </div>
        ))}
      </div>
    </div></div>
  );
}

function ServerExtensions({
  session,
  active,
  section,
  plugins,
  appRequest,
  fileRequest,
  onApp,
  onTerminal,
}: {
  session: ExtensionSession;
  active: boolean;
  section: string;
  plugins: InstalledPlugin[];
  appRequest: { app: ApplicationId; python?: string } | null;
  fileRequest: PythonFileRequest | null;
  onApp: (app: ApplicationId, python?: string) => void;
  onTerminal: (parent: string, id: string, name: string, python: string) => void;
}) {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN';
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot | null>(null),
    [python, setPython] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [notebook, setNotebook] = useState<{ running: boolean; port?: number }>({ running: false });
  const [appCatalog, setAppCatalog] = useState(applications);
  const [appQuery, setAppQuery] = useState('');
  const detail = useRef<HTMLElement>(null);
  const [jobs, setJobs] = useState<RemoteJob[]>([]),
    [app, setApp] = useState<ApplicationId>('miniconda'),
    [plan, setPlan] = useState<InstallationPlan | null>(null);
  useEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
  }, [app]);
  const [name, setName] = useState('cshell-python'),
    [version, setVersion] = useState<'3.11' | '3.12' | '3.13' | '3.14'>('3.12'),
    [packages, setPackages] = useState(''),
    [packageList, setPackageList] = useState<{ name: string; version: string }[]>([]),
    [port, setPort] = useState(8888),
    [creating, setCreating] = useState(false);
  const [files, setFiles] = useState<string[]>([]),
    [file, setFile] = useState('');
  const condaEnabled = pluginEnabled(plugins, 'conda'),
    pythonEnabled = pluginEnabled(plugins, 'python');
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const result = await window.cshell.environments(session.id);
    setSnapshot(result);
    setPython((previous) =>
      previous &&
      (result.python === previous || result.environments.some((e) => e.python === previous))
        ? previous
        : result.environments[0]?.python || result.python || '',
    );
  };
  useEffect(() => {
    if (active && !session.closed && !snapshot) void run(refresh);
  }, [active, session.closed]);
  useEffect(() => {
    if (appRequest && active) {
      setApp(appRequest.app);
      if (appRequest.python) setPython(appRequest.python);
      setPlan(null);
    }
  }, [appRequest]);
  useEffect(() => {
    if (fileRequest?.path) {
      setFiles((old) => (old.includes(fileRequest.path) ? old : [...old, fileRequest.path]));
      setFile(fileRequest.path);
    }
  }, [fileRequest]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = () =>
      window.cshell
        .jobs(session.id)
        .then((value) => {
          if (!cancelled) setJobs(value);
        })
        .catch(() => {});
    const pollNotebook = () => {
      if (python)
        void window.cshell
          .jupyterStatus(session.id, python)
          .then((value) => {
            if (!cancelled) setNotebook(value);
          })
          .catch(() => {});
    };
    void poll();
    pollNotebook();
    const timer = setInterval(() => {
      void poll();
      pollNotebook();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, session.id, python]);
  useEffect(() => {
    if (jobs.some((j) => j.state === 'succeeded') && !session.closed)
      void refresh().catch((e) => setError(String(e)));
  }, [jobs.filter((j) => j.state === 'succeeded').length]);
  const locked = busy || session.closed || jobs.some((j) => j.state === 'running');
  const current = snapshot?.environments.find((e) => e.python === python);
  const choices = [
    ...(snapshot?.environments ?? []),
    ...(snapshot?.python && !snapshot.environments.some((e) => e.python === snapshot.python)
      ? [{ prefix: '', name: 'System Python', python: snapshot.python }]
      : []),
  ];
  const interpreter = (
    <label className="extension-interpreter">
      {zh ? 'Python 环境' : 'Python environment'}
      <select
        value={python}
        onChange={(e) => {
          setPython(e.target.value);
          setPackageList([]);
          setPlan(null);
        }}
      >
        <option value="">{zh ? '未检测到 Python' : 'No Python detected'}</option>
        {choices.map((e) => (
          <option key={e.python} value={e.python}>
            {e.name} · {e.python}
          </option>
        ))}
      </select>
    </label>
  );
  const missing = !snapshot?.conda && (
    <div className="extension-dependency">
      <span>{zh ? '此服务器尚未检测到 Conda。' : 'Conda was not detected on this server.'}</span>
      <button onClick={() => onApp('miniconda')}>
        {zh ? '安装 Miniconda' : 'Install Miniconda'}
      </button>
      <button onClick={() => onApp('anaconda')}>{zh ? '安装 Anaconda' : 'Install Anaconda'}</button>
    </div>
  );
  return (
    <>
      {session.closed && (
        <div className="extension-error">
          {zh
            ? '连接已断开，草稿与执行记录已保留。'
            : 'Disconnected. Drafts and task history are preserved.'}
        </div>
      )}
      {error && (
        <div className="extension-error" role="alert">
          {error}
        </div>
      )}
      <div hidden={section !== 'apps'} className="application-market">
        <div className="application-toolbar">
          <label className="extension-search">
            <Search size={15} />
            <input
              aria-label={zh ? '搜索应用' : 'Search applications'}
              placeholder={zh ? '搜索应用' : 'Search applications'}
              value={appQuery}
              onChange={(e) => setAppQuery(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            className="icon"
            title={zh ? '更新应用目录' : 'Refresh application catalog'}
            aria-label={zh ? '更新应用目录' : 'Refresh application catalog'}
            onClick={() =>
              void run(async () => setAppCatalog(await window.cshell.applicationCatalog()))
            }
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="application-list">
          {appCatalog
            .filter((a) =>
              `${a.name} ${a.description}`.toLowerCase().includes(appQuery.toLowerCase()),
            )
            .map((a) => (
              <button
                key={a.id}
                className={app === a.id ? 'selected' : ''}
                aria-pressed={app === a.id}
                disabled={busy}
                onClick={() => {
                  setApp(a.id);
                  setPlan(null);
                }}
              >
                <Package size={18} />
                <span>
                  <strong>{a.name}</strong>
                  <small>{a.description}</small>
                </span>
              </button>
            ))}
        </div>
        <section
          className="application-detail"
          ref={detail}
          aria-label={zh ? '应用详情' : 'Application details'}
        >
          <h2>{appCatalog.find((a) => a.id === app)?.name}</h2>
          {['python', 'jedi', 'jupyter'].includes(app) && interpreter}
          {app === 'python' && (
            <>
              {missing}
              <label>
                {zh ? '环境名称' : 'Environment name'}
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setPlan(null);
                  }}
                />
              </label>
              <label>
                {zh ? 'Python 版本' : 'Python version'}
                <select
                  value={version}
                  onChange={(e) => {
                    setVersion(e.target.value as typeof version);
                    setPlan(null);
                  }}
                >
                  {['3.11', '3.12', '3.13', '3.14'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {['anaconda', 'miniconda'].includes(app) && (
            <p className="muted">
              {zh
                ? '下载官方安装包并校验 SHA-256，安装到当前用户目录。使用前请确认适用的 Anaconda 许可条款。'
                : 'Downloads and verifies the official installer. Installs in your home directory. Review applicable Anaconda license terms.'}
            </p>
          )}
          <button
            disabled={locked}
            onClick={() =>
              void run(async () => {
                setPlan(null);
                setPlan(
                  await window.cshell.applicationPlan(session.id, {
                    app,
                    python: python || undefined,
                    conda: snapshot?.conda || undefined,
                    name,
                    version,
                  }),
                );
              })
            }
          >
            <RefreshCw size={14} />
            {busy ? (zh ? '处理中…' : 'Working…') : zh ? '检查安装条件' : 'Check installation'}
          </button>
          {plan && (
            <div className="installation-plan">
              <p>
                {zh ? '目标' : 'Target'}：{session.label}
              </p>
              <pre>{plan.command}</pre>
              <button
                className="primary"
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    const job = await window.cshell.applicationInstall(plan.id);
                    setJobs((old) => [...old, job]);
                    setPlan(null);
                  })
                }
              >
                <Download size={15} />
                {zh ? '安装到此服务器' : 'Install on this server'}
              </button>
            </div>
          )}
        </section>
      </div>
      <div hidden={section !== 'environment'} className="environment-manager">
        {!condaEnabled ? (
          <p className="extension-empty">
            {zh
              ? '请先在插件市场安装并启用 Anaconda 插件。'
              : 'Install and enable the Anaconda plugin first.'}
          </p>
        ) : (
          <>
            <div className="extension-toolbar">
              {interpreter}
              <button
                className="icon"
                disabled={locked}
                title={zh ? '刷新环境' : 'Refresh environments'}
                aria-label={zh ? '刷新环境' : 'Refresh environments'}
                onClick={() => void run(refresh)}
              >
                <RefreshCw size={16} />
              </button>
              <button disabled={locked || !snapshot?.conda} onClick={() => setCreating(!creating)}>
                <Plus size={14} />
                {zh ? '新建环境' : 'New environment'}
              </button>
            </div>
            {missing}
            {creating && (
              <form
                className="environment-create"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await window.cshell.environmentAction(session.id, {
                      type: 'create',
                      conda: snapshot!.conda!,
                      name,
                      version,
                    });
                    setCreating(false);
                  });
                }}
              >
                <input
                  aria-label={zh ? '环境名称' : 'Environment name'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  pattern="[a-zA-Z][a-zA-Z0-9_-]{0,63}"
                />
                <select
                  value={version}
                  onChange={(e) => setVersion(e.target.value as typeof version)}
                >
                  {['3.11', '3.12', '3.13', '3.14'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <button disabled={locked}>{zh ? '创建' : 'Create'}</button>
              </form>
            )}
            {python && (
              <>
                <div className="environment-actions">
                  <button
                    disabled={locked || !current || !snapshot?.conda}
                    onClick={() =>
                      void run(async () => {
                        const result = await window.cshell.environmentTerminal(
                          session.id,
                          snapshot!.conda!,
                          current!.prefix,
                        );
                        onTerminal(session.id, result.sessionId, current!.name, current!.python);
                      })
                    }
                  >
                    <Terminal size={15} />
                    {zh ? '在此环境打开终端' : 'Open environment terminal'}
                  </button>
                  <button
                    disabled={locked}
                    onClick={() =>
                      void run(async () =>
                        setPackageList(await window.cshell.environmentPackages(session.id, python)),
                      )
                    }
                  >
                    {zh ? '查看依赖' : 'Packages'}
                  </button>
                  <button
                    className="icon"
                    title={zh ? '删除环境' : 'Remove environment'}
                    aria-label={zh ? '删除环境' : 'Remove environment'}
                    disabled={locked || !current}
                    onClick={() =>
                      void run(async () => {
                        await window.cshell.environmentAction(session.id, {
                          type: 'remove',
                          conda: snapshot!.conda!,
                          prefix: current!.prefix,
                        });
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <form
                  className="environment-install"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await window.cshell.environmentAction(session.id, {
                        type: 'install',
                        python,
                        packages: packages.trim().split(/\s+/),
                      });
                      setPackages('');
                    });
                  }}
                >
                  <input
                    value={packages}
                    onChange={(e) => setPackages(e.target.value)}
                    placeholder="numpy pandas==2.3.0"
                    aria-label={zh ? '安装依赖' : 'Install packages'}
                  />
                  <button disabled={locked || !packages.trim()}>
                    {zh ? '安装依赖' : 'Install packages'}
                  </button>
                </form>
                <div className="environment-jupyter">
                  <strong>
                    JupyterLab {notebook.running && <small>{zh ? '运行中' : 'Running'}</small>}
                  </strong>
                  <label>
                    {zh ? '远端端口' : 'Remote port'}
                    <input
                      type="number"
                      min="1024"
                      max="65535"
                      value={notebook.running ? notebook.port : port}
                      disabled={notebook.running}
                      onChange={(e) => setPort(Number(e.target.value))}
                    />
                  </label>
                  <button disabled={locked} onClick={() => onApp('jupyter', python)}>
                    <Download size={14} />
                    {zh ? '安装' : 'Install'}
                  </button>
                  <button
                    disabled={locked}
                    onClick={() =>
                      void run(() => window.cshell.jupyterStart(session.id, python, port))
                    }
                  >
                    <Play size={14} />
                    {zh ? '打开' : 'Open'}
                  </button>
                  <button
                    className="icon"
                    disabled={session.closed || !notebook.running}
                    title={zh ? '停止 Jupyter' : 'Stop Jupyter'}
                    aria-label={zh ? '停止 Jupyter' : 'Stop Jupyter'}
                    onClick={() => void run(() => window.cshell.jupyterStop(session.id, python))}
                  >
                    <Square size={14} />
                  </button>
                </div>
                <div className="environment-packages">
                  {packageList.map((p) => (
                    <div key={p.name}>
                      <span>{p.name}</span>
                      <small>{p.version}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <div hidden={section !== 'python'} className="python-workspace">
        {!pythonEnabled ? (
          <p className="extension-empty">
            {zh
              ? '请先在插件市场安装并启用 Python 插件。'
              : 'Install and enable the Python plugin first.'}
          </p>
        ) : (
          <>
            <div className="extension-toolbar">
              {interpreter}
              <button disabled={locked} onClick={() => onApp(python ? 'jedi' : 'python', python)}>
                {python
                  ? zh
                    ? '安装补全引擎'
                    : 'Install completion engine'
                  : zh
                    ? '安装 Python'
                    : 'Install Python'}
              </button>
            </div>
            <div className="python-file-tabs">
              <button aria-pressed={!file} onClick={() => setFile('')}>
                {zh ? '草稿' : 'Scratchpad'}
              </button>
              {files.map((path) => (
                <button
                  key={path}
                  title={path}
                  aria-pressed={file === path}
                  onClick={() => setFile(path)}
                >
                  {path.split('/').pop()}
                </button>
              ))}
            </div>
            {['', ...files].map((path) => (
              <div className="python-editor-slot" hidden={path !== file} key={path}>
                <PythonEditor
                  sessionId={session.id}
                  python={python}
                  path={path || undefined}
                  connected={!session.closed}
                  onDependency={() => onApp('jedi', python)}
                />
              </div>
            ))}
          </>
        )}
      </div>
      {!!jobs.length && (
        <details className="extension-jobs" open>
          <summary>
            {zh ? '执行记录' : 'Task history'} · {jobs.length}
          </summary>
          {jobs
            .slice()
            .reverse()
            .map((job) => (
              <div key={job.id}>
                <header>
                  <strong>{job.label}</strong>
                  <span>
                    {zh
                      ? {
                          running: '执行中',
                          succeeded: '已完成',
                          failed: '失败',
                          cancelled: '已停止',
                        }[job.state]
                      : job.state}
                  </span>
                  {job.state === 'running' && (
                    <button
                      className="icon"
                      title={zh ? '停止任务' : 'Stop task'}
                      aria-label={zh ? '停止任务' : 'Stop task'}
                      onClick={() => void run(() => window.cshell.cancelJob(job.id))}
                    >
                      <Square size={13} />
                    </button>
                  )}
                </header>
                <pre>{job.output || (zh ? '正在执行…' : 'Running…')}</pre>
              </div>
            ))}
        </details>
      )}
    </>
  );
}
