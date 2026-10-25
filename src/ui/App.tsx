import {SharedTerminalMount, TerminalSlot} from './components/SharedTerminalMount';
import {RdpMachineWorkspace} from './components/RdpMachineWorkspace';
import {LinuxWorkspace} from './components/LinuxWorkspace';
import {SavedAgentConnection} from './components/SavedAgentConnection';
import { MonitorViews } from './components/MonitorViews';
import { WorkbenchHome } from './components/WorkbenchHome';
import type { CurrentViewSource } from '../shared/monitor-views';
import {AgentMachineWorkspace} from './components/AgentMachineWorkspace';
import type {AgentTarget} from '../shared/agent';
import { RdpConnectionForm } from './components/RdpConnectionForm';
import { usePermissionNavigation } from './permission-navigation';
import { HttpWorkbench, HttpCreate } from './components/HttpWorkbench';
import { WslAccount } from './components/WslAccount';
import type { LocalConnectionTarget } from '../shared/local-terminal';
import { ConnectionEntry } from './components/ConnectionEntry';
import { ClipboardConnection } from './components/ClipboardConnection';
import { TextAssist } from './components/TextAssist';
import { ClientProfileEditor } from './components/ClientProfileEditor';
import type { ClientDevice, ClientShell } from '../shared/client';
import { TabStrip } from './components/TabStrip';
import type { LocalShell } from '../shared/local-terminal';
import { ActivityPage } from './components/ActivityPage';
import { initialPlugins, pluginEnabled } from '../shared/plugins';
import { AiPanel } from './components/AiPanel';
import { AiExecution } from './components/AiExecution';
import type { PythonFileRequest } from './components/ExtensionWorkbench';
const ExtensionWorkbench = lazy(() =>
  import('./components/ExtensionWorkbench').then((module) => ({
    default: module.ExtensionWorkbench,
  })),
);
import { toolsDefaults } from '../shared/docker';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  HardDrive,
  LayoutDashboard,
  Files,
  BarChart3,
  Bot,
  Minimize2,
  Maximize2,
  Pin,
  PinOff,
  Blocks,
  Moon,
  Sun,
  RotateCcw,
  Server,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';
import {
  defaults,
  type Config,
  type Credentials,
  type Preferences,
  type Profile,
  type Transfer,
} from '../shared/contracts';
import { LocaleContext, useI18n } from './i18n';
import { CommandPicker, type WorkbenchCommand } from './components/CommandPicker';
import { ConnectionForm } from './components/ConnectionForm';
import { Settings } from './components/Settings';
import { LanguageMenu } from './components/LanguageMenu';
import { DockGrip, PanelResizer, usePanelDrop } from './components/Docking';
import { Tooltips } from './components/Tooltips';
import { useAppearance, WorkbenchBackground } from './appearance';
import { Modal } from './components/Modal';
import { TerminalPane } from './components/TerminalPane';
import { ServerSidebar } from './components/ServerSidebar';
import { SavedConnection } from './components/SavedConnection';
import { connectRequest } from './connect-request';
import { connectionErrorMessage } from '../shared/connection-errors';
import { LocalDock } from './components/LocalDock';
import { ToolsPanel } from './components/ToolsPanel';
import { SessionTab } from './components/SessionTab';
import { shortcutFor } from './shortcuts';
import {
  terminalEvent,
  terminalClosed,
  terminalCloseReason,
  terminalSnapshot,
} from './terminalBus';
import brandMark from '../../assets/icon.svg';

