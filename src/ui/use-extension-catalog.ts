import { useEffect, useState } from 'react';

export type ExtensionModelChoice = { ref: string; model: string; label?: string; available: boolean; reason?: string };
type Catalog = { choices: ExtensionModelChoice[]; current: ExtensionModelChoice };

export async function loadExtensionCatalog(extension: { id: string; model: string }, refresh: boolean): Promise<Catalog> {
  if (extension.id === 'cshell.opencode')
    return await window.cshell.aiExtensionCall(extension.id, 'catalog', { reference: extension.model, refresh }) as Catalog;
  const choices = await window.cshell.aiExtensionCall(extension.id, 'choices', { reference: extension.model, refresh }) as ExtensionModelChoice[];
  const current = choices.find(c => c.ref === extension.model) ?? {
    ref: extension.model, model: extension.model, available: false, reason: '当前模型不可用，请选择其他模型',
  };
  return { choices, current };
}

export function useExtensionCatalog(extension?: { id: string; model: string }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [loading, setLoading] = useState(!!extension);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true, request = 0;
    setCatalog(undefined); setError(''); setLoading(!!extension);
    if (!extension) return;
    const load = async (refresh: boolean) => {
      if (!active) return;
      const id = ++request;
      try {
        const result = await loadExtensionCatalog(extension, refresh);
        if (active && id === request) { setCatalog(result); setError(''); }
      } catch (e) {
        if (active && id === request) {
          setCatalog(undefined);
          setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
        }
      } finally { if (active && id === request) setLoading(false); }
    };
    let foregroundRequest: Promise<void> | undefined;
    const foreground = () => {
      if (!active || document.visibilityState === 'hidden' || foregroundRequest) return;
      const pending = load(true);
      foregroundRequest = pending;
      void pending.finally(() => { if (foregroundRequest === pending) foregroundRequest = undefined; });
    };
    const unsubscribe = window.cshell.onAiProvidersChanged(() => void load(false));
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    void load(true);
    return () => {
      active = false; unsubscribe();
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [extension?.id, extension?.model, refreshKey]);
  return { catalog, loading, error, refresh: () => setRefreshKey(k => k + 1) };
}
