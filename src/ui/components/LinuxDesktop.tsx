import {IdeApp} from './IdeApp';
import {agentRead} from '../agent-read';
import {CodingApp} from './CodingApp';
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  Monitor,
  Terminal,
  Folder,
  Globe,
  Package,
  Settings,
  Minus,
  Maximize2,
  Minimize2,
  X,
  Grid2X2,
  Sun,
  Moon,
  Upload,
  Download,
  Check,
  RefreshCw,
} from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
import type { Preferences } from '../../shared/contracts';
import { AgentMachineFiles } from './AgentMachineFiles';
import { AgentApplications } from './AgentApplications';
import { NativeApplications } from './NativeApplications';
import { MachineBrowser } from './MachineBrowser';
import { TerminalPane } from './TerminalPane';
import './linux-desktop.css';

const apps = [
  { id: 'ide', label: '代码编辑器', icon: Terminal, color: 'blue' },
  { id: 'codex', label: 'Codex', icon: Terminal, color: 'green' },
  { id: 'claude', label: 'Claude Code', icon: Terminal, color: 'amber' },
  { id: 'browser', label: '浏览器', icon: Globe, color: 'blue' },
  { id: 'native', label: '应用', icon: Folder, color: 'slate' },
  { id: 'files', label: '文件', icon: Folder, color: 'amber' },
  { id: 'terminal', label: '终端', icon: Terminal, color: 'violet' },
  { id: 'applications', label: '应用市场', icon: Package, color: 'green' },
  { id: 'settings', label: '设置', icon: Settings, color: 'slate' },
];
const wallpapers = {
  coast:
    'radial-gradient(ellipse at 85% 10%, #b2e9de 0%, transparent 52%), radial-gradient(ellipse at 30% 110%, #4e6eb2 0%, transparent 60%), linear-gradient(135deg,#102d4d,#366b89 52%,#85c6c0)',
  dusk: 'radial-gradient(ellipse at 75% 15%,#efbc9c,transparent 52%),radial-gradient(ellipse at 15% 90%,#4a3e79,transparent 65%),linear-gradient(140deg,#292e53,#9a6f91)',
  forest:
    'radial-gradient(ellipse at 85% 15%,#b9d5a5,transparent 55%),radial-gradient(ellipse at 0% 100%,#123f43,transparent 70%),linear-gradient(130deg,#173d3c,#6c9b81)',
  ink: 'radial-gradient(ellipse at 80% 10%,#515d79,transparent 65%),linear-gradient(145deg,#121c30,#293c57)',
};
type Look = {
  name: string;
  theme: 'light' | 'dark';
  wallpaper: keyof typeof wallpapers;
  image?: string;
};
const initialLook: Look = { name: '海岸', theme: 'light', wallpaper: 'coast' };
function validLook(value: unknown): Look {
  const v = value as Look;
  if (
    !v ||
    typeof v.name !== 'string' ||
    v.name.length > 50 ||
    !['light', 'dark'].includes(v.theme) ||
    !Object.hasOwn(wallpapers, v.wallpaper) ||
    (v.image !== undefined &&
      (typeof v.image !== 'string' ||
        v.image.length > 4_000_000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.image)))
  )
    throw Error('请选择有效的桌面外观方案');
  return {
    name: v.name,
    theme: v.theme,
    wallpaper: v.wallpaper,
    ...(v.image ? { image: v.image } : {}),
  };
}
type WindowState = {
  id: string;
  minimized: boolean;
  closed: boolean;
  maximized: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};
