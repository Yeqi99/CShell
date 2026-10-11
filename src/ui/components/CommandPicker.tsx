import { useEffect, useRef, useState } from 'react';
import { ArrowDown, CornerDownLeft, Search, X, type LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n';

export type WorkbenchCommand = {
  id: string;
  name: string;
  hint?: string;
  icon: LucideIcon;
  server?: boolean;
  searchOnly?: boolean;
  action: () => void;
};

/** A modeless, anchored search surface; opening it never moves the workspace. */
export function CommandPicker({
  commands,
  onClose,
}: {
  commands: WorkbenchCommand[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = root.current!;
    input.current?.focus();
    const outside = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        !panel.contains(e.target) &&
        !e.target.closest('.palette-trigger')
      )
        close.current();
    };
    const focusOutside = (e: FocusEvent) => {
      if (
        e.target instanceof Element &&
        !panel.contains(e.target) &&
        !e.target.closest('.palette-trigger')
      )
        close.current();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focusOutside);
      if (
        previous?.isConnected &&
        (document.activeElement === document.body || panel.contains(document.activeElement))
      )
        previous.focus();
    };
  }, []);
  const matches = commands.filter(
    (c) =>
      (!c.searchOnly || query.trim()) &&
      (c.name + ' ' + (c.hint || '')).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const active = Math.min(selected, Math.max(0, matches.length - 1));
  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);
  const run = (command: WorkbenchCommand) => {
    onClose();
    command.action();
  };
  return (
    <section
      ref={root}
      id="workbench-commands"
      className="inline-finder command-picker"
      aria-label={t('commandPalette')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="palette-search">
        <Search size={17} aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-label={t('paletteHint')}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={matches[active] ? 'command-' + matches[active].id : undefined}
          placeholder={t('paletteHint')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (matches.length)
                setSelected(
                  (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
                );
            }
            if (e.key === 'Enter' && matches[active] && !e.nativeEvent.isComposing) {
              e.preventDefault();
              run(matches[active]);
            }
          }}
        />
        <button className="icon" aria-label={t('close')} title={t('close')} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div
        className="command-list"
        id="command-results"
        role="listbox"
        aria-label={t('commandResults')}
      >
        {matches.map((command, i) => (
          <div key={command.id}>
            {(i === 0 || !!matches[i - 1].server !== !!command.server) && (
              <div className="command-group-label" role="presentation">
                {t(command.server ? 'servers' : 'commands')}
              </div>
            )}
            <button
              id={'command-' + command.id}
              role="option"
              aria-selected={active === i}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setSelected(i)}
              onClick={() => run(command)}
            >
              <command.icon size={16} aria-hidden="true" />
              <span className="command-name">{command.name}</span>
              {command.hint &&
                (command.server ? (
                  <span className="command-detail">{command.hint}</span>
                ) : (
                  <kbd>{command.hint}</kbd>
                ))}
            </button>
          </div>
        ))}
      </div>
      {!matches.length && (
        <p className="command-empty" role="status">
          {t('noSearchResults')}
        </p>
      )}
      <footer className="command-picker-footer">
        <span>
          <ArrowDown size={12} />
          {t('commandNavigate')}
        </span>
        <span>
          <CornerDownLeft size={12} />
          {t('commandRun')}
        </span>
        <span className="command-escape">Esc {t('close')}</span>
      </footer>
    </section>
  );
}
