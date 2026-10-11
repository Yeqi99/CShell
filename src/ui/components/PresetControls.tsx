import { useEffect, useState } from 'react';
import { Download, Upload, Save, Trash2 } from 'lucide-react';
import type { Preferences, WorkspacePreset } from '../../shared/contracts';
import { useI18n } from '../i18n';
export function PresetControls({
  draft,
  onSelect,
  onError,
}: {
  draft: Preferences;
  onSelect: (p: Preferences) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [presets, setPresets] = useState<WorkspacePreset[]>([]),
    [name, setName] = useState(''),
    [selected, setSelected] = useState('');
  const refresh = () => window.cshell.presets().then(setPresets);
  useEffect(() => {
    void refresh().catch((e) => onError(e.message));
  }, []);
  const run = (work: Promise<unknown>) => void work.catch((e) => onError(e.message));
  return (
    <section className="preset-controls">
      <header className="preset-heading">
        <h2>{t('presets')}</h2>{' '}
        <div className="preset-utilities">
          <button
            className="icon"
            title={t('importPreset')}
            aria-label={t('importPreset')}
            type="button"
            onClick={() =>
              run(
                window.cshell.importPreset().then((preset) => {
                  if (preset) {
                    onSelect(preset.preferences);
                    setName(preset.name);
                    setSelected('');
                  }
                }),
              )
            }
          >
            <Upload size={15} />
          </button>
          <button
            className="icon"
            title={t('exportPreset')}
            aria-label={t('exportPreset')}
            type="button"
            onClick={() => run(window.cshell.exportPreset(draft))}
          >
            <Download size={15} />
          </button>
        </div>
      </header>
      <div className="preset-row">
        <label>
          {t('savedPresets')}
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              const preset = presets.find((p) => p.id === e.target.value);
              if (preset) {
                onSelect(preset.preferences);
                setName(preset.name);
              }
            }}
          >
            <option value="">{t('selectPreset')}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon"
          title={t('delete')}
          aria-label={t('delete')}
          type="button"
          disabled={!selected}
          onClick={() =>
            run(
              window.cshell.deletePreset(selected).then(() => {
                setSelected('');
                return refresh();
              }),
            )
          }
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="preset-row">
        <input
          aria-label={t('presetName')}
          placeholder={t('presetName')}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="secondary"
          disabled={!name.trim()}
          onClick={() => run(window.cshell.savePreset(name, draft).then(refresh))}
        >
          <Save size={14} />
          {t('savePreset')}
        </button>
      </div>
      <small>{t('presetHint')}</small>
    </section>
  );
}
