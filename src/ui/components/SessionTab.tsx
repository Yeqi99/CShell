import { useRef, useState } from 'react';
import { X, SquareArrowOutUpRight } from 'lucide-react';
import type { Profile } from '../../shared/contracts';
import {isFileConnection} from '../../shared/file-connections';
import { useI18n } from '../i18n';
const dragType = 'application/x-cshell-session';
export function SessionTab({
  id,
  profile,
  closed,
  active,
  onSelect,
  onClose,
  onMove,
  onFloat,
}: {
  id: string;
  profile: Profile;
  closed: boolean;
  active: boolean;
  onFloat: () => void;
  onSelect: () => void;
  onClose: () => void;
  onMove: (source: string, target: string) => void;
}) {
  const { t, locale } = useI18n();
  const [label, setLabel] = useState(profile.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const button = useRef<HTMLButtonElement>(null);
  const edit = () => {
    setDraft(label);
    setEditing(true);
  };
  const finish = () => {
    setLabel(draft.trim() || label);
    setEditing(false);
    button.current?.focus();
  };
  return (
    <div
      className={`tab session-tab ${active ? 'active' : ''}`}
      data-session={id}
      onClick={() => {
        if (!editing) onSelect();
      }}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(dragType, id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(dragType)) e.preventDefault();
      }}
      onDrop={(e) => {
        const source = e.dataTransfer.getData(dragType);
        if (source) {
          e.preventDefault();
          e.stopPropagation();
          onMove(source, id);
        }
      }}
    >
      {editing ? (
        <input
          className="tab-rename"
          aria-label={t('renameTab')}
          maxLength={80}
          value={draft}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
              button.current?.focus();
            }
          }}
        />
      ) : (
        <button
          ref={button}
          title={`${(profile.protocol??'ssh').toUpperCase()} · ${profile.username}@${profile.host}:${profile.port} · ${t('renameTabHint')}`}
          onClick={onSelect}
          onDoubleClick={edit}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              edit();
            }
          }}
        >
          <i className={`dot ${closed ? 'off' : ''}`} />
          {label}
        </button>
      )}
      {!closed && !isFileConnection(profile) && (
        <button
          className="icon tab-float"
          aria-label={locale === 'zh-CN' ? '在独立小窗打开' : 'Open floating terminal'}
          title={locale === 'zh-CN' ? '在独立小窗打开' : 'Open floating terminal'}
          onClick={(e) => {
            e.stopPropagation();
            onFloat();
          }}
        >
          <SquareArrowOutUpRight size={13} />
        </button>
      )}
      <button
        className="icon"
        aria-label={`${t('close')} ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
