import {ErrorNotice} from './ErrorNotice';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronRight, Coins, Gauge, RefreshCw, Search } from 'lucide-react';
import { pluginEnabled } from '../../shared/plugins';
import { isPooledProvider } from '../../shared/official-models';
import type { AccountTraffic } from '../../shared/account-traffic';
import { useI18n } from '../i18n';
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
    [page, setPage] = useState<'bases' | 'opencode' | 'member'>('bases'),
    [query, setQuery] = useState(''),
    [catalog, setCatalog] = useState<Catalog>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [selecting, setSelecting] = useState(false),
    [position, setPosition] = useState<{left:number;top?:number;bottom?:number;width:number;maxHeight:number}>({ left: 8, top: 8, width: 320, maxHeight: 360 });
  const anchor = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    request = useRef<Promise<void> | undefined>(undefined);
  const selected = providers.find((p) => p.id === providerId),
    selectedRef = model ?? selected?.extension?.model;
  const search = query.trim().toLowerCase();
  const [week, setWeek] = useState<AccountTraffic['modelWeek']>();
  const [openCodeEnabled, setOpenCodeEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    window.cshell.plugins().then(plugins => {
      if (active) setOpenCodeEnabled(pluginEnabled(plugins, 'opencode'));
    }).catch(() => { if (active) setOpenCodeEnabled(false); });
    return () => { active = false; };
  }, [open]);
  const [isMember, setIsMember] = useState(false);
  const walletOwner = useRef<string | undefined>(undefined);
  const chinese = useI18n().locale === 'zh-CN';
  const memberLabel = chinese ? '会员模型' : 'Member models';
  const pooled = providers.filter(isPooledProvider);
  const remaining = week?.percent === undefined ? '—' : Math.floor(week.percent) + '%';
  const quotaLabel = (chinese ? '本周剩余额度 ' : 'Weekly allowance remaining ') + remaining;
  const reset = week?.resetAt ? new Date(week.resetAt * 1000).toLocaleString(chinese ? 'zh-CN' : 'en', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
  useEffect(() => {
    if (!window.cshell.cloudStatus || !window.cshell.cloudTraffic) return;
    let alive = true, generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const status = await window.cshell.cloudStatus();
        if (!alive || current !== generation) return;
        if (walletOwner.current !== status.email) {
          walletOwner.current = status.email;
          setWeek(undefined);
        }
        const entitled = !!status.email && !!status.membership?.active;
        setIsMember(entitled);
        if (!entitled) { setWeek(undefined); return; }
        const traffic = await window.cshell.cloudTraffic();
        if (alive && current === generation) setWeek(traffic.modelWeek);
      } catch {
        if (alive && current === generation) setWeek(undefined);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    const off = window.cshell.onCloudChanged?.(refresh);
    return () => { alive = false; clearInterval(timer); off?.(); };
  }, [open, disabled]);
  const visibleAccounts = catalog?.accounts.map(account => ({
    ...account,
    choices: account.choices.filter(choice => choice.available && `${choice.model} ${choice.label ?? ''}`.toLowerCase().includes(search)),
  })).filter(account => !search || account.choices.length > 0);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>(page === 'opencode' ? 'input[type="search"]' : 'button:not(:disabled)')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, page]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, innerWidth - 16),
        above = Math.max(0, rect.top - 16), below = Math.max(0, innerHeight - rect.bottom - 16),
        upwards = above >= below, maxHeight = Math.min(440, upwards ? above : below);
      setPosition({
        left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
        top: upwards ? undefined : Math.min(innerHeight - 8, rect.bottom + 8),
        bottom: upwards ? innerHeight - rect.top + 8 : undefined,
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
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        anchor.current?.focus();
      }
    };
    const load = () => {
      if (page !== 'opencode' || !openCodeEnabled || !active || document.visibilityState === 'hidden' || request.current) return;
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
  }, [open, page, openCodeEnabled]);
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
  function memberPresentation(provider: AiProvider) {
    const entry = week?.pools.flatMap(pool => pool.models).find(item => item.id === provider.model);
    const tier = entry?.costTier ?? entry?.tier;
    const fallback = provider.name.replace(/ · Pro$/, '');
    const title = entry?.name ? entry.name + (week?.pools.some(p => p.provider === 'kimi' && p.models.some(m => m.id === entry.id)) ? (chinese ? ' · Kimi 直连' : ' · Kimi direct') : '') : fallback.replace(/ · (?:极低|较高|极高|低|中|高)消耗$/, '');
    const cost = tier ? (chinese ? {minimal:'极低消耗',low:'低消耗',medium:'中消耗',elevated:'较高消耗',high:'高消耗',extreme:'极高消耗'} : {minimal:'Very low usage',low:'Low usage',medium:'Medium usage',elevated:'Elevated usage',high:'High usage',extreme:'Very high usage'})[tier] : fallback.match(/(?:极低|较高|极高|低|中|高)消耗$/)?.[0];
    const speed = entry?.speed;
    const speedLabel = speed && (chinese ? {fast:'速度快',normal:'速度适中',slow:'速度较慢',verySlow:'速度慢'} : {fast:'Fast',normal:'Moderate speed',slow:'Somewhat slow',verySlow:'Slow'})[speed.level];
    const speedInfo = speed && (chinese ? `首字 ${speed.first.toFixed(2)} 秒 · ${speed.cps.toFixed(1)} 字/秒 · ${speed.samples} 次实测` : `First text ${speed.first.toFixed(2)} s · ${speed.cps.toFixed(1)} chars/s · ${speed.samples} samples`);
    const description = [cost,speedLabel].filter(Boolean).join(' · ');
    const icons = <i className="member-model-metrics">
      {cost && <i title={cost}><Coins size={13}/>{tier && ['minimal','low','medium','elevated','high','extreme'].indexOf(tier)+1}</i>}
      {speed && <i title={[speedLabel,speedInfo].join(' · ')}><Gauge size={13}/>{['verySlow','slow','normal','fast'].indexOf(speed.level)+1}</i>}
    </i>;
    return {title, icons, description};
  }
  const member = selected && isPooledProvider(selected) ? memberPresentation(selected) : undefined;
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
        title={member ? [member.title,member.description].filter(Boolean).join(' · ') : '选择模型'}
        onClick={() => {
          setPage('bases');
          setError('');
          setQuery('');
          setOpen((v) => !v);
        }}
      >
        <span>
          {selected?.extension?.id === 'cshell.opencode' ? 'OpenCode · ' : ''}
          {selected?.extension ? selectedRef?.split('/').at(-1) : member?.title || selected?.name || '选择模型'}
        </span>
        {member?.icons}
        <ChevronRight size={12} />
      </button>
      {isMember && <button type="button" className="agent-model-quota"
        aria-label={quotaLabel} title={[quotaLabel, reset && (chinese ? '下次刷新 ' : 'Resets ') + reset].filter(Boolean).join(' · ')}
        onClick={() => { setError(''); setPage('member'); setOpen(true); }}>
        <Gauge size={14} aria-hidden="true"/><span>{remaining}</span>
      </button>}
      {open &&
        createPortal(
          <div
            ref={panel}
            className="agent-model-menu"
            role="dialog"
            aria-label="选择模型"
            style={position}
            onKeyDown={event => {
              if (event.key !== 'Tab') return;
              const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')].filter(element => element.offsetParent !== null);
              const index = controls.indexOf(document.activeElement as HTMLElement);
              if ((event.shiftKey && index === 0) || (!event.shiftKey && index === controls.length - 1)) {
                setOpen(false);
                anchor.current?.focus();
                if (event.shiftKey) event.preventDefault();
              }
            }}
          >
            <header>
              {page !== 'bases' ? (
                <button
                  type="button"
                  className="icon"
                  aria-label="返回基座分类"
                  onClick={() => { setError(''); setPage('bases'); }}
                >
                  <ArrowLeft size={16} />
                </button>
              ) : null}
              <strong>{page === 'opencode' ? 'OpenCode' : page === 'member' ? memberLabel : '选择模型'}</strong>
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
                {isMember && <button type="button" className="agent-model-menu-category" onClick={() => setPage('member')}>
                  <span><b>{memberLabel}</b><small>{quotaLabel}</small></span><ChevronRight size={15}/>
                </button>}
                {providers
                  .filter((p) => p.extension?.id !== 'cshell.opencode' && !isPooledProvider(p))
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
                {openCodeEnabled && <button
                  type="button"
                  className="agent-model-menu-category"
                  onClick={() => { setError(''); setPage('opencode'); }}
                >
                  <span>
                    <b>OpenCode</b>
                    <small>账号下的当前模型</small>
                  </span>
                  <ChevronRight size={15} />
                </button>}
              </div>
            ) : page === 'member' ? (
              <div className="agent-model-menu-list">
                <p>{quotaLabel}{reset && ' · ' + (chinese ? '下次刷新 ' : 'Resets ') + reset}</p>
                {pooled.map(provider => {
                  const {title,icons,description} = memberPresentation(provider);
                  return <button key={provider.id} title={[title,description].filter(Boolean).join(' · ')} aria-label={[title,description].filter(Boolean).join(' ')} type="button" disabled={selecting || disabled} onClick={() => void choose(provider.id)}>
                    <span><b>{title}</b></span>{icons}{provider.id === providerId && <Check size={14}/>}
                  </button>;
                })}
                {pooled.length === 0 && <p role="status">{chinese ? '当前没有可选的会员模型。' : 'No member models are currently available.'}</p>}
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
                    visibleAccounts?.map((account) => (
                      <section key={account.id}>
                        <h4>{account.name}</h4>
                        {account.reason && <p role="status">{account.reason}</p>}
                        {!account.reason && account.choices.length === 0 && <p role="status">当前账号暂无可用模型，刷新目录或检查账号设置。</p>}
                        {account.choices
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
                  {!loading && !!search && !!catalog?.accounts.length && visibleAccounts?.length === 0 && <p role="status">未找到匹配的模型，请尝试其他名称。</p>}
                  {!loading && catalog?.accounts.length === 0 && (
                    <p>先在 OpenCode 扩展中登录或保存 Key，即可在这里选择模型。</p>
                  )}
                </div>
              </>
            )}
            {error && (
              <ErrorNotice title="操作未完成" error={error}/>
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
