import { useEffect, useRef, useState } from 'react';
import { AiMarkdown } from './AiMarkdown';

/** Presentation-only buffer: stored messages and tool execution are never delayed. */
export function AiStreamingMarkdown({ text, streaming, onReveal }: {
  text: string; streaming: boolean; onReveal: () => void;
}) {
  const [visible, setVisible] = useState(streaming ? '' : text);
  const shown = useRef(visible);
  const latest = useRef({ text, streaming, onReveal });
  latest.current = { text, streaming, onReveal };
  useEffect(() => {
    let frame = 0, previous = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reveal = (now: number) => {
      const current = latest.current;
      const elapsed = Math.min(64, now - previous);
      if (elapsed >= 32) {
        previous = now;
        const target = current.text;
        let next = target;
        if (current.streaming && !reduced.matches && target.startsWith(shown.current)) {
          const backlog = target.length - shown.current.length;
          let end = shown.current.length + Math.min(backlog, Math.max(1, Math.ceil(backlog * elapsed / 120)));
          // Never reveal half a UTF-16 surrogate pair.
          if (end < target.length && /[\uD800-\uDBFF]/.test(target[end - 1] ?? '')) end++;
          next = target.slice(0, end);
        }
        if (next !== shown.current) {
          shown.current = next;
          setVisible(next);
        }
      }
      frame = requestAnimationFrame(reveal);
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { latest.current.onReveal(); }, [visible]);
  return <AiMarkdown text={streaming ? visible : text} />;
}
