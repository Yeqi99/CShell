import { useEffect, useRef, useState } from 'react';
import { Globe2 } from 'lucide-react';
import type { Preferences } from '../../shared/contracts';
export function LanguageMenu({
  locale,
  onSelect,
}: {
  locale: Preferences['locale'];
  onSelect: (locale: Preferences['locale']) => void;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <div
      className="language-menu"
      ref={host}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false);
          host.current?.querySelector<HTMLButtonElement>('button')?.focus();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!open) {
            setOpen(true);
            requestAnimationFrame(() =>
              host.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus(),
            );
          } else {
            const options = Array.from(
              host.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
            );
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            options[
              (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            ]?.focus();
          }
        }
      }}
    >
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Globe2 size={12} />
        {locale === 'zh-CN' ? '简体中文' : 'English'}
      </button>
      {open && (
        <div role="menu" aria-label={locale === 'zh-CN' ? '语言' : 'Language'}>
          {(['zh-CN', 'en-US'] as const).map((value) => (
            <button
              role="menuitemradio"
              aria-checked={value === locale}
              key={value}
              onClick={() => {
                onSelect(value);
                setOpen(false);
              }}
            >
              {value === 'zh-CN' ? '简体中文' : 'English'}
              {value === locale ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
