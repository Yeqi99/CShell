import {UsageConsent} from './UsageStats';
import { LocalEnvironmentSettings } from './LocalEnvironmentSettings';
import { NetworkSettings } from './NetworkSettings';
import { Search, Globe } from 'lucide-react';
import { Palette, Terminal, PanelsTopLeft, Blocks, ShieldCheck, Download } from 'lucide-react';
import { UpdateSettings } from './UpdateSettings';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { defaults, type Preferences } from '../../shared/contracts';
import { useI18n } from '../i18n';
import { PresetControls } from './PresetControls';
import { McpSettings, useMcpSettings } from './McpSettings';
import { FontPicker } from './FontPicker';
import './category-workspace.css';
import './settings-studio.css';
export function Settings({
  value,
  onSave,
  onClose,
  onPreview,
  layout,
  themeRequest,
}: {
  value: Preferences;
  themeRequest?: { theme: Preferences['theme'] } | null;
  layout: Preferences['layout'];
  onSave: (p: Preferences) => Promise<void>;
  onClose: () => void;
  onPreview: (p: Preferences | null) => void;
}) {
  const { t, locale } = useI18n();
  const cn = locale === 'zh-CN';
  const categories = [
    ['appearance', Palette, cn ? '外观' : 'Appearance'],
    ['terminal', Terminal, cn ? '终端' : 'Terminal'],
    ...(navigator.platform.startsWith('Win')
      ? [['local', Terminal, cn ? '本机终端' : 'Local terminal'] as const]
      : []),
    ['workspace', PanelsTopLeft, cn ? '工作区' : 'Workspace'],
    ...(window.cshell.networkStatus ? [['network', Globe, cn ? '网络与代理' : 'Network & proxy'] as const] : []),
    ['extensions', Blocks, cn ? '扩展' : 'Extensions'],
    ['security', ShieldCheck, cn ? 'AI 与安全' : 'AI & security'],
    ['updates', Download, cn ? '关于与更新' : 'About & updates'],
  ] as const;
  const [query, setQuery] = useState('');
  const categoryHelp: Record<string, [string, string, string]> = {
    cloud: ['账号、同步与本机数据', 'Account, sync and local data', '登录 邮箱 导入 缓存 会员 sync import account'],
    appearance: ['调整界面、字体与背景，修改即时预览', 'Preview interface, typography and background changes', '主题 字号 侧边栏 字体 背景 theme font sidebar'],
    terminal: ['字体、行距与键盘操作', 'Typography, spacing and keyboard behavior', '复制 粘贴 配色 快捷键 font clipboard keyboard'],
    local: ['管理新建本机终端的环境变量', 'Environment variables for new local terminals', '环境变量 CMD PowerShell environment'],
    workspace: ['默认连接视图与外观方案', 'Default connection view and appearance presets', 'SSH 可视化 默认 导入 导出 方案 preset desktop'],
    network: ['选择网络出口，并检查连接状态', 'Choose an outbound route and diagnose connectivity', '代理 proxy 网络 system machine ping'],
    extensions: ['按需启用功能与管理自定义扩展', 'Manage optional features and custom extensions', '插件 市场 plugin extension'],
    security: ['管理智能体和外部工具可访问的范围', 'Control access for agents and external tools', 'MCP API 权限 全选 基座 authorization permissions'],
    updates: ['版本、自动更新与诊断日志', 'Version, automatic updates and diagnostic logs', '下载 日志 统计 download version logs'],
  };
  const visibleCategories = categories.filter(([id, , label]) => !query.trim() || `${label} ${categoryHelp[id].join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const [category, setCategory] = useState<string>('appearance');
  const [draft, setDraft] = useState(value),
    [error, setError] = useState('');
  const [fonts, setFonts] = useState<string[]>([]),
    [fontState, setFontState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const mcp = useMcpSettings();
  const observedLayout = useRef(value.layout);
  const observedValue = useRef(value);
  useLayoutEffect(() => {
    if (themeRequest) {
      setDraft((current) => ({ ...current, theme: themeRequest.theme }));
      setCategory('appearance');
    }
  }, [themeRequest]);
  useEffect(() => {
    let disposed = false;
    void window.cshell
      .systemFonts()
      .then((list) => {
        if (!disposed) {
          setFonts(list);
          setFontState('ready');
        }
      })
      .catch(() => {
        if (!disposed) setFontState('error');
      });
    return () => {
      disposed = true;
      onPreview(null);
    };
  }, [onPreview]);
  useLayoutEffect(() => {
    // Sidebar controls and cloud refreshes can update saved preferences while this
    // editor remains mounted in a hidden tab. Refresh only externally changed
    // fields, preserving unrelated unsaved edits before publishing the preview.
    const previous = observedValue.current;
    observedValue.current = value;
    const changed = (Object.keys(value) as (keyof Preferences)[]).filter(
      key => JSON.stringify(previous[key]) !== JSON.stringify(value[key]),
    );
    if (changed.length) {
      setDraft(current => Object.assign({}, current, Object.fromEntries(changed.map(key => [key, value[key]]))));
      return;
    }
    // Synchronize the external layout before publishing a preview. A passive
    // layout update can otherwise chase the previous preview back from the
    // parent when a form change and a workspace resize happen together.
    const externalLayoutChanged = observedLayout.current !== layout;
    observedLayout.current = layout;
    if (externalLayoutChanged && draft.layout !== layout) {
      setDraft(current => current.layout === layout ? current : { ...current, layout });
      return;
    }
    onPreview(draft);
  }, [draft, layout, onPreview, value]);
  const importBackground = async (token?: string) => {
    setBusy(true);
    setError('');
    try {
      const asset = await window.cshell.importAppearance('background', token);
      if (asset) setDraft((current) => ({ ...current, backgroundAsset: asset }));
    } catch {
      setError(t('imageImportError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="workspace-category-container"><section
      className="editor-page preferences-page categorized-settings settings-studio"
      aria-label={t('settingsTitle')}
    >
      <nav className="settings-nav" aria-label={cn ? '设置分类' : 'Settings categories'} onFocus={event => {
        if (event.target instanceof HTMLButtonElement) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }}>
        <h2>{t('settingsTitle')}</h2>
        <label className="settings-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label={cn ? '查找设置分类' : 'Find settings categories'} placeholder={cn ? '查找设置' : 'Find settings'} value={query} onChange={event => setQuery(event.target.value)}/></label>
        {visibleCategories.length === 0 && <p className="settings-search-empty" role="status">{cn ? '未找到分类，试试其他关键词' : 'No categories found. Try another keyword.'}</p>}
        {visibleCategories.map(([id, Icon, label]) => (
          <button
            key={id}
            aria-current={category === id ? 'page' : undefined}
            onClick={() => { setCategory(id); }}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <header className="settings-category-heading">
          <h1>{categories.find(([id]) => id === category)?.[2]}</h1>
          <p>{categoryHelp[category]?.[cn ? 0 : 1]}</p>
        </header>
        <div hidden={category !== 'updates'}>
          <UpdateSettings english={!cn} />
          <UsageConsent english={!cn} active={category === 'updates'} />
        </div>
        {window.cshell.networkStatus && <div hidden={category !== 'network'}><NetworkSettings/></div>}
        <div hidden={category !== 'workspace'}>
          <section className="settings-section">
            <h2>{cn ? '连接方式' : 'Opening connections'}</h2>
            <label>{cn ? '默认连接视图' : 'Default connection view'}
              <select value={draft.defaultConnectionView} onChange={e => setDraft({...draft, defaultConnectionView: e.target.value as Preferences['defaultConnectionView'],defaultConnectionViewExplicit:true})}>
                <option value="original">{cn ? '原始连接方式（默认）' : 'Original connection (default)'}</option>
                <option value="visual">{cn ? '可视化桌面' : 'Visual desktop'}</option>
              </select>
            </label>
            <p className="muted">{cn ? '原始方式直接打开 SSH 终端或系统远程桌面。SSH 会话可随时切换到可视化桌面；已有会话保持不变。' : 'Open SSH terminals or the system RDP client directly. Switch an SSH session to its visual desktop at any time; existing sessions stay unchanged.'}</p>
          </section>
          <PresetControls draft={draft} onSelect={setDraft} onError={setError} />
        </div>
        <div hidden={category !== 'local'}>
          {navigator.platform.startsWith('Win') && <LocalEnvironmentSettings />}
        </div>
        <form
          id="workspace-preferences-form"
          hidden={!['appearance', 'terminal'].includes(category)}
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || mcp.busy) return;
            setBusy(true);
            setError('');
            void mcp
              .save(category === 'security')
              .then(() => onSave(draft))
              .then(onClose)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <fieldset disabled={busy}>
            <h2 hidden={category !== 'appearance'}>{cn ? '主题与语言' : 'Theme & language'}</h2>
            <div className="form-grid settings-theme-row" hidden={category !== 'appearance'}>
              <label>
                {t('theme')}
                <select
                  value={draft.theme}
                  onChange={(e) =>
                    setDraft({ ...draft, theme: e.target.value as Preferences['theme'] })
                  }
                >
                  <option value="dark">{t('dark')}</option>
                  <option value="light">{t('light')}</option>
                </select>
              </label>
              <label>
                {t('language')}
                <select
                  value={draft.locale}
                  onChange={(e) =>
                    setDraft({ ...draft, locale: e.target.value as Preferences['locale'] })
                  }
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
            </div>
            <h2>{t('fonts')}</h2>
            <div hidden={category !== 'appearance'}>
              <div className="form-grid">
                {([['uiFontSize', cn ? '界面字号' : 'Interface size', 9, 20], ['sidebarFontSize', cn ? '连接名称字号' : 'Connection name size', 8, 22], ['sidebarGroupSize', cn ? '分组标题字号' : 'Group title size', 8, 22], ['sidebarDetailSize', cn ? '地址与说明字号' : 'Address size', 8, 20]] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} value={draft[key]} onChange={e => setDraft(previous => ({ ...previous, [key]: Math.max(min, Math.min(max, Number(e.target.value) || min)) }))}/></label>)}
                <label>{cn ? '侧边栏间距' : 'Sidebar spacing'}<select aria-label={cn ? '侧边栏间距' : 'Sidebar spacing'} value={draft.sidebarDensity} onChange={e => setDraft(previous => ({ ...previous, sidebarDensity: e.target.value as Preferences['sidebarDensity'] }))}><option value="compact">{cn ? '紧凑' : 'Compact'}</option><option value="comfortable">{cn ? '舒适' : 'Comfortable'}</option><option value="spacious">{cn ? '宽松' : 'Spacious'}</option></select></label>
              </div>
              <button type="button" onClick={() => setDraft(previous => ({ ...previous, uiFont: defaults.uiFont, uiFontAsset: null, uiFontSize: defaults.uiFontSize, sidebarFontSize: defaults.sidebarFontSize, sidebarGroupSize: defaults.sidebarGroupSize, sidebarDetailSize: defaults.sidebarDetailSize, sidebarDensity: defaults.sidebarDensity }))}>{cn ? '恢复界面字体与间距' : 'Reset interface typography'}</button>
            </div>
            <p className="muted">
              {fontState === 'loading'
                ? t('detectingFonts')
                : fontState === 'error'
                  ? t('fontDetectionError')
                  : `${t('installedFonts')} · ${fonts.length}`}
            </p>
            <div className="font-grid">
              <div hidden={category !== 'appearance'}>
                <FontPicker
                  label={t('uiFont')}
                  previewSize={draft.uiFontSize}
                  value={draft.uiFont}
                  asset={draft.uiFontAsset}
                  fonts={fonts}
                  onChange={(uiFont, uiFontAsset) =>
                    setDraft((current) => ({ ...current, uiFont, uiFontAsset }))
                  }
                  onError={setError}
                />
              </div>
              <div hidden={category !== 'terminal'}>
                <FontPicker
                  label={t('terminalFont')}
                  previewSize={draft.fontSize}
                  value={draft.terminalFont}
                  asset={draft.terminalFontAsset}
                  fonts={fonts}
                  onChange={(terminalFont, terminalFontAsset) =>
                    setDraft((current) => ({ ...current, terminalFont, terminalFontAsset }))
                  }
                  onError={setError}
                />
              </div>
            </div>
            <div className="font-size-row settings-terminal-options" hidden={category !== 'terminal'}>
              <label><input type="checkbox" checked={draft.terminalClipboardKeys} onChange={event => setDraft({ ...draft, terminalClipboardKeys: event.target.checked })}/>{cn ? 'Ctrl+C / Ctrl+V 复制粘贴（原生按键在快捷键栏）' : 'Ctrl+C / Ctrl+V copy and paste (native keys in toolbar)'}</label>
              <label><input type="checkbox" checked={draft.terminalSemanticColors} onChange={event => setDraft({ ...draft, terminalSemanticColors: event.target.checked })}/>{cn ? '提示符与链接辅助配色' : 'Highlight prompts and links'}</label>
              <label>
                {t('terminalLineHeight')}
                <input
                  type="number"
                  min={1}
                  max={1.8}
                  step={0.1}
                  value={draft.lineHeight}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      lineHeight: Math.max(1, Math.min(1.8, Number(e.target.value))),
                    })
                  }
                />
              </label>
              <label>
                {t('fontSize')}
                <input
                  type="number"
                  min={8}
                  max={28}
                  value={draft.fontSize}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      fontSize: Math.max(8, Math.min(28, Number(e.target.value))),
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    terminalFont: defaults.terminalFont,
                    terminalFontAsset: null,
                    fontSize: defaults.fontSize,
                    lineHeight: defaults.lineHeight,
                  })
                }
              >
                {cn ? '恢复终端字体默认值' : 'Reset terminal typography'}
              </button>
            </div>
            <div hidden={category !== 'appearance'}>
              <h2>{t('background')}</h2>
              <div
                className="background-picker"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (busy) return;
                  const files = Array.from(e.dataTransfer.files);
                  if (files.length !== 1) {
                    setError(t('oneImage'));
                    return;
                  }
                  void importBackground(window.cshell.droppedFiles(files)[0]);
                }}
              >
                <div className="background-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void importBackground()}
                  >
                    {t('chooseImage')}
                  </button>
                  <span>{draft.backgroundAsset?.name || t('imageDropHint')}</span>
                  {draft.backgroundAsset && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, backgroundAsset: null })}
                    >
                      {t('removeBackground')}
                    </button>
                  )}
                </div>
                <div className="background-controls">
                  <label>
                    {t('imageOpacity')} · {Math.round(draft.backgroundOpacity * 100)}%
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.01"
                      value={draft.backgroundOpacity}
                      onChange={(e) =>
                        setDraft({ ...draft, backgroundOpacity: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    {t('imageBlur')} · {draft.backgroundBlur}px
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      value={draft.backgroundBlur}
                      onChange={(e) =>
                        setDraft({ ...draft, backgroundBlur: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    {t('imageFit')}
                    <select
                      value={draft.backgroundFit}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          backgroundFit: e.target.value as Preferences['backgroundFit'],
                        })
                      }
                    >
                      <option value="cover">{t('imageCover')}</option>
                      <option value="contain">{t('imageContain')}</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </fieldset>
        </form>
        <div hidden={category !== 'extensions'} className="settings-extension-entry">
          <Blocks size={24} />
          <h2>{cn ? '按需扩展工作台' : 'Workbench extensions'}</h2>
          <p className="muted">
            {cn
              ? '在插件中管理各自的功能与配置。'
              : 'Manage each plugin’s features and configuration in its own page.'}
          </p>
          <button
            className="secondary"
            onClick={() => window.dispatchEvent(new Event('cshell:open-extensions'))}
          >
            {cn ? '打开插件市场' : 'Open plugin marketplace'}
          </button>
        </div>
        <div hidden={category !== 'security'}>
          <section className="settings-section">
            <h3>{cn ? 'AI 基座与权限' : 'AI providers & permissions'}</h3>
            <button
              className="secondary"
              onClick={() => window.dispatchEvent(new Event('cshell:open-ai'))}
            >
              {cn
                ? '管理基座、会话与服务器权限'
                : 'Manage providers, sessions & server permissions'}
            </button>
          </section>
          <McpSettings state={mcp} saving={busy} />
        </div>
      </div>
      <footer className="settings-savebar">
        <span role={error ? 'alert' : 'status'} className={error ? 'form-error' : 'muted'}>
          {error ||
            (['appearance', 'terminal', 'workspace'].includes(category) ? t('previewHint') : '')}
        </span>
        <button type="button" className="secondary" disabled={busy || mcp.busy} onClick={onClose}>
          {t('cancel')}
        </button>
        <button
          hidden={category === 'local' || category === 'network'}
          className="primary"
          form="workspace-preferences-form"
          disabled={busy || mcp.busy || (category === 'security' && !mcp.draft)}
        >
          {busy ? (cn ? '正在保存…' : 'Saving…') : t('save')}
        </button>
      </footer>
    </section></div>
  );
}