type Tab = {
  client?: { device: ClientDevice; shell: ClientShell; distribution?: string };
  local?: LocalShell;
  id: string;
  profile: Profile;
  closed: boolean;
  python?: string;
};
export function App() {
  const [config, setConfig] = useState<Config>({
    plugins: initialPlugins(),
    tools: toolsDefaults,
    groups: [],
    profiles: [],
    preferences: defaults,
    savedCredentials: [],
  });
  return (
    <LocaleContext.Provider value={config.preferences.locale}>
      <Workbench config={config} setConfig={setConfig} />
    </LocaleContext.Provider>
  );
}
function Workbench({ config, setConfig }: { config: Config; setConfig: (c: Config) => void }) {
  const { t } = useI18n();
  const importedPasswords = useRef(new Map<string, string>());
  const [localTargets, setLocalTargets] = useState<LocalConnectionTarget[]>([]);
  const [wslSetupTarget, setWslSetupTarget] = useState<string | null>(null);
  const [wslBusy, setWslBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () =>
      void window.cshell
        .localTargets()
        .then((v) => {
          if (active) setLocalTargets(v);
        })
        .catch(() => {});
    update();
    const timer = setInterval(update, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [config.plugins]);
  const [minimalHover, setMinimalHover] = useState(false);
  useEffect(() => window.cshell.onMinimalHover(setMinimalHover), []);
  useEffect(
    () =>
      window.cshell.onAiConnection(({ sessionId, profile }) => {
        if (profile.protocol === 'client') {
          void window.cshell
            .clientDevices()
            .then((devices) => {
              const device = devices.find((d) => d.deviceId === profile.id);
              if (device) {
                setTabs((items) =>
                  items.some((t) => t.id === sessionId)
                    ? items
                    : [
                        ...items,
                        {
                          id: sessionId,
                          profile,
                          closed: terminalClosed(sessionId),
                          client: {
                            device,
                            shell: profile.clientShell ?? 'powershell',
                            distribution: profile.clientDistribution,
                          },
                        },
                      ],
                );
                setActive(sessionId);
                setSurface('terminal');
              }
            })
            .catch(onError);
          return;
        }
        setTabs((items) =>
          items.some((t) => t.id === sessionId)
            ? items
            : [...items, { id: sessionId, profile, closed: terminalClosed(sessionId) }],
        );
        setActive(sessionId);
        setSurface('terminal');
      }),
    [],
  );
  const [minimal, setMinimal] = useState(false);
  useEffect(() => {
    void window.cshell.setMinimalMode(minimal).catch(onError);
  }, [minimal]);
  const [pinned, setPinned] = useState(false);
  const [aiVisible, setAiVisible] = useState(false);
  useEffect(() => {
    const open = () => {
      setAiVisible(true);
      setMinimal(false);
    };
    window.addEventListener('cshell:open-ai', open);
    return () => window.removeEventListener('cshell:open-ai', open);
  }, []);
  const [activityOpen, setActivityOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const openActivity = () => {
    setActivityOpen(true);
    setSurface('activity');
    setMinimal(false);
  };
  const [extensions, setExtensions] = useState(false);
  const [extensionVisited, setExtensionVisited] = useState(false);
  const [pythonRequest, setPythonRequest] = useState<PythonFileRequest | null>(null);
  const permissionRequest=usePermissionNavigation();
  useEffect(()=>{if(!permissionRequest)return;setMinimal(false);if(permissionRequest.node.page==='wechat'){setExtensions(true);setExtensionVisited(true);setSurface('extensions');}else setAiVisible(true);},[permissionRequest]);
  const openExtensions = () => {
    setExtensions(true);
    setExtensionVisited(true);
    setSurface('extensions');
  };
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; path: string }>).detail;
      setPythonRequest({ ...detail, serial: Date.now() });
      openExtensions();
    };
    window.addEventListener('cshell:open-extensions', openExtensions);
    window.addEventListener('cshell:open-python', handler);
    return () => {
      window.removeEventListener('cshell:open-extensions', openExtensions);
      window.removeEventListener('cshell:open-python', handler);
    };
  }, []);
  const [drafts, setDrafts] = useState<Array<Profile | 'new'>>([]);
  const [localDock, setLocalDock] = useState(false);
  const [fileReveal, setFileReveal] = useState({id: '', revision: 0});
  const [preview, setPreview] = useState<Preferences | null>(null);
  const [themeRequest, setThemeRequest] = useState<{ theme: Preferences['theme'] } | null>(null);
  const preferences = preview ?? config.preferences;
  const left = preferences.layout.serverVisible,
    right = preferences.layout.fileVisible;
  const [tabs, setTabs] = useState<Tab[]>([]),
    [active, setActive] = useState(''),
    [form, setForm] = useState<Profile | 'new' | null>(null),
    [settings, setSettings] = useState(false),
    [surface, setSurface] = useState<
      'terminal' | 'connection' | 'quick' | 'settings' | 'extensions' | 'activity' | 'wsl' | 'machine' | 'views' | 'home'
    >('home'),
    [palette, setPalette] = useState(false),
    [error, setError] = useState(''),
    [searching, setSearching] = useState(false),
    [transfers, setTransfers] = useState<Transfer[]>([]),
    [confirmDelete, setConfirmDelete] = useState<Profile | null>(null),
    [confirmClose, setConfirmClose] = useState<Tab | null>(null);
  const [linuxWorkspaces,setLinuxWorkspaces]=useState<string[]>([]);
  const [linuxModes,setLinuxModes]=useState<Record<string,boolean>>({});
  const linuxRestored=useRef(new Set<string>());
  useEffect(()=>{for(const tab of tabs){if(tab.local||tab.client||linuxRestored.current.has(tab.id))continue;linuxRestored.current.add(tab.id);if(config.preferences.defaultConnectionView !== 'original'){setLinuxWorkspaces(v=>v.includes(tab.id)?v:[...v,tab.id]);setLinuxModes(v=>({...v,[tab.id]:true}));}}},[tabs]);
  const [machineSessionIds,setMachineSessionIds]=useState<Record<string,string[]>>({});
  const [machineSessionCounts,setMachineSessionCounts]=useState<Record<string,number>>({});
  const [machines,setMachines]=useState<{device:ClientDevice;target:AgentTarget}[]>([]),[machineId,setMachineId]=useState('');
  const currentSsh = [...tabs.filter(tab => !tab.closed).map(t=>({id:t.id})),...machines.flatMap(m=>(machineSessionIds[m.target.id]??[]).map(id=>({id})))];
  const currentDevices = [...new Set([...machines.map(m => m.device.deviceId), ...tabs.filter(t => !t.closed && t.client).map(t => t.client!.device.deviceId)])];
  const openCurrentView = async (mode: 'tile' | 'focus' | 'overview') => {
    const sources: CurrentViewSource[] = await Promise.all(currentSsh.map(async tab => ({
      kind: 'terminal' as const, sessionId: tab.id, snapshot: await terminalSnapshot(tab.id),
    })));
    sources.push(...currentDevices.map(profileId => ({ kind: 'desktop' as const, profileId })));
    await window.cshell.openCurrentView(sources, mode);
  };
  async function openMachineDevice(device:ClientDevice){
    const existing=machines.find(m=>m.device.deviceId===device.deviceId);
    const latest=await window.cshell.config();const opened=existing?.target??await window.cshell.agentMachineOpen(device.deviceId);
    const target={...opened,name:latest.profiles.find(p=>p.id===device.deviceId)?.name??device.name};
    setMachines(v=>v.some(m=>m.target.id===target.id)?v:[...v,{device,target}]);setMachineId(target.id);setSurface('machine');
    setConfig(await window.cshell.config());
  }
  async function closeMachine(id:string){await window.cshell.agentMachineClose(id);setMachineSessionCounts(v=>{const next={...v};delete next[id];return next;});setMachines(v=>v.filter(m=>m.target.id!==id));if(machineId===id){setMachineId('');setSurface('terminal');}}
  const wslReturnSurface = useRef<typeof surface>('terminal');
  const closeWslSetup = () => {
    setWslSetupTarget(null);
    setSurface(wslReturnSurface.current);
  };
  const [quickConnections, setQuickConnections] = useState<Profile[]>([]);
  const [quickId, setQuickId] = useState('');
  const [quickVisual, setQuickVisual] = useState<Record<string, boolean>>({});
  const openSaved = (profile: Profile, visual = config.preferences.defaultConnectionView !== 'original') => {
    setQuickVisual(v => ({...v, [profile.id]: visual}));
    if (profile.protocol === 'rdp' && !visual) {
      void window.cshell.openRdp(profile.id).catch(onError);
      return;
    }
    setQuickConnections((items) =>
      items.some((item) => item.id === profile.id) ? items : [...items, profile],
    );
    setQuickId(profile.id);
    setSurface('quick');
  };
  const openConnection = (profile: Profile | 'new') => {
    if (profile !== 'new' && profile.protocol === 'http') {
      openSaved(profile);
      return;
    }
    setDrafts((items) =>
      items.some(
        (item) => (item === 'new' ? 'new' : item.id) === (profile === 'new' ? 'new' : profile.id),
      )
        ? items
        : [...items, profile],
    );
    setForm(
      drafts.find(
        (item) => (item === 'new' ? 'new' : item.id) === (profile === 'new' ? 'new' : profile.id),
      ) ?? profile,
    );
    setSurface('connection');
  };
  useEffect(() => {
    const handler = (event: Event) => {
      const profile = config.profiles.find((p) => p.id === (event as CustomEvent<string>).detail);
      if (profile && profile.protocol !== 'http') openSaved(profile);
    };
    window.addEventListener('cshell:open-sender', handler);
    return () => window.removeEventListener('cshell:open-sender', handler);
  }, [config.profiles]);
  const openSettings = () => {
    setThemeRequest(null);
    setSettings(true);
    setSurface('settings');
  };
  const closeEditor = (target = form) => {
    if (target && target !== 'new') importedPasswords.current.delete(target.id);
    setDrafts((items) =>
      items.filter(
        (item) => (item === 'new' ? 'new' : item.id) !== (target === 'new' ? 'new' : target?.id),
      ),
    );
    if (form === target) {
      setForm(null);
      if (surface === 'connection') setSurface('terminal');
    }
  };
  const closeSettings = () => {
    setSettings(false);
    setSurface((current) => (current === 'settings' ? 'terminal' : current));
  };
  const onError = useCallback(
    (e: unknown) =>
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(e),
      ),
    [],
  );
  const refresh = useCallback(async () => setConfig(await window.cshell.config()), [setConfig]);
  useEffect(() => {
    void refresh().catch(onError);
    return window.cshell.events((event) => {
      terminalEvent(event);
      if (event.type === 'closed') {
        setTabs((current) =>
          current.map((tab) => (tab.id === event.sessionId ? { ...tab, closed: true } : tab)),
        );
      }
      if (event.type === 'transfer')
        setTransfers((current) =>
          [...current.filter((x) => x.id !== event.transfer.id), event.transfer].slice(-100),
        );
    });
  }, [refresh, onError]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.lang = config.preferences.locale;
    document.body.style.fontFamily = preferences.uiFont;
    const style = document.documentElement.style;
    style.setProperty('--ui-font-size', `${preferences.uiFontSize ?? 15}px`);
    style.setProperty('--sidebar-font-size', `${preferences.sidebarFontSize ?? 15}px`);
    style.setProperty('--sidebar-group-size', `${preferences.sidebarGroupSize ?? 16}px`);
    style.setProperty('--sidebar-detail-size', `${preferences.sidebarDetailSize ?? 13}px`);
    style.setProperty('--sidebar-row-padding', `${({ compact: 7, comfortable: 11, spacious: 15 })[preferences.sidebarDensity ?? 'comfortable']}px`);
  }, [preferences]);
  useAppearance(preferences, onError);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const shortcut = shortcutFor(e);
      if (!shortcut) return;
      e.preventDefault();
      if (shortcut === 'palette') setPalette((value) => !value);
      if (shortcut === 'new') openConnection('new');
      if (shortcut === 'search') setSearching((s) => !s);
      if (shortcut === 'settings') openSettings();
      if (shortcut === 'sidebar') togglePanel('serverVisible');
      if (shortcut === 'tools') openFiles();
      if (shortcut === 'nextTab' || shortcut === 'previousTab') {
        const views = [
          { key: 'home', select: () => setSurface('home') },
          ...tabs.map((tab) => ({
            key: tab.id,
            select: () => {
              setActive(tab.id);
              setSurface('terminal');
            },
          })),
          ...drafts.map((draft) => ({
            key: draft === 'new' ? 'new' : `edit-${draft.id}`,
            select: () => {
              setForm(draft);
              setSurface('connection');
            },
          })),
          ...quickConnections.map((profile) => ({
            key: `quick-${profile.id}`,
            select: () => {
              setQuickId(profile.id);
              setSurface('quick');
            },
          })),
          ...(extensions ? [{ key: 'extensions', select: openExtensions }] : []),
          ...(activityOpen ? [{ key: 'activity', select: () => setSurface('activity') }] : []),
          ...(settings ? [{ key: 'settings', select: () => setSurface('settings') }] : []),
        ];
        const key =
          surface === 'home' ? 'home' : surface === 'terminal'
            ? active
            : surface === 'quick'
              ? `quick-${quickId}`
              : surface === 'extensions'
                ? 'extensions'
                : surface === 'activity'
                  ? 'activity'
                  : surface === 'settings'
                    ? 'settings'
                    : form === 'new'
                      ? 'new'
                      : `edit-${form?.id}`;
        const next =
          (views.findIndex((v) => v.key === key) +
            (shortcut === 'nextTab' ? 1 : -1) +
            views.length) %
          views.length;
        views[next]?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    preferences,
    drafts,
    tabs,
    active,
    surface,
    settings,
    form,
    extensions,
    quickConnections,
    quickId,
  ]);
  const current = surface === 'terminal' ? tabs.find((tab) => tab.id === active) : undefined;
  useEffect(
    () =>
      window.cshell.onFocusSession((id) => {
        setActive(id);
        setSurface('terminal');
        setMinimal(false);
      }),
    [],
  );
  const showTools = surface === 'terminal' && !linuxModes[active] && right && !!current && !current.closed && !current.local && !current.client;
  const saveProfile = async (p: Profile) => {
    await window.cshell.saveProfile(p);
    setTabs((items) =>
      items.map((tab) => (tab.profile.id === p.id ? { ...tab, profile: p } : tab)),
    );
    await refresh();
  };
  async function connect(
    profile: Profile,
    credentials: Credentials,
    persist: boolean,
    signal?: AbortSignal,
  ) {
    const result = await connectRequest(window.cshell, profile, credentials, persist, signal);
    setTabs((v) => [
      ...v,
      { id: result.sessionId, profile, closed: terminalClosed(result.sessionId) },
    ]);
    const visual = quickVisual[profile.id] ?? config.preferences.defaultConnectionView !== 'original';
    if (visual) setLinuxWorkspaces(v=>[...v,result.sessionId]);
    setLinuxModes(v=>({...v,[result.sessionId]:visual}));
    linuxRestored.current.add(result.sessionId);
    setActive(result.sessionId);
    setSurface('terminal');
    void refresh().catch(onError);
  }
  async function addClient(
    result: { sessionId: string; name: string },
    device: ClientDevice,
    shell: ClientShell,
    distribution?: string,
  ) {
    const latest = await window.cshell.config();
    setConfig(latest);
    const saved = latest.profiles.find((p) => p.id === device.deviceId);
    setTabs((items) => [
      ...items,
      {
        id: result.sessionId,
        client: { device, shell, distribution },
        closed: terminalClosed(result.sessionId),
        profile: {
          id: device.deviceId,
          name: result.name,
          protocol: 'client',
          clientShell: shell,
          clientDistribution: distribution,
          host: device.host,
          port: device.port,
          username: '',
          group: '',
          favorite: false,
          auth: 'password',
          ...saved,
        },
      },
    ]);
    setActive(result.sessionId);
    setSurface('terminal');
  }
  async function openLocal(shell: LocalShell) {
    if (wslBusy && shell.startsWith('wsl:') && shell.slice(4) !== wslSetupTarget)
      throw new Error('当前 Linux 用户正在初始化，请稍候');
    if (shell.startsWith('wsl:') && !(await window.cshell.wslAccountStatus(shell.slice(4))).ready) {
      if (surface !== 'wsl') wslReturnSurface.current = surface;
      setWslSetupTarget(shell.slice(4));
      setSurface('wsl');
      return;
    }
    const result = await window.cshell.localTerminal(shell);
    setTabs((tabs) => [
      ...tabs,
      {
        id: result.sessionId,
        local: shell,
        closed: terminalClosed(result.sessionId),
        profile: {
          id: result.sessionId,
          name: result.name,
          host: '本机',
          port: 0,
          username: '',
          group: '',
          favorite: false,
          auth: 'password',
        },
      },
    ]);
    setActive(result.sessionId);
    setSurface('terminal');
  }
  async function closeTab(tab: Tab) {
    await window.cshell.disconnect(tab.id);
    const remaining = tabs.filter((x) => x.id !== tab.id);
    setTabs(remaining);
    if (active === tab.id) setActive(remaining.at(-1)?.id || '');
    setConfirmClose(null);
  }
  const run = (p: Promise<unknown>) => void p.catch(onError);
  useEffect(() => {
    if (!minimal) setPinned(false);
    void window.cshell.setAlwaysOnTop(minimal && pinned).catch((e: Error) => {
      setPinned(false);
      setError(e.message);
    });
  }, [minimal, pinned]);
  const preferenceRevision = useRef(0);
  const savePreferences = async (value: Preferences) => {
    const revision = ++preferenceRevision.current;
    // Subsequent controls must read the new draft while persistence is in flight.
    setConfig({ ...config, preferences: value });
    try {
      await window.cshell.preferences(value);
      const latest = await window.cshell.config();
      if (revision === preferenceRevision.current) setConfig(latest);
    } catch (error) {
      if (revision === preferenceRevision.current) await refresh();
      throw error;
    }
  };
  const layout = preferences.layout;
  const onLayout = (next: Preferences['layout']) => {
    if (preview) setPreview({ ...preview, layout: next });
    else run(savePreferences({ ...config.preferences, layout: next }));
  };
  const togglePanel = (key: 'serverVisible' | 'fileVisible') =>
    onLayout({ ...layout, [key]: !layout[key] });
  const docking = usePanelDrop(layout, onLayout);
  const openFiles = () => {
    if (!current || current.closed || current.local || current.client) return;
    onLayout({...layout, fileVisible: true});
    setFileReveal(value => ({id: current.id, revision: value.revision + 1}));
  };
  const commands: WorkbenchCommand[] = [
    {
      id: 'new',
      name: t('newServer'),
      hint: 'Ctrl+Shift+N',
      icon: Plus,
      action: () => openConnection('new'),
    },
    { id: 'settings', name: t('settings'), hint: 'Ctrl+,', icon: Settings2, action: openSettings },
    {
      id: 'sidebar',
      name: t('sidebar'),
      hint: 'Ctrl+Shift+B',
      icon: PanelLeft,
      action: () => togglePanel('serverVisible'),
    },
    ...(current && !current.closed && !current.local && !current.client
      ? [
          {
            id: 'files',
            name: t('files'),
            hint: 'Ctrl+Shift+E',
            icon: Files,
            action: openFiles,
          },
        ]
      : []),
    {
      id: 'reset',
      name: t('resetLayout'),
      icon: RotateCcw,
      searchOnly: true,
      action: () => onLayout(defaults.layout),
    },
    ...config.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      hint: p.host,
      icon: Server,
      server: true,
      action: () => openConnection(p),
    })),
  ];
  return (
    <div
      className={`app-shell ${minimal ? 'minimal-mode' : ''} ${minimalHover ? 'minimal-hover' : ''} ${preferences.backgroundAsset ? 'has-background' : ''}`}
    >
      <Tooltips />
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src={brandMark} alt="" draggable={false} />
          <strong>CShell</strong>
        </div>
        <div className="titlebar-space" />
        <button className="icon" title="视图" aria-label="视图" onClick={() => { setViewsOpen(true); setSurface('views'); }}><LayoutDashboard size={18}/></button>
        <button
          className="icon"
          title={config.preferences.locale === 'zh-CN' ? '统计与历史' : 'Activity & history'}
          aria-label={config.preferences.locale === 'zh-CN' ? '统计与历史' : 'Activity & history'}
          onClick={openActivity}
        >
          <BarChart3 size={18} />
        </button>
        <button
          className="icon"
          title="AI 智能体"
          aria-label="AI 智能体"
          aria-pressed={aiVisible}
          onClick={() => setAiVisible(!aiVisible)}
        >
          <Bot size={18} />
        </button>
        <button
          className="icon"
          title={config.preferences.locale === 'zh-CN' ? '插件与应用' : 'Plugins & applications'}
          aria-label={
            config.preferences.locale === 'zh-CN' ? '插件与应用' : 'Plugins & applications'
          }
          onClick={openExtensions}
        >
          <Blocks size={18} />
        </button>
        <button
          className="palette-trigger"
          aria-label={t('commandPalette')}
          title={t('commandPalette')}
          aria-expanded={palette}
          aria-controls="workbench-commands"
          onClick={() => setPalette((value) => !value)}
        >
          <Search size={14} />
          <span>{t('commandPalette')}</span>
          <kbd>Ctrl+Shift+P</kbd>
        </button>
        <button className="icon" title={t('settings')} onClick={() => openSettings()}>
          <Settings2 size={18} />
        </button>
      </header>
      {palette && <CommandPicker commands={commands} onClose={() => setPalette(false)} />}

      <div
        className={`workspace dock-workspace ${left ? '' : 'hide-left'} ${showTools ? '' : 'hide-right'}`}
        {...docking.events}
      >
        {docking.overlay}
        <WorkbenchBackground preferences={preferences} onError={onError} />
        {left && (
          <div
            className="dock-side"
            data-panel="servers"
            style={{ order: layout.order.indexOf('servers'), width: layout.serverWidth }}
          >
            <div className="dock-heading">
              <DockGrip
                panel="servers"
                label={t('allServers')}
                layout={layout}
                onChange={onLayout}
              />
              <span>{t('allServers')}</span>
            </div>
            <PanelResizer
              panel="servers"
              width={layout.serverWidth}
              reverse={layout.order.indexOf('servers') > layout.order.indexOf('terminal')}
              onChange={(serverWidth) => onLayout({ ...layout, serverWidth })}
            />
            <ServerSidebar
              preferences={config.preferences}
              onPreferences={savePreferences}
              targets={localTargets}
              onTarget={(target) => run(openLocal(target.shell))}
              groups={config.groups}
              profiles={config.profiles}
              activeProfile={surface==='machine'?machines.find(m=>m.target.id===machineId)?.device.deviceId:current?.profile.id}
              online={[...tabs.filter((tab) => !tab.closed && !tab.local).map((tab) => tab.profile.id),...machines.map(m=>m.device.deviceId)]}
              onOpen={(p) => openConnection(p || 'new')}
              onConnect={openSaved}
              onVisual={profile => openSaved(profile, true)}
              onSave={saveProfile}
              onMove={async (id, group, before) => { await window.cshell.moveProfile!(id, group, before); await refresh(); }}
              onManageGroup={async (action) => {
                await window.cshell.manageGroup(action);
                await refresh();
              }}
              onDelete={setConfirmDelete}
            />
          </div>
        )}
        <main
          className={'main-area' + (surface === 'machine' || surface === 'terminal' && linuxModes[active] ? ' visual-desktop-workspace' : '')}
          data-panel="terminal"
          style={{ order: layout.order.indexOf('terminal') }}
        >
          <div className="tabbar" title="连接标签栏 · 移到顶部显示">
            {minimal && (
              <button
                className="icon minimal-pin"
                aria-pressed={pinned}
                title={
                  config.preferences.locale === 'zh-CN'
                    ? pinned
                      ? '取消置顶'
                      : '窗口置顶'
                    : pinned
                      ? 'Unpin window'
                      : 'Keep window on top'
                }
                aria-label={
                  config.preferences.locale === 'zh-CN'
                    ? pinned
                      ? '取消置顶'
                      : '窗口置顶'
                    : pinned
                      ? 'Unpin window'
                      : 'Keep window on top'
                }
                onClick={() => setPinned((value) => !value)}
              >
                {pinned ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
            )}
            <button
              className="icon minimal-toggle"
              aria-pressed={minimal}
              title={minimal ? '还原工作台 / Restore workbench' : '极简模式 / Minimal mode'}
              aria-label={minimal ? '还原工作台 / Restore workbench' : '极简模式 / Minimal mode'}
              onClick={() => {
                setMinimal(!minimal);
                if (!minimal) {
                  setSurface('terminal');
                  setPalette(false);
                }
              }}
            >
              {minimal ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
            </button>
            <div className="tabbar-controls">
              <DockGrip
                panel="terminal"
                label={t('workspace')}
                layout={layout}
                onChange={onLayout}
              />
              <button
                className="icon panel-toggle"
                title={`${t('sidebar')} (Ctrl+Shift+B)`}
                onClick={() => togglePanel('serverVisible')}
              >
                <PanelLeft size={17} />
              </button>
            </div>
            <TabStrip>
              <div className={`tab welcome-tab ${surface === 'home' ? 'active' : ''}`} onClick={() => setSurface('home')}><button onClick={() => setSurface('home')}><LayoutDashboard size={15}/>{t('workspace')}</button></div>
              {machines.map(m=><div key={m.target.id} className={'tab '+(surface==='machine'&&machineId===m.target.id?'active':'')} onClick={()=>{setMachineId(m.target.id);setSurface('machine');}}><button onClick={()=>{setMachineId(m.target.id);setSurface('machine');}}>{m.target.name}</button><button className="icon" title="关闭机器工作区及其会话" aria-label={'关闭 '+m.target.name} onClick={e=>{e.stopPropagation();void closeMachine(m.target.id).catch(onError);}}>×</button></div>)}

              {tabs.length ? (
                tabs.map((tab) => (
                  <SessionTab
                    key={tab.id}
                    {...tab}
                    active={surface === 'terminal' && active === tab.id}
                    onSelect={() => {
                      setActive(tab.id);
                      setSurface('terminal');
                    }}
                    onFloat={() => {
                      void terminalSnapshot(tab.id)
                        .then((snapshot) => window.cshell.openFloating(tab.id, snapshot))
                        .catch(onError);
                    }}
                    onClose={() => (tab.closed ? run(closeTab(tab)) : setConfirmClose(tab))}
                    onMove={(source, target) =>
                      setTabs((items) => {
                        const next = [...items],
                          from = next.findIndex((item) => item.id === source),
                          to = next.findIndex((item) => item.id === target);
                        if (from < 0 || to < 0 || from === to) return items;
                        next.splice(to, 0, next.splice(from, 1)[0]);
                        return next;
                      })
                    }
                  />
                ))
              ) : null}

              {wslSetupTarget && (
                <div
                  className={`tab ${surface === 'wsl' ? 'active' : ''}`}
                  onClick={() => setSurface('wsl')}
                >
                  <button onClick={() => setSurface('wsl')}>设置 {wslSetupTarget}</button>
                  <button
                    className="icon"
                    title="关闭 Linux 设置"
                    aria-label="关闭 Linux 设置"
                    disabled={wslBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeWslSetup();
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {quickConnections.map((profile) => (
                <div
                  key={`quick-${profile.id}`}
                  className={`tab ${surface === 'quick' && quickId === profile.id ? 'active' : ''}`}
                  onClick={() => {
                    setQuickId(profile.id);
                    setSurface('quick');
                  }}
                >
                  <button
                    onClick={() => {
                      setQuickId(profile.id);
                      setSurface('quick');
                    }}
                  >
                    {profile.name}
                  </button>
                  <button
                    className="icon"
                    title={t('close')}
                    aria-label={`${t('close')} ${profile.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setQuickConnections((items) =>
                        items.filter((item) => item.id !== profile.id),
                      );
                      if (quickId === profile.id) setSurface('terminal');
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {drafts.map((draft) => (
                <div
                  key={draft === 'new' ? 'new' : draft.id}
                  className={`tab ${surface === 'connection' && form === draft ? 'active' : ''}`}
                  onClick={() => {
                    setForm(draft);
                    setSurface('connection');
                  }}
                >
                  <button
                    onClick={() => {
                      setForm(draft);
                      setSurface('connection');
                    }}
                  >
                    {draft === 'new' ? t('newServer') : draft.name}
                  </button>
                  <button
                    className="icon"
                    aria-label={t('closeEditor')}
                    title={t('closeEditor')}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeEditor(draft);
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {viewsOpen && <div className={`tab ${surface === 'views' ? 'active' : ''}`}><button onClick={() => setSurface('views')}>视图</button><button className="icon" aria-label="关闭视图设置" onClick={() => { setViewsOpen(false); if (surface === 'views') setSurface('terminal'); }}><X size={13}/></button></div>}
              {extensions && (
                <div
                  className={`tab ${surface === 'extensions' ? 'active' : ''}`}
                  onClick={openExtensions}
                >
                  <button onClick={openExtensions}>
                    <Blocks size={14} />
                    <span>{config.preferences.locale === 'zh-CN' ? '扩展' : 'Extensions'}</span>
                  </button>
                  <button
                    className="icon"
                    aria-label={
                      config.preferences.locale === 'zh-CN' ? '关闭扩展' : 'Close extensions'
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setExtensions(false);
                      if (surface === 'extensions') setSurface('terminal');
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {activityOpen && (
                <div
                  className={`tab ${surface === 'activity' ? 'active' : ''}`}
                  onClick={() => setSurface('activity')}
                >
                  <button onClick={() => setSurface('activity')}>
                    <BarChart3 size={14} />
                    {config.preferences.locale === 'zh-CN' ? '统计与历史' : 'Activity & history'}
                  </button>
                  <button
                    className="icon"
                    aria-label="关闭统计"
                    title="关闭统计"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActivityOpen(false);
                      if (surface === 'activity') setSurface('terminal');
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {settings && (
                <div
                  className={`tab ${surface === 'settings' ? 'active' : ''}`}
                  onClick={() => setSurface('settings')}
                >
                  <button onClick={() => setSurface('settings')}>{t('settings')}</button>
                  <button
                    className="icon"
                    aria-label={t('closeSettings')}
                    title={t('closeSettings')}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeSettings();
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
            </TabStrip>
            {surface === 'terminal' && current && !current.local && !current.client && <button className="icon" title={linuxModes[active] ? '切换到 SSH 终端' : '打开可视化桌面'} aria-label={linuxModes[active] ? '切换到 SSH 终端' : '打开可视化桌面'} onClick={() => {
              setLinuxWorkspaces(v => v.includes(active) ? v : [...v, active]);
              setLinuxModes(v => ({...v, [active]: !v[active]}));
            }}>{linuxModes[active] ? <TerminalIcon size={17}/> : <LayoutDashboard size={17}/>}</button>}
            {navigator.platform.startsWith('Win') && (
              <details
                className="local-terminal-menu"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.open = false;
                }}
              >
                <summary title="新建本机终端" aria-label="新建本机终端">
                  <TerminalIcon size={17} />
                </summary>
                <div role="menu">
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      e.currentTarget.closest('details')!.open = false;
                      run(openLocal('cmd'));
                    }}
                  >
                    CMD
                  </button>
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      e.currentTarget.closest('details')!.open = false;
                      run(openLocal('powershell'));
                    }}
                  >
                    PowerShell
                  </button>
                </div>
              </details>
            )}
            {!left && (
              <button
                className="icon"
                title={t('newServer')}
                aria-label={t('newServer')}
                onClick={() => openConnection('new')}
              >
                <Plus size={18} />
              </button>
            )}
            <button
              hidden={surface !== 'terminal'}
              className="workbench-tool"
              title={t('localFiles')}
              onClick={() => setLocalDock(!localDock)}
            >
              <HardDrive size={15} />
              <span>{t('localFiles')}</span>
            </button>
            <button
              className="workbench-tool ssh-files-toggle"
              hidden={!current || current.closed || !!current.local || !!current.client}
              aria-label={t('files')}
              title={`${t('files')} (Ctrl+Shift+E)`}
              onClick={openFiles}
            >
              <Files size={15} /><span>{t('files')}</span>
            </button>
          </div>
          {wslSetupTarget && (
            <div className="workspace-editor" hidden={surface !== 'wsl'}>
              <WslAccount
                onBusy={setWslBusy}
                key={wslSetupTarget}
                distribution={wslSetupTarget}
                onCancel={closeWslSetup}
                onReady={async () => {
                  const shell: LocalShell = `wsl:${wslSetupTarget}`;
                  setWslSetupTarget(null);
                  await openLocal(shell);
                }}
              />
            </div>
          )}
          {quickConnections.map((profile) => (
            <div
              key={`quick-${profile.id}`}
              className="workspace-editor"
              hidden={surface !== 'quick' || quickId !== profile.id}
            >
              {profile.protocol === 'rdp' ? <RdpMachineWorkspace profile={profile} profiles={config.profiles} onOpen={openSaved}/> : profile.protocol === 'http' ? (
                <HttpWorkbench
                  profile={config.profiles.find((p) => p.id === profile.id) ?? profile}
                  enabled={pluginEnabled(config.plugins, 'http')}
                  onSaveProfile={saveProfile}
                />
              ) : profile.protocol === 'client' ? (
                <SavedAgentConnection profile={profile} onConnect={openMachineDevice} onDone={()=>setQuickConnections(items=>items.filter(item=>item.id!==profile.id))}/>
              ) : (
                <SavedConnection
                  visual={quickVisual[profile.id] ?? config.preferences.defaultConnectionView !== 'original'}
                  profile={profile}
                  saved={config.savedCredentials.includes(profile.id)}
                  persist={config.profiles.some((p) => p.id === profile.id)}
                  onConnect={connect}
                  onDone={() =>
                    setQuickConnections((items) => items.filter((item) => item.id !== profile.id))
                  }
                />
              )}
            </div>
          ))}
          {drafts.map((draft) => (
            <div
              key={draft === 'new' ? 'new' : draft.id}
              className="workspace-editor"
              hidden={surface !== 'connection' || form !== draft}
            >
              {draft === 'new' ? (
                <ConnectionEntry
                  onSaved={refresh}
                  http={
                    pluginEnabled(config.plugins, 'http') ? (
                      <HttpCreate
                        groups={config.groups}
                        onCreated={async (id) => {
                          const latest = await window.cshell.config();
                          setConfig(latest);
                          closeEditor('new');
                          openSaved(latest.profiles.find((p) => p.id === id)!);
                        }}
                      />
                    ) : undefined
                  }
                  onClient={openMachineDevice}
                  onLocal={openLocal}
                  profiles={config.profiles}
                  onConnect={openSaved}
                  targets={localTargets}
                  onTarget={(target) => run(openLocal(target.shell))}
                >
                  <ConnectionForm
                    initialPersist={true}
                    groups={config.groups}
                    saved={false}
                    onClose={() => closeEditor(draft)}
                    onSave={saveProfile}
                    onConnect={connect}
                  />
                </ConnectionEntry>
              ) : draft.protocol === 'rdp' ? (
                <RdpConnectionForm profile={draft} saved={config.savedCredentials.includes(draft.id)} onSaved={refresh} />
              ) : draft.protocol === 'client' ? (
                <ClientProfileEditor
                  profile={draft}
                  onSave={saveProfile}
                  onConnect={openSaved}
                  onClient={openMachineDevice}
                />
              ) : (
                <ConnectionForm
                  profile={draft}
                  initialPassword={importedPasswords.current.get(draft.id)}
                  initialPersist={config.profiles.some((p) => p.id === draft.id)}
                  groups={config.groups}
                  saved={config.savedCredentials.includes(draft.id)}
                  onClose={() => closeEditor(draft)}
                  onSave={saveProfile}
                  onConnect={connect}
                />
              )}
            </div>
          ))}
          {extensionVisited && (
            <div
              className="workspace-editor extension-workspace-slot"
              hidden={surface !== 'extensions'}
            >
              <Suspense fallback={<div className="extension-empty">…</div>}>
                <ExtensionWorkbench
                  onLocal={openLocal}
                  tools={config.tools}
                  visible={surface === 'extensions'}
                  plugins={config.plugins}
                  sessions={tabs
                    .filter((tab) => !tab.local)
                    .map((tab) => ({
                      id: tab.id,
                      label:
                        tab.profile.name === tab.profile.host
                          ? tab.profile.username + '@' + tab.profile.host
                          : tab.profile.name + ' · ' + tab.profile.host,
                      closed: tab.closed,
                    }))}
                  request={pythonRequest}
                  onChange={refresh}
                  onTerminal={(parent, id, name, python) => {
                    const source = tabs.find((t) => t.id === parent);
                    if (!source) return;
                    setTabs((old) => [
                      ...old,
                      {
                        id,
                        profile: { ...source.profile, name },
                        closed: terminalClosed(id),
                        python,
                      },
                    ]);
                    setActive(id);
                    setSurface('terminal');
                  }}
                />
              </Suspense>
            </div>
          )}
          {activityOpen && (
            <div className="workspace-editor" hidden={surface !== 'activity'}>
              <ActivityPage active={surface === 'activity'} servers={config.profiles.length} />
            </div>
          )}
          {settings && (
            <div className="workspace-editor" hidden={surface !== 'settings'}>
              <Settings
                themeRequest={themeRequest}
                value={config.preferences}
                onPreview={setPreview}
                layout={preferences.layout}
                onSave={savePreferences}
                onClose={closeSettings}
              />
            </div>
          )}
          {viewsOpen && <div className="workspace-editor" hidden={surface !== 'views'}><MonitorViews config={config}/></div>}{machines.map(m=><div key={m.target.id} className="workspace-editor" hidden={surface!=='machine'||machineId!==m.target.id}><AgentMachineWorkspace onDisconnect={()=>closeMachine(m.target.id)} device={m.device} target={m.target} preferences={preferences} onSessionCount={(count,ids)=>{setMachineSessionCounts(v=>v[m.target.id]===count?v:{...v,[m.target.id]:count});setMachineSessionIds(v=>JSON.stringify(v[m.target.id])===JSON.stringify(ids)?v:{...v,[m.target.id]:ids});}} active={surface==='machine'&&machineId===m.target.id}/></div>)}
          <div className="workspace-editor" hidden={surface !== 'home' && !(surface === 'terminal' && !tabs.length)}>
            <WorkbenchHome config={config} active={surface === 'home' || (surface === 'terminal' && !tabs.length)} currentCount={currentSsh.length + currentDevices.length}
              onNew={() => openConnection('new')} onViews={() => { setViewsOpen(true); setSurface('views'); }} onConnect={openSaved} onCurrent={openCurrentView}/>
          </div>
          {surface === 'terminal' && current?.closed && !linuxModes[current.id] && (
            <div className="disconnected-session-bar" role="status">
              <span>
                <strong>{t('disconnected')}</strong>
                {' · '}
                {terminalCloseReason(current.id)
                  ? connectionErrorMessage(
                      terminalCloseReason(current.id),
                      config.preferences.locale,
                    )
                  : t('remoteSessionEnded')}
                <small>{t('reconnectHint')}</small>
              </span>
              <button
                onClick={() =>
                  current.client
                    ? run(
                        window.cshell
                          .clientConnect(
                            current.client.device.deviceId,
                            current.client.shell,
                            current.client.distribution,
                          )
                          .then((result) =>
                            addClient(
                              result,
                              current.client!.device,
                              current.client!.shell,
                              current.client!.distribution,
                            ),
                          ),
                      )
                    : current.local
                      ? run(openLocal(current.local))
                      : openSaved(current.profile)
                }
              >
                {t('reconnect')}
              </button>
            </div>
          )}

          {tabs.filter(tab=>linuxWorkspaces.includes(tab.id)).map(tab=><LinuxWorkspace key={tab.id} session={tab.id} profileId={tab.profile.id} preferences={preferences} name={tab.profile.name} active={surface==='terminal'&&active===tab.id&&!!linuxModes[tab.id]} closed={!!tab.closed} onRetry={()=>openSaved(tab.profile)} onTerminal={()=>{}} files={visible=><div inert={!!tab.closed} style={{height:"100%"}}><ToolsPanel sessionId={tab.id} sessionName={tab.profile.name} active={visible} dockerEnabled={pluginEnabled(config.plugins,'docker')} transfers={transfers.filter(t=>t.sessionId===tab.id)} onError={onError}/></div>} terminal={(visible)=><TerminalSlot id={tab.id} active={visible}/>}/>)}
          <AiExecution enabled={preferences.showAiExecution && !minimal} sessionId={current?.id} />
          {tabs.length ? (
            <div className="terminals" hidden={surface !== 'terminal'||!!linuxModes[active]}>
              {tabs.map((tab) => (
                <SharedTerminalMount key={tab.id} id={tab.id} visual={!!linuxModes[tab.id]} active={surface === 'terminal' && active === tab.id}>{visible => <TerminalPane
                  id={tab.id}
                  active={visible}
                  pythonInterpreter={tab.python}
                  textEditingSupported={!tab.local && !tab.client}
                  plugins={tab.local || tab.client ? [] : config.plugins}
                  suggestionsEnabled={
                    !tab.local &&
                    !tab.client &&
                    (pluginEnabled(config.plugins, 'commands') ||
                      pluginEnabled(config.plugins, 'snippets') ||
                      pluginEnabled(config.plugins, 'python'))
                  }
                  preferences={preferences}
                  closed={tab.closed}
                  searching={surface === 'terminal' && searching && active === tab.id}
                  onSearchClose={() => setSearching(false)}
                  onError={onError}
                />}</SharedTerminalMount>
              ))}
            </div>
          ) : null}

          {localDock && surface === 'terminal' && !minimal && (
            <LocalDock
              sessionId={current?.local || current?.client ? undefined : current?.id}
              transfers={transfers}
              onError={onError}
              onClose={() => setLocalDock(false)}
            />
          )}
        </main>
        {tabs.some((tab) => !tab.closed) && (
          <div
            className="dock-side"
            hidden={!showTools}
            data-panel="files"
            style={{ order: layout.order.indexOf('files'), width: layout.fileWidth }}
          >
            <PanelResizer
              panel="files"
              width={layout.fileWidth}
              reverse={layout.order.indexOf('files') > layout.order.indexOf('terminal')}
              onChange={(fileWidth) => onLayout({ ...layout, fileWidth })}
            />
            {tabs
              .filter((tab) => !tab.closed && !tab.client && !tab.local)
              .map((tab) => (
                <div
                  className="session-tools"
                  key={tab.id}
                  hidden={!showTools || current?.id !== tab.id}
                >
                  <ToolsPanel
                    revealRevision={fileReveal.id === tab.id ? fileReveal.revision : 0}
                    onClose={() => onLayout({...layout, fileVisible: false})}
                    dockerEnabled={pluginEnabled(config.plugins, 'docker')}
                    active={showTools && current?.id === tab.id}
                    sessionName={`${tab.profile.username}@${tab.profile.host}`}
                    dragHandle={
                      <DockGrip
                        panel="files"
                        label={t('files')}
                        layout={layout}
                        onChange={onLayout}
                      />
                    }
                    sessionId={tab.id}
                    transfers={transfers.filter((transfer) => transfer.sessionId === tab.id)}
                    onError={onError}
                  />
                </div>
              ))}
          </div>
        )}
        <div
          className="ai-panel-slot"
          hidden={!aiVisible || minimal}
          style={{ width: layout.agentWidth }}
        >
          <PanelResizer
            panel="agent"
            width={layout.agentWidth}
            reverse={true}
            onChange={(agentWidth) => onLayout({ ...layout, agentWidth })}
          />
          <AiPanel
            executionVisible={preferences.showAiExecution}
            onExecutionVisible={(showAiExecution) =>
              savePreferences({ ...config.preferences, showAiExecution })
            }
            visible={aiVisible && !minimal}
            sessionId={surface==='terminal' && current && !current.closed ? current.id : undefined}
            profiles={config.profiles}
            groups={config.groups}
            onClose={() => setAiVisible(false)}
          />
        </div>
      </div>
      <footer className="statusbar">
        <div>
          <ShieldCheck size={13} />
          <span>
            {surface==='machine'?'CAgent · '+(machines.find(m=>m.target.id===machineId)?.target.name??''):current
              ? current.closed
                ? t('disconnected')
                : current.local
                  ? `本机 · ${current.profile.name}`
                  : `${current.client ? 'Client' : 'SSH'} · ${current.profile.host}:${current.profile.port}`
              : t('ready')}
          </span>
        </div>
        <div>
          <span>
            {tabs.filter((x) => !x.closed).length+Object.values(machineSessionCounts).reduce((a,b)=>a+b,0)} {t('sessionCount')}
          </span>

          <button
            className="theme-toggle"
            aria-label={t(preferences.theme === 'light' ? 'switchToDark' : 'switchToLight')}
            title={t(preferences.theme === 'light' ? 'switchToDark' : 'switchToLight')}
            onClick={() => {
              const theme = preferences.theme === 'light' ? 'dark' : 'light';
              setThemeRequest({ theme });
              run(savePreferences({ ...config.preferences, theme }));
            }}
          >
            {preferences.theme === 'light' ? (
              <Moon size={13} aria-hidden="true" />
            ) : (
              <Sun size={13} aria-hidden="true" />
            )}
            <span>{t(preferences.theme)}</span>
          </button>
          <LanguageMenu
            locale={config.preferences.locale}
            onSelect={(locale) => run(savePreferences({ ...config.preferences, locale }))}
          />
        </div>
      </footer>
      <ClipboardConnection
        onImport={({ fields }) => {
          const id = crypto.randomUUID();
          if (fields.password) importedPasswords.current.set(id, fields.password);
          openConnection({
            id,
            protocol: 'ssh',
            name: fields.name || fields.host!,
            host: fields.host!,
            port: fields.port ?? 22,
            username: fields.username ?? '',
            group: fields.group ?? '',
            auth: fields.auth ?? 'password',
            favorite: false,
          });
          setMinimal(false);
        }}
      />
      {error && (
        <div className="toast" role="alert">
          <div>
            <strong>{t('error')}</strong>
            <p>{error}</p>
          </div>
          <button className="icon" aria-label={t('dismiss')} onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {confirmDelete && (
        <Modal title={t('deleteTitle')} onClose={() => setConfirmDelete(null)}>
          <p>{t('deleteServer')}</p>
          <p className="muted">{confirmDelete.name}</p>
          <footer>
            <button onClick={() => setConfirmDelete(null)}>{t('cancel')}</button>
            <button
              className="danger"
              onClick={() =>
                run(
                  window.cshell
                    .deleteProfile(confirmDelete.id)
                    .then(refresh)
                    .then(() => setConfirmDelete(null)),
                )
              }
            >
              {t('delete')}
            </button>
          </footer>
        </Modal>
      )}
      <TextAssist />
      {confirmClose && (
        <Modal title={t('closeSession')} onClose={() => setConfirmClose(null)}>
          <p>{t('closeSessionBody')}</p>
          <footer>
            <button onClick={() => setConfirmClose(null)}>{t('cancel')}</button>
            <button className="primary" onClick={() => run(closeTab(confirmClose))}>
              {t('confirm')}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

