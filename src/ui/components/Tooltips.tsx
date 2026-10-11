import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** One delegated tooltip surface also covers disabled controls and keyboard focus. */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(
    null,
  );
  useEffect(() => {
    let current: HTMLElement | null = null;
    let originalTitle: string | null = null;
    let addedLabel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(timer);
      if (current && originalTitle !== null) current.setAttribute('title', originalTitle);
      current?.removeAttribute('aria-describedby');
      if (addedLabel) current?.removeAttribute('aria-label');
      addedLabel = false;
      current = null;
      originalTitle = null;
      setTip(null);
    };
    const show = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('button, [data-tooltip]')
          : null;
      if (target === current) return;
      clear();
      if (!target || target.closest('[role="menu"]')) return;
      const text = target.dataset.tooltip || target.title || target.getAttribute('aria-label');
      if (!text) return;
      current = target;
      originalTitle = target.getAttribute('title');
      if (originalTitle && !target.getAttribute('aria-label') && !target.textContent?.trim()) {
        target.setAttribute('aria-label', originalTitle);
        addedLabel = true;
      }
      target.removeAttribute('title');
      timer = setTimeout(
        () => {
          if (!target.isConnected || target.getAttribute('aria-expanded') === 'true') return;
          const rect = target.getBoundingClientRect();
          const above = rect.bottom > window.innerHeight - 75;
          target.setAttribute('aria-describedby', 'cshell-tooltip');
          setTip({
            text,
            x: Math.max(160, Math.min(window.innerWidth - 160, rect.left + rect.width / 2)),
            y: above ? rect.top - 8 : rect.bottom + 8,
            above,
          });
        },
        event.type === 'focusin' ? 0 : 400,
      );
    };
    const leave = (event: MouseEvent) => {
      if (current && !current.contains(event.relatedTarget as Node | null)) clear();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    document.addEventListener('mouseover', show);
    document.addEventListener('mouseout', leave);
    document.addEventListener('focusin', show);
    document.addEventListener('focusout', clear);
    document.addEventListener('pointerdown', clear);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      clear();
      document.removeEventListener('mouseover', show);
      document.removeEventListener('mouseout', leave);
      document.removeEventListener('focusin', show);
      document.removeEventListener('focusout', clear);
      document.removeEventListener('pointerdown', clear);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return tip
    ? createPortal(
        <div
          id="cshell-tooltip"
          role="tooltip"
          className={`control-tooltip ${tip.above ? 'above' : ''}`}
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>,
        document.body,
      )
    : null;
}
