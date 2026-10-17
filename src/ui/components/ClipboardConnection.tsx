import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { clipboardDigest, detectClipboardConnection } from '../../shared/clipboard-connection';
import type { ExtractedConnection } from '../../shared/connection-extraction';
import { useI18n } from '../i18n';

const storageKey = 'cshell.clipboard-connections.seen.v1';
const seen = new Set<string>();
try {
  const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
  if (Array.isArray(stored))
    for (const hash of stored)
      if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) seen.add(hash);
} catch {
  /* Private/unavailable storage: deduplicate for this application run. */
}

export function ClipboardConnection({
  onImport,
}: {
  onImport: (value: ExtractedConnection) => void;
}) {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  const [candidate, setCandidate] = useState<ExtractedConnection | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    let lastDigest = '';
    const check = async () => {
      if (!active || pending.current || document.hidden || !document.hasFocus()) return;
      pending.current = true;
      try {
        const text = await window.cshell.pasteText();
        if (!active) return;
        const found = detectClipboardConnection(text);
        if (!found) {
          setCandidate(null);
          lastDigest = '';
          return;
        }
        const hash = await clipboardDigest(text);
        if (!active || document.hidden || !document.hasFocus()) return;
        if (hash === lastDigest) return;
        lastDigest = hash;
        if (seen.has(hash)) {
          setCandidate(null);
          return;
        }
        seen.add(hash);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...seen]));
        } catch {
          /* Keep in-memory deduplication. */
        }
        setCandidate(found);
      } catch {
        /* Clipboard availability must never interrupt terminal input. */
      } finally {
        pending.current = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 1500);
    window.addEventListener('focus', check);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);
  if (!candidate) return null;
  return (
    <aside className="clipboard-connection" role="status" aria-live="polite">
      <div>
        <strong>{cn ? '剪贴板中有 SSH 连接' : 'SSH connection in clipboard'}</strong>
        <p>
          {candidate.fields.username ? `${candidate.fields.username}@` : ''}
          {candidate.fields.host}:{candidate.fields.port ?? 22}
        </p>
        <small>
          {cn
            ? '导入到新连接草稿，确认后保存或连接。'
            : 'Import into a new draft, then save or connect.'}
        </small>
      </div>
      <button
        type="button"
        onClick={() => {
          onImport(candidate);
          setCandidate(null);
        }}
      >
        {cn ? '一键导入' : 'Import'}
      </button>
      <button
        type="button"
        className="icon"
        title={cn ? '忽略' : 'Dismiss'}
        aria-label={cn ? '忽略剪贴板连接' : 'Dismiss clipboard connection'}
        onClick={() => setCandidate(null)}
      >
        <X size={16} />
      </button>
    </aside>
  );
}
