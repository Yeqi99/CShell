import { useEffect, useRef } from 'react';
import { AiMarkdown } from './AiMarkdown';

/** Presentation-only buffer: stored messages and tool execution are never delayed. */
export function AiStreamingMarkdown({ text, streaming, onReveal }: {
  text: string; streaming: boolean; onReveal: () => void;
}) {
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  useEffect(() => { reveal.current(); }, [text, streaming]);
  return <AiMarkdown text={text} />;
}
