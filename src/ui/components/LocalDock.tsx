import { useState } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import type { Transfer } from '../../shared/contracts';
import { FilePanel } from './FilePanel';
import { useI18n } from '../i18n';

export function LocalDock({
  sessionId,
  transfers,
  onError,
  onClose,
}: {
  sessionId?: string;
  transfers: Transfer[];
  onError: (e: unknown) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [directories, setDirectories] = useState<{ root: string; label: string }[]>([]);
  const choose = () =>
    void window.cshell
      .chooseLocal()
      .then((next) => {
        if (next) setDirectories((current) => [...current, next]);
      })
      .catch(onError);
  const addLabel = locale === 'zh-CN' ? '打开另一个目录' : 'Open another directory';
  return (
    <section className="local-dock">
      <header>
        <span>
          <FolderOpen size={13} />
          {t('localFiles')}
        </span>
        <button className="icon" onClick={choose} title={addLabel} aria-label={addLabel}>
          <Plus size={14} />
        </button>
        <button className="icon" title={t('close')} aria-label={t('close')} onClick={onClose}>
          <X size={13} />
        </button>
      </header>
      {directories.length ? (
        <div className="local-directory-panes">
          {directories.map((directory) => (
            <section
              className="local-directory-pane"
              key={directory.root}
              aria-label={directory.label}
            >
              <header>
                <span title={directory.label}>{directory.label}</span>
                <button
                  className="icon"
                  title={t('close')}
                  aria-label={`${t('close')} ${directory.label}`}
                  onClick={() =>
                    setDirectories((current) =>
                      current.filter((item) => item.root !== directory.root),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </header>
              <FilePanel
                sessionId={sessionId || ''}
                localRoot={directory.root}
                transfers={transfers}
                onError={onError}
              />
            </section>
          ))}
        </div>
      ) : (
        <button className="choose-directory secondary" onClick={choose}>
          <FolderOpen size={16} />
          {t('chooseDirectory')}
        </button>
      )}
    </section>
  );
}
