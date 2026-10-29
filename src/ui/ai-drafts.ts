import { useEffect, useRef, useState } from 'react';

export function useAiDrafts() {
  const [drafts, render] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [saveErrors, setSaveErrors] = useState<Record<string, boolean>>({});
  const revisions = useRef<Record<string, number>>({});
  const current = useRef<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    if (window.cshell.aiDrafts) void window.cshell.aiDrafts().then(saved => {
      if (!alive) return;
      // Text typed while loading always wins, including an explicitly cleared draft.
      current.current = { ...saved, ...current.current }; render(current.current);
    }).catch(() => { if (alive) setLoadError('草稿恢复失败；本次输入仍可发送，请勿关闭窗口。'); });
    return () => { alive = false; };
  }, []);
  const update = (change: (previous: Record<string, string>) => Record<string, string>) => {
    const previous = current.current, next = change(previous);
    current.current = next; render(next);
    for (const [id, text] of Object.entries(next)) {
      if (previous[id] === text || !window.cshell.aiDraftSave) continue;
      const revision = (revisions.current[id] ?? 0) + 1;
      revisions.current[id] = revision;
      const settled = (failed: boolean) => {
        if (revisions.current[id] !== revision) return;
        setSaveErrors(errors => {
          const next = { ...errors };
          if (failed) next[id] = true; else delete next[id];
          return next;
        });
      };
      void window.cshell.aiDraftSave(id, text).then(async () => {
        settled(false);
        if (loadError && window.cshell.aiDrafts) {
          try {
            const restored = await window.cshell.aiDrafts();
            current.current = { ...restored, ...current.current };
            render(current.current); setLoadError('');
          } catch { /* Preserve the recovery warning until a real read succeeds. */ }
        }
      }, () => settled(true));
    }
  };
  const error = loadError || (Object.keys(saveErrors).length ? '草稿未能保存；输入仍在当前窗口，请勿关闭窗口。' : '');
  return [drafts, update, error] as const;
}
