import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    { t } = useI18n();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    (
      ref.current?.querySelector<HTMLElement>('input,select') ||
      ref.current?.querySelector<HTMLElement>('button')
    )?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const nodes = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        ];
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay">
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label={t('close')}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
