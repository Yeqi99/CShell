import { useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
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
  const { t } = useI18n(),
    [directory, setDirectory] = useState<{ root: string; label: string } | null>(null);
  const choose = () =>
    void window.cshell
      .chooseLocal()
      .then((next) => {
        if (next) setDirectory(next);
      })
      .catch(onError);
  return (
    <section className="local-dock">
      <header>
        <span>
          <FolderOpen size={13} />
          {t('localFiles')}
        </span>
        <button onClick={choose} title={directory?.label}>
          {directory?.label || t('chooseDirectory')}
        </button>
        <button className="icon" aria-label={t('close')} onClick={onClose}>
          <X size={13} />
        </button>
      </header>
      {directory ? (
        <FilePanel
          key={directory.root}
          sessionId={sessionId || ''}
          localRoot={directory.root}
          transfers={transfers}
          onError={onError}
        />
      ) : (
        <button className="choose-directory secondary" onClick={choose}>
          <FolderOpen size={16} />
          {t('chooseDirectory')}
        </button>
      )}
    </section>
  );
}
