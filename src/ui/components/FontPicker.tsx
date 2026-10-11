import { useEffect, useState } from 'react';
import type { AppearanceAsset } from '../../shared/contracts';
import { assetFamily, loadFont } from '../appearance';
import { useI18n } from '../i18n';

export function FontPicker({
  label,
  previewSize = 16,
  value,
  asset,
  fonts,
  onChange,
  onError,
}: {
  label: string;
  previewSize?: number;
  value: string;
  asset: AppearanceAsset | null;
  fonts: string[];
  onChange: (family: string, asset: AppearanceAsset | null) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    setFilter('');
  }, [fonts]);
  const importFont = async (token?: string) => {
    setBusy(true);
    try {
      const imported = await window.cshell.importAppearance('font', token);
      if (imported) {
        await loadFont(imported);
        onChange(`${assetFamily(imported)}, "Microsoft YaHei UI", monospace`, imported);
      }
    } catch {
      onError(t('fontImportError'));
    } finally {
      setBusy(false);
    }
  };
  const options = fonts.filter((font) =>
    font.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  return (
    <div
      className={`font-picker ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (busy) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length !== 1) {
          onError(t('oneFont'));
          return;
        }
        void importFont(window.cshell.droppedFiles(files)[0]);
      }}
    >
      <label>
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value, null)} disabled={busy}>
          <option value={value}>{asset?.name || value}</option>
          {options.map((font) => {
            const family = `"${font.replace(/["\\]/g, '')}", "Microsoft YaHei UI", monospace`;
            return family === value ? null : (
              <option key={font} value={family}>
                {font}
              </option>
            );
          })}
        </select>
      </label>
      <input
        className="font-filter"
        aria-label={`${t('filterFonts')} · ${label}`}
        placeholder={t('filterFonts')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div
        className="font-preview"
        style={{ fontFamily: value, fontSize: previewSize }}
        aria-label={`${t('preview')} · ${label}`}
      >
        CShell · 中文预览
        <br />
        Aa Bb 0123456789　→ ✓<br />
        <span>user@server:~$ ls -la</span>
      </div>
      <div className="font-import-row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void importFont()}
        >
          {busy ? t('loading') : t('importFont')}
        </button>
        <small>{t('fontDropHint')}</small>
      </div>
    </div>
  );
}
