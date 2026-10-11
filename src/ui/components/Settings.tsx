import { ToolSettings } from './ToolSettings';
import type { ToolsSettings } from '../../shared/docker';
import { useEffect, useState } from 'react';
import { defaults, type Preferences } from '../../shared/contracts';
import { useI18n } from '../i18n';
import { PresetControls } from './PresetControls';
import { McpSettings } from './McpSettings';
import { FontPicker } from './FontPicker';
export function Settings({
  value,
  onSave,
  onClose,
  onPreview,
  layout,
  themeRequest,
  tools,
  onToolsSave,
}: {
  tools: ToolsSettings;
  onToolsSave: () => Promise<void>;
  value: Preferences;
  themeRequest?: { theme: Preferences['theme'] } | null;
  layout: Preferences['layout'];
  onSave: (p: Preferences) => Promise<void>;
  onClose: () => void;
  onPreview: (p: Preferences | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value),
    [error, setError] = useState('');
  const [fonts, setFonts] = useState<string[]>([]),
    [fontState, setFontState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (themeRequest) setDraft((current) => ({ ...current, theme: themeRequest.theme }));
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
  useEffect(() => {
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
    <section className="editor-page preferences-page" aria-label={t('settingsTitle')}>
      <h1>{t('settingsTitle')}</h1>
      <PresetControls draft={draft} onSelect={setDraft} onError={setError} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void onSave(draft)
            .then(onClose)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
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
          <div className="font-size-row">
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
                  uiFont: defaults.uiFont,
                  terminalFont: defaults.terminalFont,
                  uiFontAsset: null,
                  terminalFontAsset: null,
                  fontSize: defaults.fontSize,
                })
              }
            >
              {t('resetFonts')}
            </button>
          </div>
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
              <button type="button" className="secondary" onClick={() => void importBackground()}>
                {t('chooseImage')}
              </button>
              <span>{draft.backgroundAsset?.name || t('imageDropHint')}</span>
              {draft.backgroundAsset && (
                <button type="button" onClick={() => setDraft({ ...draft, backgroundAsset: null })}>
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
                  onChange={(e) => setDraft({ ...draft, backgroundBlur: Number(e.target.value) })}
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
          <p className="muted">{t('previewHint')}</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button type="button" onClick={onClose}>
              {t('cancel')}
            </button>
            <button className="primary">{t('save')}</button>
          </footer>
        </fieldset>
      </form>
      <ToolSettings value={tools} onSave={onToolsSave} />
      <section className="settings-section">
        <h3>AI 基座与权限</h3>
        <button
          className="secondary"
          onClick={() => window.dispatchEvent(new Event('cshell:open-ai'))}
        >
          管理基座、会话与服务器权限
        </button>
      </section>
      <McpSettings />
    </section>
  );
}
