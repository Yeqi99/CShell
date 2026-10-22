import { browserSuggestions } from '../../core/browser-interactions';
import { ErrorNotice } from './ErrorNotice';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Plus,
  Globe,
  Server,
  Star,
  History,
  Bookmark,
  Trash2,
  ShieldCheck,
  Minimize2,
} from 'lucide-react';
import type { MachineBrowserState } from '../../shared/machine-browser';
import './machine-browser.css';
export function MachineBrowser({
  target,
  name,
  active,
  appUrl,
}: {
  target: string;
  name: string;
  active: boolean;
  appUrl?: string;
}) {
  const [library, setLibrary] = useState<'' | 'history' | 'bookmarks'>('');
  const lifecycle = useRef(0);
  const [suggest, setSuggest] = useState(false),
    [suggestIndex, setSuggestIndex] = useState(-1),
    [clearConfirm, setClearConfirm] = useState(false);
  const session = target.startsWith('ssh:') ? target.slice(4) : target,
    slot = useRef<HTMLDivElement>(null),
    addressInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<MachineBrowserState>({
      tabs: [],
      selected: '',
      connected: true,
    }),
    [address, setAddress] = useState(''),
    [error, setError] = useState('');
  useEffect(
    () =>
      window.cshell.onMachineBrowserFocus((id) => {
        if (id === session) {
          addressInput.current?.focus();
          addressInput.current?.select();
        }
      }),
    [session],
  );
  const run = async (action: string, value?: unknown) => {
    const generation = lifecycle.current;
    try {
      setError('');
      const next = await window.cshell.machineBrowser(session, action, value);
      if (generation !== lifecycle.current) return;
      setState(next);
      return next;
    } catch (e) {
      if (generation === lifecycle.current) setError(String(e));
    }
  };
  useEffect(() => {
    lifecycle.current++;
    let cancelled = false;
    setState({ tabs: [], selected: '', connected: true });
    setLibrary('');
    setSuggest(false);
    setClearConfirm(false);
    void run('open').then((opened) => {
      if (opened && appUrl && !cancelled) void run('navigate', appUrl);
    });
    const timer = setInterval(() => {
      void window.cshell
        .machineBrowser(session, 'status')
        .then((s) => {
          if (!cancelled) setState(s);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    }, 500);
    return () => {
      cancelled = true;
      lifecycle.current++;
      clearInterval(timer);
      void window.cshell.machineBrowser(session, 'hide').catch(() => {});
    };
  }, [session, appUrl]);
  const suggestions = browserSuggestions(address, state.history || [], state.bookmarks || []);
  const navigate = (url: string) => {
    setSuggest(false);
    setClearConfirm(false);
    setAddress(url);
    void run('navigate', url);
  };
  const selected = state.tabs.find((t) => t.id === state.selected);
  useEffect(() => {
    setAddress(selected?.url === 'about:blank' ? '' : selected?.url || '');
  }, [state.selected, selected?.url]);
  useEffect(() => {
    let cancelled = false,
      last = '';
    const update = () => {
      if (cancelled) return;
      const el = slot.current,
        b = el?.getBoundingClientRect();
      let visible = !!(
        active &&
        !library &&
        !(suggest && suggestions.length > 0) &&
        !clearConfirm &&
        state.connected &&
        selected?.url &&
        selected.url !== 'about:blank' &&
        !selected.error &&
        b &&
        b.width > 1 &&
        b.height > 1
      );
      if (visible && b && el) {
        const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        visible = !!top && (top === el || el.contains(top));
      }
      const value = {
        x: Math.max(0, Math.round(b?.x || 0)),
        y: Math.max(0, Math.round(b?.y || 0)),
        width: Math.floor(b?.width || 0),
        height: Math.floor(b?.height || 0),
        visible,
      };
      const key = JSON.stringify([value, state.selected]);
      if (key === last) return;
      last = key;
      void window.cshell.machineBrowser(session, 'bounds', value).catch(() => {});
    };
    update();
    const timer = setInterval(update, 80);
    return () => {
      cancelled = true;
      clearInterval(timer);
      void window.cshell.machineBrowser(session, 'hide').catch(() => {});
    };
  }, [
    session,
    active,
    appUrl,
    library,
    suggest,
    suggestions.length,
    clearConfirm,
    selected?.fullscreen,
    state.connected,
    state.selected,
    selected?.url,
    selected?.error,
  ]);
  return (
    <section
      className={'machine-browser' + (appUrl ? ' machine-browser-app' : '')}
      data-fullscreen={!!selected?.fullscreen}
      aria-label="CShell 浏览器"
    >
      {selected?.fullscreen && (
        <div className="machine-browser-fullscreen-bar">
          <span>{selected.title}</span>
          <button onClick={() => void run('exit-fullscreen')}>
            <Minimize2 size={15} />
            退出全屏 · Esc
          </button>
        </div>
      )}
      <div className="machine-browser-tabs" role="tablist" aria-label="网页标签">
        {state.tabs.map((tab) => (
          <div
            className="machine-browser-tab"
            key={tab.id}
            data-selected={tab.id === state.selected}
          >
            <button
              role="tab"
              aria-selected={tab.id === state.selected}
              onClick={() => void run('select', tab.id)}
            >
              <Globe size={14} />
              <span>{tab.title}</span>
            </button>
            <button
              title="关闭标签页"
              aria-label={'关闭网页 ' + tab.title}
              onClick={() => void run('close', tab.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button title="新建标签页" aria-label="新建网页标签" onClick={() => void run('new')}>
          <Plus size={16} />
        </button>
      </div>
      <form
        className="machine-browser-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(
            suggestIndex >= 0 && suggestions[suggestIndex]
              ? suggestions[suggestIndex].url
              : address,
          );
        }}
      >
        <button
          type="button"
          title="后退"
          aria-label="网页后退"
          disabled={!selected?.back}
          onClick={() => void run('back')}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          title="前进"
          aria-label="网页前进"
          disabled={!selected?.forward}
          onClick={() => void run('forward')}
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          title={selected?.loading ? '停止加载' : '刷新网页'}
          aria-label={selected?.loading ? '停止加载' : '刷新网页'}
          onClick={() => void run(selected?.loading ? 'stop' : 'reload')}
        >
          {selected?.loading ? <X size={16} /> : <RotateCw size={16} />}
        </button>
        <input
          ref={addressInput}
          aria-label="网页地址"
          placeholder="输入网址"
          value={address}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggest && suggestions.length > 0}
          aria-controls={'browser-suggestions-' + session}
          aria-activedescendant={
            suggestIndex >= 0 ? 'suggestion-' + session + '-' + suggestIndex : undefined
          }
          onFocus={() => {
            setSuggest(true);
            setSuggestIndex(-1);
          }}
          onBlur={() => setTimeout(() => setSuggest(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSuggest(false);
              setSuggestIndex(-1);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSuggest(true);
              setSuggestIndex((i) =>
                Math.max(0, Math.min(suggestions.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
              );
            }
          }}
          onChange={(e) => {
            setAddress(e.target.value);
            setSuggest(true);
            setSuggestIndex(-1);
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <select
          aria-label="网页缩放"
          title="网页缩放"
          value={selected?.zoom ?? 0.9}
          onChange={(e) => void run('zoom', Number(e.target.value))}
        >
          {[0.5, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 2].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
        <button
          type="button"
          title="收藏当前网页"
          aria-label="收藏当前网页"
          aria-pressed={!!state.bookmarks?.some((e) => e.url === selected?.url)}
          disabled={!selected?.url?.startsWith('http')}
          onClick={() =>
            void run('bookmark', {
              url: selected?.url,
              title: (selected?.title || '网页').slice(0, 256),
            })
          }
        >
          <Star size={16} />
        </button>
        <button
          type="button"
          title="历史记录"
          aria-label="历史记录"
          aria-pressed={library === 'history'}
          onClick={() => setLibrary(library === 'history' ? '' : 'history')}
        >
          <History size={16} />
        </button>
        <button
          type="button"
          title="收藏夹"
          aria-label="收藏夹"
          aria-pressed={library === 'bookmarks'}
          onClick={() => setLibrary(library === 'bookmarks' ? '' : 'bookmarks')}
        >
          <Bookmark size={16} />
        </button>
        <button
          type="button"
          title="清除登录状态"
          aria-label="清除登录状态"
          onClick={() => {
            setSuggest(false);
            setClearConfirm(!clearConfirm);
          }}
        >
          <ShieldCheck size={16} />
        </button>
        <span className="machine-browser-route" title={'网页请求通过 ' + name}>
          <Server size={14} />
          {name}
        </span>
      </form>
      {suggest && suggestions.length > 0 && (
        <div
          className="machine-browser-suggestions"
          role="listbox"
          id={'browser-suggestions-' + session}
        >
          {suggestions.map((entry, i) => (
            <button
              type="button"
              role="option"
              aria-selected={suggestIndex === i}
              id={'suggestion-' + session + '-' + i}
              key={entry.url}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => navigate(entry.url)}
            >
              <History size={15} />
              <span>
                <strong>{entry.title || entry.url}</strong>
                <small>{entry.url}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {clearConfirm && (
        <section className="machine-browser-confirm">
          <h3>清除 {name} 的网站登录状态？</h3>
          <p>
            将关闭这台机器的浏览器标签页，删除
            Cookie、网站存储和缓存。历史记录与收藏夹会保留，其他机器不受影响。
          </p>
          <button
            onClick={() =>
              void run('clear-logins', { confirm: true }).then((result) => {
                if (result) setClearConfirm(false);
              })
            }
          >
            确认清除
          </button>
          <button onClick={() => setClearConfirm(false)}>取消</button>
        </section>
      )}
      {(error || !state.connected) && (
        <ErrorNotice title={!state.connected ? '服务器连接已断开' : '网页操作未完成'} error={!state.connected ? '服务器已断开，请重新连接；未切换本地网络' : error} />
      )}
      {state.persistenceError && (
        <ErrorNotice title="浏览器资料未能保存" error={state.persistenceError} />
      )}
      {library && (
        <section
          className="machine-browser-library"
          aria-label={library === 'history' ? '浏览历史' : '网页收藏夹'}
        >
          <header>
            <h2>{library === 'history' ? '历史记录' : '收藏夹'}</h2>
            <button title="返回网页" aria-label="返回网页" onClick={() => setLibrary('')}>
              <X size={16} />
            </button>
          </header>
          {!state[library]?.length && (
            <p>这里还没有{library === 'history' ? '浏览记录' : '收藏的网页'}。</p>
          )}
          {(state[library] || []).map((entry) => (
            <div className="machine-browser-entry" key={entry.url}>
              <button
                onClick={() => {
                  setLibrary('');
                  void (state.tabs.length
                    ? run('navigate', entry.url)
                    : run('new').then((created) => created && run('navigate', entry.url)));
                }}
              >
                <strong>{entry.title || entry.url}</strong>
                <small>{entry.url}</small>
              </button>
              {library === 'bookmarks' ? (
                <button
                  title="取消收藏"
                  aria-label={'取消收藏 ' + entry.title}
                  onClick={() => void run('bookmark', { url: entry.url, title: entry.title })}
                >
                  <Star size={16} />
                </button>
              ) : (
                <>
                  <time>{new Date(entry.at).toLocaleDateString()}</time>
                  <button
                    title="删除这条历史记录"
                    aria-label={'删除历史 ' + entry.title}
                    onClick={() => void run('remove-history', entry.url)}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          ))}
          {library === 'history' && !!state.history?.length && (
            <button onClick={() => void run('clear-history')}>
              <Trash2 size={15} />
              清空浏览历史
            </button>
          )}
        </section>
      )}
      <div ref={slot} className="machine-browser-surface" hidden={!!library}>
        {selected?.error ? (
          <div className="machine-browser-start">
            <Globe size={32} />
            <h2>网页未能加载</h2>
            <p>{selected.error}</p>
            <button onClick={() => void run('reload')}>重试</button>
          </div>
        ) : (
          (!selected?.url || selected.url === 'about:blank') && (
            <div className="machine-browser-start">
              <Globe size={40} />
              <h2>浏览器</h2>
              <p>通过 {name} 访问网页</p>
              <small>网页在本机显示，缓存与登录状态按机器独立保存。</small>
            </div>
          )
        )}
      </div>
    </section>
  );
}
