import { useEffect, useRef, useState } from 'react';

export function useAiDrafts() {
  const [drafts, render] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const current = useRef<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    if (window.cshell.aiDrafts) void window.cshell.aiDrafts().then(saved => {
      if (!alive) return;
      // Text typed while loading always wins, including an explicitly cleared draft.
      current.current = { ...saved, ...current.current }; render(current.current);
    }).catch(() => { if (alive) setError('草稿恢复失败；本次输入仍可发送，请勿关闭窗口。'); });
    return () => { alive = false; };
  }, []);
  const update = (change: (previous: Record<string, string>) => Record<string, string>) => {
    const previous = current.current, next = change(previous);
    current.current = next; render(next);
    for (const [id, text] of Object.entries(next)) {
      if (previous[id] === text || !window.cshell.aiDraftSave) continue;
      void window.cshell.aiDraftSave(id, text).catch(() => setError('草稿未能保存；输入仍在当前窗口，请勿关闭窗口。'));
    }
  };
  return [drafts, update, error] as const;
}
