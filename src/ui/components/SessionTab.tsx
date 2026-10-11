import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Profile } from '../../shared/contracts';
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
}: {
  id: string;
  profile: Profile;
  closed: boolean;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onMove: (source: string, target: string) => void;
}) {
  const { t } = useI18n();
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
          title={`${profile.username}@${profile.host}:${profile.port} · ${t('renameTabHint')}`}
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
