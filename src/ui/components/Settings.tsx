import { LocalEnvironmentSettings } from './LocalEnvironmentSettings';
import { Palette, Terminal, PanelsTopLeft, Blocks, ShieldCheck, Download } from 'lucide-react';
import { UpdateSettings } from './UpdateSettings';
import { useEffect, useLayoutEffect, useState } from 'react';
import { defaults, type Preferences } from '../../shared/contracts';
import { useI18n } from '../i18n';
import { PresetControls } from './PresetControls';
import { McpSettings, useMcpSettings } from './McpSettings';
import { FontPicker } from './FontPicker';
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
    ['extensions', Blocks, cn ? '扩展' : 'Extensions'],
    ['security', ShieldCheck, cn ? 'AI 与安全' : 'AI & security'],
    ['updates', Download, cn ? '关于与更新' : 'About & updates'],
  ] as const;
  const [category, setCategory] = useState<string>('appearance');
  const [draft, setDraft] = useState(value),
    [error, setError] = useState('');
  const [fonts, setFonts] = useState<string[]>([]),
    [fontState, setFontState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const mcp = useMcpSettings();
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
  useEffect(() => {
    setDraft((current) => (current.layout === layout ? current : { ...current, layout }));
  }, [layout]);
  useLayoutEffect(() => {
    onPreview(draft);
  }, [draft, onPreview]);
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
    <section
      className="editor-page preferences-page categorized-settings"
      aria-label={t('settingsTitle')}
    >
      <nav className="settings-nav" aria-label={cn ? '设置分类' : 'Settings categories'}>
        <h2>{t('settingsTitle')}</h2>
        {categories.map(([id, Icon, label]) => (
          <button
            key={id}
            aria-current={category === id ? 'page' : undefined}
            onClick={() => setCategory(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <header className="settings-category-heading">
          <h1>{categories.find(([id]) => id === category)?.[2]}</h1>
        </header>
        <div hidden={category !== 'updates'}>
          <UpdateSettings english={!cn} />
        </div>
        <div hidden={category !== 'workspace'}>
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
            <div className="form-grid" hidden={category !== 'appearance'}>
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
            <div className="font-size-row" hidden={category !== 'terminal'}>
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
                  min={10}
                  max={28}
                  value={draft.fontSize}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      fontSize: Math.max(10, Math.min(28, Number(e.target.value))),
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
          hidden={category === 'local'}
          className="primary"
          form="workspace-preferences-form"
          disabled={busy || mcp.busy || (category === 'security' && !mcp.draft)}
        >
          {t('save')}
        </button>
      </footer>
    </section>
  );
}