export function initialWindowBounds(id: string, size: {w:number;h:number}) {
  const wide = ['browser', 'remote', 'applications', 'codex', 'claude'].includes(id);
  const w = Math.max(1, Math.min(wide ? 1120 : 880, size.w - 40, size.w * (wide ? .92 : .84)));
  const h = Math.max(1, Math.min(wide ? 780 : 640, size.h - 40, size.h * .88));
  return {x: (size.w-w)/2, y: (size.h-h)/2, w, h};
}
export function LinuxDesktop({
  name,
  machine,
  target,
  call,
  active,
  closed = false,
  onTerminal,
  terminal,
  extraPanels = [],
}: {
  name: string;
  machine: any;
  target: string;
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
  extraPanels?: { id: string; label: string; content: ReactNode | ((active: boolean, options: boolean, closeOptions: () => void) => ReactNode); icon?: typeof Monitor }[];
  active: boolean;
  closed?: boolean;
  onTerminal?: () => void;
  terminal?: (active: boolean, theme: 'light' | 'dark') => ReactNode;
}) {
  const [installed,setInstalled]=useState<string[]>([]);
  const refreshInstalled=useCallback(async()=>{
    const [c,i]=await Promise.allSettled([agentRead(()=>call('coding.status')),agentRead(()=>call('ide.status'))]);
    const ids:string[]=[];
    if(c.status==='fulfilled')for(const engine of (c.value as any)?.engines??[])if(engine.ready)ids.push(engine.engine);
    if(i.status==='fulfilled'&&(i.value as any)?.ready&&(i.value as any)?.supported)ids.push('ide');
    setInstalled(ids);
  },[call]);
  useEffect(()=>{void refreshInstalled();},[refreshInstalled]);
  const catalog = [
    ...apps.filter(app => ['codex','claude','ide'].includes(app.id)?installed.includes(app.id):machine.terminalOnly ? app.id === 'terminal' : machine.platform === 'android' ? app.id === 'settings' : app.id === 'browser' ? ['linux','win32','darwin'].includes(machine.platform) : app.id !== 'native' || machine.platform === 'linux'),
    ...extraPanels.map((p) => ({ id: p.id, label: p.label, icon: p.icon ?? Settings, color: 'slate' })),
  ];
  const [context, setContext] = useState<{id:string;x:number;y:number}>();
  const [options, setOptions] = useState('');
  const contextMenu = useRef<HTMLDivElement>(null);
  const contextSource = useRef<HTMLElement | null>(null);
  const showContext = (e: MouseEvent<HTMLElement>, id: string) => {
    e.preventDefault(); e.stopPropagation(); setMenu(false);
    contextSource.current = e.currentTarget;
    const host = e.currentTarget.closest('.linux-desktop')!.getBoundingClientRect();
    const source = e.currentTarget.getBoundingClientRect();
    setContext({id,x:Math.max(4,Math.min((e.clientX || source.left+20)-host.left,host.width-220)),y:Math.max(4,Math.min((e.clientY || source.top+20)-host.top,host.height-270))});
  };
  const dismissContext = () => {setContext(undefined);contextSource.current?.focus();};
  useEffect(()=>{if(context)contextMenu.current?.querySelector<HTMLButtonElement>('button')?.focus();},[context]);
  const key = 'cshell-linux-desktop:' + machine.deviceId;
  const [look, setLook] = useState<Look>(() => {
    try {
      return validLook(JSON.parse(localStorage.getItem(key) || 'null'));
    } catch {
      return initialLook;
    }
  });
  const [windows, setWindows] = useState<WindowState[]>(()=>{try{const saved=JSON.parse(localStorage.getItem(key+':windows')||'[]');return Array.isArray(saved)?saved.filter(w=>(apps.some(a=>a.id===w.id)||extraPanels.some(a=>a.id===w.id))&&['x','y','w','h','z'].every(k=>Number.isFinite(w[k]))&&w.w>0&&w.h>0).slice(0,16).map((w,i)=>({...w,minimized:!!w.minimized,closed:!!w.closed,maximized:!!w.maximized,z:i+1})):[];}catch{return [];}}),
    [menu, setMenu] = useState(false),
    [settingsTab, setSettingsTab] = useState('appearance'),
    [error, setError] = useState(''),
    [clock, setClock] = useState(new Date()),
    [size, setSize] = useState({ w: 1000, h: 650 }),
    [device, setDevice] = useState(machine);
  const [selectedIcons, setSelectedIcons] = useState<string[]>([]),
    [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number }>();
  const selectionStart = useRef<{ x: number; y: number; previous: string[] } | null>(null);
  const canvas = useRef<HTMLDivElement>(null),
    sequence = useRef(20);
  const gesture = useRef<
    { id: string; mode: 'move' | 'resize'; x: number; y: number; window: WindowState } | undefined
  >(undefined);
  useEffect(()=>{try{localStorage.setItem(key+':windows',JSON.stringify(windows));}catch{setError('窗口状态未能保存，请检查本机存储空间');}},[key,windows]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(look));
    } catch {
      setError('外观未能保存，请使用较小的背景图片');
    }
  }, [key, look]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height)
        setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  const focus = (id: string) =>
    setWindows((v) =>
      v.map((w) =>
        w.id === id ? { ...w, z: ++sequence.current, minimized: false, closed: false } : w,
      ),
    );
  const open = (id: string) => {
    setMenu(false);
    setWindows((v) =>
      v.some((w) => w.id === id)
        ? v.map((w) =>
            w.id === id ? { ...w, minimized: false, closed: false, z: ++sequence.current } : w,
          )
        : [
            ...v,
            {
              id,
              minimized: false,
              closed: false,
              maximized: false,
              ...initialWindowBounds(id, size),
              z: ++sequence.current,
            },
          ],
    );
  };
  const patch = (id: string, change: Partial<WindowState>) =>
    setWindows((v) => v.map((w) => (w.id === id ? { ...w, ...change } : w)));
  const front = windows.filter((w) => !w.minimized && !w.closed && catalog.some(a=>a.id===w.id)).sort((a, b) => b.z - a.z)[0]?.id;
  const bounds = (w: WindowState) => {
    const margin = Math.min(16,size.w/4,size.h/4);
    const width = Math.min(w.w, Math.max(1,size.w-margin*2)),
      height = Math.min(w.h, Math.max(1,size.h-margin*2));
    return {
      left: Math.max(margin, Math.min(w.x, size.w - width-margin)),
      top: Math.max(margin, Math.min(w.y, size.h - height-margin)),
      width,
      height,
    };
  };
  const upload = async (file?: File, scheme = false) => {
    if (!file) return;
    try {
      if (file.size > 3_000_000) throw Error('请选择小于 3 MB 的文件');
      if (scheme) setLook(validLook(JSON.parse(await file.text())));
      else {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw Error('背景支持 PNG、JPEG 和 WebP');
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        setLook((v) => validLook({ ...v, image: data }));
      }
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section
      className="linux-desktop"
      data-theme={look.theme}
      onPointerDownCapture={e=>{if(context&&!(e.target as HTMLElement).closest('.desktop-context-menu'))setContext(undefined);}}
      onContextMenu={e=>{if(!(e.target as HTMLElement).closest('.desktop-window,button'))showContext(e,'desktop');}}
      aria-label="机器桌面"
      style={{ backgroundImage: look.image ? `url("${look.image}")` : wallpapers[look.wallpaper] }}
    >
      <div
        className="desktop-canvas"
        ref={canvas}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('.desktop-window,button')) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left,
            y = e.clientY - r.top;
          selectionStart.current = { x, y, previous: e.ctrlKey ? selectedIcons : [] };
          if (!e.ctrlKey) setSelectedIcons([]);
          setSelection({ x, y, w: 0, h: 0 });
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = selectionStart.current;
          if (start) {
            const r = e.currentTarget.getBoundingClientRect(),
              endX = Math.max(0, Math.min(r.width, e.clientX - r.left)),
              endY = Math.max(0, Math.min(r.height, e.clientY - r.top));
            const box = {
              x: Math.min(start.x, endX),
              y: Math.min(start.y, endY),
              w: Math.abs(endX - start.x),
              h: Math.abs(endY - start.y),
            };
            setSelection(box);
            const ids = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>('[data-desktop-icon]'),
            )
              .filter((el) => {
                const b = el.getBoundingClientRect();
                return (
                  b.right - r.left >= box.x &&
                  b.left - r.left <= box.x + box.w &&
                  b.bottom - r.top >= box.y &&
                  b.top - r.top <= box.y + box.h
                );
              })
              .map((el) => el.dataset.desktopIcon!);
            setSelectedIcons([...new Set([...start.previous, ...ids])]);
            return;
          }
          const g = gesture.current;
          if (!g) return;
          const dx = e.clientX - g.x,
            dy = e.clientY - g.y;
          patch(
            g.id,
            g.mode === 'move'
              ? {
                  x: Math.max(0, Math.min(g.window.x + dx, size.w - Math.min(g.window.w, size.w))),
                  y: Math.max(0, Math.min(g.window.y + dy, size.h - Math.min(g.window.h, size.h))),
                }
              : {
                  w: Math.max(
                    Math.min(420, size.w),
                    Math.min(g.window.w + dx, size.w - g.window.x),
                  ),
                  h: Math.max(
                    Math.min(280, size.h),
                    Math.min(g.window.h + dy, size.h - g.window.y),
                  ),
                },
          );
        }}
        onPointerUp={() => {
          gesture.current = undefined;
          selectionStart.current = null;
          setSelection(undefined);
        }}
        onPointerCancel={() => {
          gesture.current = undefined;
          selectionStart.current = null;
          setSelection(undefined);
        }}
      >
        <div className="desktop-icons" aria-label="桌面应用">
          {catalog.map((a) => (
            <button
              key={a.id}
              data-desktop-icon={a.id}
              onContextMenu={e=>showContext(e,a.id)}
              aria-pressed={selectedIcons.includes(a.id)}
              onClick={(e) =>
                setSelectedIcons(
                  e.ctrlKey
                    ? selectedIcons.includes(a.id)
                      ? selectedIcons.filter((id) => id !== a.id)
                      : [...selectedIcons, a.id]
                    : [a.id],
                )
              }
              onDoubleClick={() => open(a.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  open(a.id);
                }
              }}
              title={'双击打开' + a.label}
            >
              <span className={'desktop-app-icon ' + a.color}>
                <a.icon size={27} />
              </span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
        {selection && (
          <div
            className="desktop-selection"
            style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
          />
        )}
        <div className="desktop-watermark">
          <span>{name}</span>
          <small>{machine.platform === 'win32' ? 'Windows' : machine.platform === 'linux' ? 'Linux' : machine.platform === 'android' ? 'Android' : '设备'} · cagent</small>
        </div>
        {windows.map((w) => {
          const app = catalog.find((a) => a.id === w.id);
          if(!app)return null;
          const visible = !w.minimized && !w.closed;
          return (
            <section
              key={w.id}
              role="region"
              aria-label={app.label + '窗口'}
              className={
                'desktop-window ' +
                (w.maximized ? 'maximized ' : '') +
                (front === w.id ? 'focused' : '')
              }
              hidden={!visible}
              style={{ ...(w.maximized ? {} : bounds(w)), zIndex: w.z }}
              onPointerDownCapture={() => {
                if (front !== w.id) focus(w.id);
              }}
            >
              <header
                className="desktop-titlebar"
                onDoubleClick={() => patch(w.id, { maximized: !w.maximized })}
                onPointerDown={(e) => {
                  if (e.button !== 0 || w.maximized || (e.target as HTMLElement).closest('button'))
                    return;
                  const b = bounds(w);
                  gesture.current = {
                    id: w.id,
                    mode: 'move',
                    x: e.clientX,
                    y: e.clientY,
                    window: { ...w, x: b.left, y: b.top, w: b.width, h: b.height },
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.preventDefault();
                }}
              >
                <app.icon size={15} />
                <span>{app.label}</span>
                <div className="desktop-window-controls">
                  <button
                    title="最小化"
                    aria-label={'最小化' + app.label}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={() => patch(w.id, { minimized: true })}
                  >
                    <Minus size={15} />
                  </button>
                  <button
                    title={w.maximized ? '还原' : '最大化'}
                    aria-label={(w.maximized ? '还原' : '最大化') + app.label}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={() => patch(w.id, { maximized: !w.maximized })}
                  >
                    {w.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                  <button
                    title="收起窗口，保留会话"
                    aria-label={'关闭' + app.label + '窗口'}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={() => patch(w.id, { closed: true })}
                  >
                    <X size={16} />
                  </button>
                </div>
              </header>
              <div
                className={
                  'desktop-window-content ' +
                  (w.id === 'browser' || w.id === 'native' || w.id === 'terminal' || w.id === 'remote' || w.id === 'assistant' || w.id === 'ide' ? 'no-scroll' : '')
                }
              >
                {w.id==='ide'&&!closed&&<IdeApp call={call} target={target} active={active&&visible&&front===w.id&&!menu&&!context}/>}
                {['codex','claude'].includes(w.id)&&!closed&&<CodingApp onManage={()=>open('applications')} engine={w.id as 'codex'|'claude'} name={name} call={call} active={active&&visible&&front===w.id} openBrowser={async url=>{const session=target.startsWith('ssh:')?target.slice(4):target;await window.cshell.machineBrowser(session,'new');await window.cshell.machineBrowser(session,'navigate',url);open('browser');}}/>}
                {w.id === 'browser' && !closed && <MachineBrowser target={target} name={name} active={active && visible && front === w.id && !menu && !context} />}
                {w.id === 'native' && !closed && (
                  <NativeApplications
                    storageKey={key+':native'}
                    call={call}
                    active={active && visible && front === w.id && !context}
                    optionsOpen={options === w.id}
                    onCloseOptions={()=>setOptions('')}
                    onMarket={() => open('applications')}
                    onMinimize={() => patch(w.id, { minimized: true })}
                  />
                )}
                {w.id === 'files' && <AgentMachineFiles target={target} call={call} />}
                {w.id === 'applications' && (
                  <AgentApplications
                    onDevelopmentOpen={id=>{void refreshInstalled().then(()=>open(id))}}
                    onDevelopmentChanged={()=>void refreshInstalled()}
                    target={{ id: target, name, local: false, available: !closed }}
                    call={call}
                  />
                )}
                {w.id === 'terminal' &&
                  (terminal ? (
                    terminal(active && visible && front === w.id && !closed, look.theme)
                  ) : (
                    <button onClick={onTerminal}>打开 SSH 终端</button>
                  ))}
                {extraPanels.filter(p => p.id === w.id).map(p => <div className={'desktop-extra-panel desktop-extra-' + p.id} key={p.id}>{typeof p.content === 'function' ? p.content(active && visible && front === w.id && !menu && !context && !closed, options === w.id, () => setOptions('')) : p.content}</div>)}
                {w.id === 'settings' && (
                  <div className="desktop-settings">
                    <nav aria-label="桌面设置分类">
                      {[
                        ['appearance', '个性化'],
                        ['display', '显示与操作'],
                        ['system', '系统信息'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          aria-pressed={settingsTab === id}
                          onClick={() => setSettingsTab(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </nav>
                    <div className="desktop-settings-content">
                      {settingsTab === 'appearance' && (
                        <>
                          <h2>个性化</h2>
                          <p>让这台机器的桌面成为你的工作空间。</p>
                          <h3>桌面背景</h3>
                          <div className="desktop-wallpapers">
                            {Object.entries(wallpapers).map(([id, background]) => (
                              <button
                                key={id}
                                style={{ backgroundImage: background }}
                                aria-label={'背景 ' + id}
                                aria-pressed={!look.image && look.wallpaper === id}
                                onClick={() =>
                                  setLook((v) => ({
                                    ...v,
                                    wallpaper: id as Look['wallpaper'],
                                    image: undefined,
                                  }))
                                }
                              >
                                {!look.image && look.wallpaper === id && <Check size={20} />}
                              </button>
                            ))}
                          </div>
                          <label className="desktop-upload">
                            <Upload size={15} />
                            选择背景图片
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={(e) => void upload(e.target.files?.[0])}
                            />
                          </label>
                          <h3>窗口主题</h3>
                          <div className="desktop-theme-options">
                            <button
                              aria-pressed={look.theme === 'light'}
                              onClick={() => setLook((v) => ({ ...v, theme: 'light' }))}
                            >
                              <Sun size={18} />
                              浅色
                            </button>
                            <button
                              aria-pressed={look.theme === 'dark'}
                              onClick={() => setLook((v) => ({ ...v, theme: 'dark' }))}
                            >
                              <Moon size={18} />
                              深色
                            </button>
                          </div>
                          <h3>外观方案</h3>
                          <label>
                            方案名称
                            <input
                              aria-label="方案名称"
                              maxLength={50}
                              value={look.name}
                              onChange={(e) => setLook((v) => ({ ...v, name: e.target.value }))}
                            />
                          </label>
                          <div className="desktop-theme-options">
                            <button
                              onClick={() => {
                                const url = URL.createObjectURL(
                                  new Blob([JSON.stringify(look, null, 2)], {
                                    type: 'application/json',
                                  }),
                                );
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = (look.name || '桌面') + '.json';
                                a.click();
                                setTimeout(() => URL.revokeObjectURL(url), 1000);
                              }}
                            >
                              <Download size={15} />
                              导出方案
                            </button>
                            <label className="desktop-upload">
                              导入方案
                              <input
                                type="file"
                                accept="application/json,.json"
                                onChange={(e) => void upload(e.target.files?.[0], true)}
                              />
                            </label>
                          </div>
                          <small>自动保存到此设备的桌面；方案只包含外观。</small>
                        </>
                      )}
                      {settingsTab === 'display' && (
                        <>
                          <h2>显示与操作</h2>
                          <dl>
                            <dt>远端画面</dt>
                            <dd>1440 × 900，完整适应窗口</dd>
                            <dt>滚轮</dt>
                            <dd>仅发送到鼠标所在的远端画面</dd>
                            <dt>窗口</dt>
                            <dd>拖动标题栏移动，右下角调整大小，双击标题栏最大化</dd>
                            <dt>会话</dt>
                            <dd>最小化和收起窗口保留运行状态</dd>
                          </dl>
                        </>
                      )}
                      {settingsTab === 'system' && (
                        <>
                          <h2>系统信息</h2>
                          <dl>
                            <dt>机器</dt>
                            <dd>{name}</dd>
                            <dt>操作系统</dt>
                            <dd>{device.platform}</dd>
                            <dt>设备身份</dt>
                            <dd>{device.deviceId}</dd>
                            <dt>连接</dt>
                            <dd>{closed ? '已断开' : '已连接'}</dd>
                          </dl>
                          <button
                            disabled={closed}
                            onClick={() =>
                              void call('client.status')
                                .then(setDevice)
                                .catch((e) => setError(String(e)))
                            }
                          >
                            <RefreshCw size={15} />
                            刷新状态
                          </button>
                          {onTerminal && <button onClick={onTerminal}>进入 SSH 终端</button>}
                        </>
                      )}
                      {error && <p role="alert">{error}</p>}
                    </div>
                  </div>
                )}
              </div>
              {!w.maximized && (
                <button
                  className="desktop-resize"
                  title="调整窗口大小（方向键微调）"
                  aria-label={'调整' + app.label + '窗口大小'}
                  onKeyDown={(e) => {
                    if (e.key.startsWith('Arrow')) {
                      e.preventDefault();
                      patch(w.id, {
                        w: Math.max(
                          300,
                          Math.min(
                            size.w,
                            w.w + (e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0),
                          ),
                        ),
                        h: Math.max(
                          240,
                          Math.min(
                            size.h,
                            w.h + (e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0),
                          ),
                        ),
                      });
                    }
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const b = bounds(w);
                    gesture.current = {
                      id: w.id,
                      mode: 'resize',
                      x: e.clientX,
                      y: e.clientY,
                      window: { ...w, x: b.left, y: b.top, w: b.width, h: b.height },
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                />
              )}
            </section>
          );
        })}
        {closed && (
          <div className="desktop-disconnected" role="status">
            <Monitor size={30} />
            <h2>连接已断开</h2>
            <p>重新连接这台机器后继续工作。</p>
            <button onClick={onTerminal}>返回 SSH</button>
          </div>
        )}
      </div>
      {menu && (
        <div className="desktop-start">
          <strong>{name}</strong>
          <div>
            {catalog.map((a) => (
              <button key={a.id} onClick={() => open(a.id)}>
                <span className={'desktop-app-icon ' + a.color}>
                  <a.icon size={22} />
                </span>
                {a.label}
              </button>
            ))}
          </div>
          {onTerminal && (
            <button onClick={onTerminal}>
              <Terminal size={16} />
              SSH 终端
            </button>
          )}
        </div>
      )}
      <footer className="desktop-taskbar">
        <button
          title="应用"
          aria-label="打开应用菜单"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Grid2X2 size={21} />
        </button>
        <span className="desktop-taskbar-divider" />
        <nav aria-label="运行中的应用">
          {windows
            .filter((w) => !w.closed)
            .map((w) => {
              const a = catalog.find((a) => a.id === w.id);
              if(!a)return null;
              return (
                <button
                  key={w.id}
                  title={a.label}
                  onContextMenu={e=>showContext(e,w.id)}
                  aria-label={'切换到' + a.label}
                  aria-pressed={front === w.id && !w.minimized}
                  onClick={() =>
                    front === w.id && !w.minimized ? patch(w.id, { minimized: true }) : focus(w.id)
                  }
                >
                  <a.icon size={20} />
                  <span>{a.label}</span>
                  <i />
                </button>
              );
            })}
        </nav>
        <span className="desktop-taskbar-spacer" />
        <span className="desktop-machine-name" title={machine.deviceId}>
          <i className={closed ? 'offline' : ''} />
          {name}
        </span>
        <button
          title="切换桌面明暗主题"
          aria-label="切换桌面明暗主题"
          onClick={() => setLook((v) => ({ ...v, theme: v.theme === 'light' ? 'dark' : 'light' }))}
        >
          {look.theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <time>
          {clock.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          <small>{clock.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</small>
        </time>
        <button
          className="desktop-show"
          title="显示桌面"
          aria-label="显示桌面"
          onClick={() => {
            setMenu(false);
            setWindows((v) => v.map((w) => ({ ...w, minimized: true })));
          }}
        >
          <Monitor size={18} />
          <span>桌面</span>
        </button>
      </footer>
      {context&&<div ref={contextMenu} className="desktop-context-menu" role="menu" aria-label="桌面右键菜单" style={{left:context.x,top:context.y}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();dismissContext();}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}}>
        <span>{context.id==='desktop'?'桌面':catalog.find(a=>a.id===context.id)?.label}</span>
        {context.id==='desktop'?<>
          <button role="menuitem" onClick={()=>{open('settings');setSettingsTab('appearance');dismissContext();}}>个性化</button>
          <button role="menuitem" onClick={()=>{open('settings');setSettingsTab('display');dismissContext();}}>显示设置</button>
          <button role="menuitem" onClick={()=>{setWindows(v=>v.map(w=>({...w,minimized:true})));dismissContext();}}>显示桌面</button>
        </>:<>
          <button role="menuitem" onClick={()=>{open(context.id);dismissContext();}}>打开 / 恢复</button>
          {['ide','codex','claude'].includes(context.id)&&<button role="menuitem" onClick={()=>{open('applications');dismissContext();}}>管理应用</button>}
          {['remote','native'].includes(context.id)&&<button role="menuitem" onClick={()=>{open(context.id);setOptions(context.id);dismissContext();}}>应用设置与操作</button>}
          {windows.some(w=>w.id===context.id&&!w.closed)&&<>
            <button role="menuitem" onClick={()=>{patch(context.id,{minimized:true});dismissContext();}}>最小化</button>
            <button role="menuitem" onClick={()=>{patch(context.id,{maximized:!windows.find(w=>w.id===context.id)?.maximized,minimized:false});dismissContext();}}>最大化 / 还原</button>
            <button role="menuitem" onClick={()=>{patch(context.id,{closed:true});dismissContext();}}>收起应用</button>
          </>}
        </>}
      </div>}
    </section>
  );
}

export function LinuxDesktopTerminal({
  profileId,
  preferences,
  active,
}: {
  profileId: string;
  preferences: Preferences;
  active: boolean;
}) {
  const [id, setId] = useState(''),
    [error, setError] = useState(''),
    [closed, setClosed] = useState(false);
  useEffect(() => {
    let alive = true,
      session = '';
    void window.cshell
      .connect(profileId, { remember: true })
      .then((result) => {
        session = result.sessionId;
        if (alive) setId(session);
        else void window.cshell.disconnect(session);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    const unsubscribe = window.cshell.events((e) => {
      if (e.type === 'closed' && e.sessionId === session) setClosed(true);
    });
    return () => {
      alive = false;
      unsubscribe();
      if (session) void window.cshell.disconnect(session).catch(() => {});
    };
  }, [profileId]);
  return (
    <div className="desktop-terminal">
      {error ? (
        <p role="alert">{error}</p>
      ) : id ? (
        <TerminalPane
          id={id}
          active={active}
          preferences={preferences}
          closed={closed}
          suggestionsEnabled={false}
          plugins={[]}
          searching={false}
          onSearchClose={() => {}}
          onError={(e) => setError(String(e))}
        />
      ) : (
        <p role="status">正在连接终端…</p>
      )}
    </div>
  );
}
