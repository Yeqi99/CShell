import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronRight, RefreshCw, Search } from 'lucide-react';
import type { AiProvider } from '../../shared/ai';
import type { ExtensionModelChoice } from '../use-extension-catalog';
import './ai-model-menu.css';
type Catalog = {
  accounts: {
    id: string;
    name: string;
    providerId?: string;
    choices: ExtensionModelChoice[];
    reason?: string;
  }[];
};
export function AiModelMenu({
  providers,
  providerId,
  model,
  disabled,
  onSelect,
  configure,
}: {
  providers: AiProvider[];
  providerId: string;
  model?: string;
  disabled: boolean;
  onSelect: (id: string, model?: string) => Promise<void>;
  configure: () => void;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState<'bases' | 'opencode'>('bases'),
    [query, setQuery] = useState(''),
    [catalog, setCatalog] = useState<Catalog>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [selecting, setSelecting] = useState(false),
    [position, setPosition] = useState({ left: 8, top: 8, width: 320, maxHeight: 360 });
  const anchor = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    request = useRef<Promise<void> | undefined>(undefined);
  const selected = providers.find((p) => p.id === providerId),
    selectedRef = model ?? selected?.extension?.model;
  useEffect(() => {
    if (!open) return;
    let active = true;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, innerWidth - 16),
        maxHeight = Math.min(440, Math.max(200, innerHeight - 32));
      setPosition({
        left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
        top: Math.max(8, rect.top - maxHeight - 8),
        width,
        maxHeight,
      });
    };
    const close = (event: PointerEvent) => {
      if (
        !anchor.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        anchor.current?.focus();
      }
    };
    const load = () => {
      if (!active || document.visibilityState === 'hidden' || request.current) return;
      setLoading(true);
      const job = (async () => {
        try {
          const value = (await window.cshell.aiExtensionCall('cshell.opencode', 'picker', {
            refresh: true,
          })) as Catalog;
          if (active) {
            setCatalog(value);
            setError('');
          }
        } catch (e) {
          if (active) {
            setCatalog(undefined);
            setError(
              (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''),
            );
          }
        } finally {
          if (active) setLoading(false);
        }
      })();
      request.current = job;
      void job.finally(() => {
        if (request.current === job) request.current = undefined;
      });
    };
    place();
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    const unsubscribe = window.cshell.onAiProvidersChanged(() => {
      if (!request.current) load();
    });
    const refresh = () => load();
    panel.current?.addEventListener('catalog-refresh', refresh);
    const element = panel.current;
    return () => {
      active = false;
      request.current = undefined;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
      element?.removeEventListener('catalog-refresh', refresh);
      unsubscribe();
    };
  }, [open]);
  const choose = async (id: string, reference?: string, accountId?: string) => {
    if (selecting || disabled) return;
    setSelecting(true);
    setError('');
    try {
      if (accountId) {
        const value = (await window.cshell.aiExtensionCall('cshell.opencode', 'connect', {
          id: accountId,
          reference,
        })) as { id: string };
        id = value.id;
      }
      await onSelect(id, reference);
      setOpen(false);
      anchor.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSelecting(false);
    }
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="agent-model-menu-trigger"
        aria-label="AI 基座与模型"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title="选择基座或 OpenCode 模型；已有会话保留"
        onClick={() => {
          setPage('bases');
          setQuery('');
          setOpen((v) => !v);
        }}
      >
        <span>
          {selected?.extension?.id === 'cshell.opencode' ? 'OpenCode · ' : ''}
          {selected?.extension ? selectedRef?.split('/').at(-1) : selected?.name || '选择模型'}
        </span>
        <ChevronRight size={12} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="agent-model-menu"
            role="dialog"
            aria-label="选择模型"
            style={position}
          >
            <header>
              {page === 'opencode' ? (
                <button
                  type="button"
                  className="icon"
                  aria-label="返回基座分类"
                  onClick={() => setPage('bases')}
                >
                  <ArrowLeft size={16} />
                </button>
              ) : null}
              <strong>{page === 'opencode' ? 'OpenCode' : '选择模型'}</strong>
              {page === 'opencode' && (
                <button
                  type="button"
                  className="icon"
                  aria-label="刷新 OpenCode 模型"
                  disabled={loading || selecting}
                  onClick={() => panel.current?.dispatchEvent(new Event('catalog-refresh'))}
                >
                  <RefreshCw size={14} />
                </button>
              )}
            </header>
            {page === 'bases' ? (
              <div className="agent-model-menu-list">
                {providers
                  .filter((p) => p.extension?.id !== 'cshell.opencode')
                  .map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      disabled={selecting}
                      onClick={() => void choose(p.id)}
                    >
                      <span>
                        <b>{p.name}</b>
                        <small>{p.model}</small>
                      </span>
                      {p.id === providerId && <Check size={14} />}
                    </button>
                  ))}
                <button
                  type="button"
                  className="agent-model-menu-category"
                  onClick={() => setPage('opencode')}
                >
                  <span>
                    <b>OpenCode</b>
                    <small>账号下的当前模型</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              </div>
            ) : (
              <>
                <label className="agent-model-menu-search">
                  <Search size={14} />
                  <input
                    type="search"
                    autoFocus
                    aria-label="搜索 OpenCode 模型"
                    placeholder="搜索模型"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="agent-model-menu-list" aria-busy={loading}>
                  {loading ? (
                    <p role="status">正在更新模型目录…</p>
                  ) : (
                    catalog?.accounts.map((account) => (
                      <section key={account.id}>
                        <h4>{account.name}</h4>
                        {account.reason && <p role="status">{account.reason}</p>}
                        {account.choices
                          .filter(
                            (c) =>
                              c.available &&
                              `${c.model} ${c.label ?? ''}`
                                .toLowerCase()
                                .includes(query.toLowerCase()),
                          )
                          .map((c) => (
                            <button
                              type="button"
                              key={c.ref}
                              disabled={selecting}
                              onClick={() =>
                                void choose(account.providerId ?? '', c.ref, account.id)
                              }
                            >
                              <span>
                                <b>{c.model}</b>
                                <small>
                                  {c.ref.split('/')[1] === 'go' ? 'Go 套餐' : 'Zen'}
                                  {/-free$/.test(c.model) ? ' · 免费模型' : ''}
                                </small>
                              </span>
                              {selectedRef === c.ref && <Check size={14} />}
                            </button>
                          ))}
                      </section>
                    ))
                  )}
                  {!loading && catalog?.accounts.length === 0 && (
                    <p>先在 OpenCode 扩展中登录或保存 Key，即可在这里选择模型。</p>
                  )}
                </div>
              </>
            )}
            {error && (
              <p className="agent-model-menu-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  configure();
                }}
              >
                管理基座与账号
              </button>
              {page === 'opencode' && <small>使用账号当前套餐与额度；切换不改写已有会话。</small>}
            </footer>
          </div>,
          document.body,
        )}
    </>
  );
}
