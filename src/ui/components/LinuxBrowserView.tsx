import { useEffect, useRef, useState } from 'react';
import { AppWindow, Power, Send, Globe, SlidersHorizontal, Keyboard, X } from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
type Frame = {
  data: string;
  width: number;
  height: number;
  windows: { id: string; title: string; minimized?: boolean }[];
};
export function LinuxBrowserView({
  call,
  active,
  onMarket,
  onMinimize,
}: {
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
  active: boolean;
  onMarket: () => void;
  onMinimize?: () => void;
}) {
  const [status, setStatus] = useState<any>(),
    [frame, setFrame] = useState<Frame>(),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmClose, setConfirmClose] = useState(false),
    [toolsOpen, setToolsOpen] = useState(false),
    [compose, setCompose] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null),
    sendRef = useRef<(value: unknown) => void>(() => {});
  const alive = useRef(true),
    queue = useRef(Promise.resolve()),
    queued = useRef(0),
    currentActive = useRef(active),
    moveTime = useRef(0),
    epoch = useRef(0);
  currentActive.current = active;
  const minimizeRef = useRef(onMinimize);
  minimizeRef.current = onMinimize;
  useEffect(() => {
    if (!active) {
      epoch.current++;
      void call('visual.input', { type: 'release' }).catch(() => {});
    }
  }, [active, call]);
  useEffect(() => {
    alive.current = true;
    void call('visual.status')
      .then(setStatus)
      .catch((e) => setError(String(e)));
    return () => {
      alive.current = false;
    };
  }, [call]);
  useEffect(() => {
    if (!active || !status?.running) return;
    let stopped = false;
    let restoring = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = (await call('visual.frame')) as Frame;
        if (stopped) return;
        if (restoring) {
          restoring = false;
          const hidden = next.windows.find((w) => w.minimized) ?? next.windows[0];
          if (hidden) await call('visual.input', { type: 'window', id: hidden.id });
          return;
        }
        if (
          next.windows.length &&
          next.windows.every((w) => w.minimized === true) &&
          minimizeRef.current
        ) {
          minimizeRef.current();
          return;
        }
        if (!stopped) {
          setFrame(next);
          setError('');
        }
      } catch (e) {
        if (!stopped) {
          setFrame(undefined);
          setError(String(e));
        }
      } finally {
        if (!stopped) timer = setTimeout(tick, 180);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [call, active, status?.running]);
  const input = (value: unknown) => {
    if (!frame || queued.current >= 24) return;
    queued.current++;
    const revision = epoch.current;
    queue.current = queue.current
      .then(async () => {
        if (!alive.current || !currentActive.current || epoch.current !== revision) return;
        await call('visual.input', value);
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      })
      .finally(() => queued.current--);
  };
  const launch = async () => {
    setBusy(true);
    setError('');
    try {
      await call('visual.launch', { app: 'browser' });
      setStatus(await call('visual.status'));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    setBusy(true);
    try {
      await call('visual.close');
      setFrame(undefined);
      setConfirmClose(false);
      setStatus(await call('visual.status'));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const position = (e: React.MouseEvent | React.WheelEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(
        (frame?.width ?? 1440) - 1,
        Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (frame?.width ?? 1440))),
      ),
      y: Math.min(
        (frame?.height ?? 900) - 1,
        Math.max(0, Math.round(((e.clientY - r.top) / r.height) * (frame?.height ?? 900))),
      ),
    };
  };
  sendRef.current = input;
  useEffect(() => {
    const img = imageRef.current;
    if (!img || !active) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = img.getBoundingClientRect();
      sendRef.current({
        type: 'wheel',
        x: Math.min(
          (frame?.width ?? 1440) - 1,
          Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (frame?.width ?? 1440))),
        ),
        y: Math.min(
          (frame?.height ?? 900) - 1,
          Math.max(0, Math.round(((e.clientY - r.top) / r.height) * (frame?.height ?? 900))),
        ),
        deltaY: Math.max(
          -2000,
          Math.min(
            2000,
            Math.round(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1)),
          ),
        ),
      });
    };
    img.addEventListener('wheel', wheel, { passive: false });
    return () => img.removeEventListener('wheel', wheel);
  }, [active, !!frame, frame?.width, frame?.height]);
  return (
    <section className="linux-browser" aria-label="Linux 可视化应用">
      <div className="linux-browser-tools">
        <button
          title="远端操作"
          aria-label="远端操作"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen(!toolsOpen)}
        >
          <SlidersHorizontal size={16} />
        </button>
        {toolsOpen && (
          <div className="linux-browser-tools-menu">
            <button
              disabled={!frame?.windows.length}
              onClick={() => {
                if (frame?.windows[0]) input({ type: 'window', id: frame.windows[0].id });
                setToolsOpen(false);
              }}
            >
              恢复远端窗口
            </button>
            <button
              onClick={() => {
                setCompose(!compose);
                setToolsOpen(false);
              }}
            >
              <Keyboard size={16} />
              输入文字
            </button>
            {frame && frame.windows.length > 1 && (
              <select
                aria-label="远端窗口"
                onChange={(e) => input({ type: 'window', id: e.target.value })}
              >
                {frame.windows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            )}
            <button
              disabled={busy || !status?.running}
              onClick={() => {
                setConfirmClose(true);
                setToolsOpen(false);
              }}
            >
              <Power size={16} />
              结束远端应用
            </button>
          </div>
        )}
      </div>
      {confirmClose && (
        <div className="linux-browser-confirm">
          <span>结束远端应用？未保存内容可能丢失。</span>
          <button disabled={busy} onClick={() => void close()}>
            结束应用
          </button>
          <button onClick={() => setConfirmClose(false)}>取消</button>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!status?.installed || !status.applications?.some((a: any) => a.available) ? (
        <div className="linux-empty">
          <AppWindow size={40} />
          <h2>Linux 可视化应用</h2>
          <p>先安装图形运行环境和浏览器。应用窗口在远端运行。</p>
          <button onClick={onMarket}>前往应用市场</button>
        </div>
      ) : !status.running ? (
        <div className="linux-empty">
          <Globe size={40} />
          <h2>打开远端浏览器</h2>
          <p>使用这台服务器的网络访问网页。</p>
          <button disabled={busy} onClick={() => void launch()}>
            {busy ? '正在启动…' : '打开浏览器'}
          </button>
        </div>
      ) : (
        <>
          <div className="linux-browser-viewport">
            {frame ? (
              <img
                ref={imageRef}
                src={'data:image/jpeg;base64,' + frame.data}
                alt="远端 Linux 应用画面"
                tabIndex={0}
                draggable={false}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.focus();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  input({
                    type: 'pointer',
                    phase: 'down',
                    ...position(e),
                    button: e.button === 2 ? 'right' : 'left',
                  });
                }}
                onPointerMove={(e) => {
                  if (
                    !e.currentTarget.hasPointerCapture(e.pointerId) ||
                    Date.now() - moveTime.current < 60
                  )
                    return;
                  moveTime.current = Date.now();
                  input({ type: 'pointer', phase: 'move', ...position(e) });
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  input({ type: 'pointer', phase: 'up', ...position(e) });
                }}
                onPointerCancel={() =>
                  void call('visual.input', { type: 'release' }).catch(() => {})
                }
                onBlur={() => void call('visual.input', { type: 'release' }).catch(() => {})}
                onDoubleClick={(e) =>
                  input({ type: 'click', ...position(e), button: 'left', count: 2 })
                }
                onContextMenu={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.metaKey || e.altKey) return;
                  const shortcuts: Record<string, string> = {
                    a: 'selectAll',
                    c: 'copy',
                    x: 'cut',
                    l: 'address',
                    t: 'newTab',
                    w: 'closeTab',
                  };
                  if (e.ctrlKey && e.key.toLowerCase() === 'v') return;
                  e.preventDefault();
                  if (e.ctrlKey && shortcuts[e.key.toLowerCase()])
                    input({ type: 'shortcut', key: shortcuts[e.key.toLowerCase()] });
                  else if (e.key.length === 1 && !e.ctrlKey) input({ type: 'text', text: e.key });
                  else if (
                    [
                      'Enter',
                      'Tab',
                      'Backspace',
                      'Delete',
                      'Escape',
                      'ArrowLeft',
                      'ArrowRight',
                      'ArrowUp',
                      'ArrowDown',
                      'Home',
                      'End',
                      'PageUp',
                      'PageDown',
                      'F5',
                      'F11',
                    ].includes(e.key)
                  )
                    input({ type: 'key', key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey });
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  input({ type: 'text', text: e.clipboardData.getData('text').slice(0, 10000) });
                }}
              />
            ) : (
              <p role="status">{error ? '画面不可用，输入已暂停' : '正在读取远端画面…'}</p>
            )}
          </div>
          {compose && (
            <form
              className="linux-browser-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (text) {
                  input({ type: 'text', text });
                  setText('');
                }
              }}
            >
              <input
                aria-label="向远端输入文字"
                placeholder="中文或长文本：先点击远端输入框，再在这里输入并发送"
                value={text}
                maxLength={10000}
                onChange={(e) => setText(e.target.value)}
              />
              <button disabled={!frame || !text} title="发送到远端当前输入框" aria-label="发送文字">
                <Send size={16} />
              </button>
              <button
                type="button"
                title="收起文字输入"
                aria-label="收起文字输入"
                onClick={() => setCompose(false)}
              >
                <X size={16} />
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
