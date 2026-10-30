import {transferDetail} from '../../shared/transfer-progress';
import { DockerPanel } from './DockerPanel';
import { Box } from 'lucide-react';
import { useState, useEffect, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Files, ArrowDownUp, X } from 'lucide-react';
import type { Transfer } from '../../shared/contracts';
import { useI18n } from '../i18n';
import { FilePanel } from './FilePanel';
import { MonitorPanel } from './MonitorPanel';
export function ToolsPanel({
  revealRevision = 0,
  onClose,
  sessionId,
  transfers,
  onError,
  dragHandle,
  sessionName,
  active,
  dockerEnabled,
  closed = false,
}: {
  dragHandle?: ReactNode;
  revealRevision?: number;
  onClose?: () => void;
  sessionId: string;
  sessionName: string;
  active: boolean;
  dockerEnabled: boolean;
  closed?: boolean;
  transfers: Transfer[];
  onError: (e: unknown) => void;
}) {
  const { t } = useI18n();
  const [tool, setTool] = useState<'files' | 'docker'>('files');
  const dockerVisible = dockerEnabled && tool === 'docker';
  const [queue, setQueue] = useState(false);
  const transferCount = transfers.length;
  useEffect(() => { if (transferCount) setQueue(true); }, [transferCount]);
  const [filesOpen, setFilesOpen] = useState(true);
  useEffect(() => {
    if (revealRevision > 0) { setTool('files'); setFilesOpen(true); }
  }, [revealRevision]);
  return (
    <aside className="tools-panel">
      <header className="files-title" title={`${t('toolsFor')} · ${sessionName}`}>
        <button
          className="file-panel-toggle"
          aria-expanded={filesOpen && !dockerVisible}
          onClick={() => {
            if (dockerVisible) {
              setTool('files');
              setFilesOpen(true);
            } else setFilesOpen((v) => !v);
          }}
        >
          {filesOpen && !dockerVisible ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Files size={14} />
          {t('files')}
        </button>
        {dragHandle && <span className="tools-drag-handle">{dragHandle}</span>}
        {dockerEnabled && (
          <button
            className="docker-tool-tab"
            aria-pressed={dockerVisible}
            onClick={() => setTool('docker')}
          >
            <Box size={14} />
            Docker
          </button>
        )}
        {onClose && <button className="icon" style={{marginLeft:'auto'}} aria-label={t('close') + ' ' + t('files')} title={t('close') + ' ' + t('files')} onClick={onClose}><X size={14}/></button>}
      </header>
      <div className="tool-content" hidden={!filesOpen || dockerVisible}>
        <FilePanel key={sessionId} sessionId={sessionId} closed={closed} transfers={transfers} onError={onError} />
      </div>
      {dockerEnabled && (
        <div className="docker-tool-content" hidden={!dockerVisible}>
          <DockerPanel sessionId={sessionId} active={active && dockerVisible} />
        </div>
      )}
      {!dockerVisible && (
        <MonitorPanel key={sessionId || 'idle'} sessionId={sessionId} active={active} />
      )}
      <div className={`transfers ${queue ? 'expanded' : ''}`}>
        <button className="queue-toggle" aria-expanded={queue} onClick={() => setQueue(!queue)}>
          {queue ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <ArrowDownUp size={14} />{t('transfers')}
          <span>{transfers.filter((x) => x.state === 'running').length}</span>
        </button>
        {queue && (
          <div className="queue-items">
            {!transfers.length && <p className="empty-small">{t('noTransfers')}</p>}
            {transfers
              .slice(-20)
              .reverse()
              .map((item) => (
                <div className="transfer" key={item.id} title={item.error}>
                  <div>
                    <span>
                      {item.direction === 'upload' ? '↑' : item.direction === 'copy' ? '↔' : '↓'} {item.name}
                    </span>
                    <small className={item.state === 'failed' ? 'danger' : ''}>
                      {t(item.state)}
                    </small>
                    {item.state === 'running' && (
                      <button
                        className="icon"
                        aria-label={t('cancel')}
                        onClick={() => void window.cshell.cancelTransfer(item.id).catch(onError)}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <progress
                    max={Math.max(item.total, 1)}
                    value={item.state === 'done' ? Math.max(item.total, 1) : item.totalKnown ? Math.min(item.done,item.total * .99) : undefined}
                    aria-label={`${item.name} 传输进度`}
                  />
                  <small className="transfer-detail">{transferDetail(item)}</small>
                </div>
              ))}
          </div>
        )}
      </div>
    </aside>
  );
}
