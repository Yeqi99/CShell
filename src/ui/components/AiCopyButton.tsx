import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
export function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon"
      title={copied ? '已复制' : '复制内容'}
      aria-label="复制内容"
      onClick={() =>
        void window.cshell
          .copyText(content)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }
      onBlur={() => setCopied(false)}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
