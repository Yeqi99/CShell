import { useEffect, useRef, useState } from 'react';
import { Monitor, Square, SlidersHorizontal } from 'lucide-react';
import {
  desktopQualitySchema,
  type DesktopVideoInfo,
  type DesktopQuality,
} from '../../shared/agent-desktop';
import { desktopScanCode, h264Codec } from '../desktop-keys';
import type { DesktopViewInput } from '../../shared/desktop-view';
import './agent-desktop-view.css';

export function AgentDesktopView({
  target,
  canView,
  canControl,
}: {
  target: string;
  canView: boolean;
  canControl: boolean;
}) {
  const [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [reconnecting, setReconnecting] = useState(''),
    [control, setControl] = useState(false),
    [error, setError] = useState(''),
    [info, setInfo] = useState<DesktopVideoInfo>();
  const [quality, setQuality] = useState<DesktopQuality>({
    fps: 60,
    bitrate: 12000000,
    display: 0,
    adaptive: true,
  });
  const canvas = useRef<HTMLCanvasElement>(null),
    id = useRef(''),
    decoder = useRef<VideoDecoder | null>(null),
    codec = useRef('');
  const wireGeneration = useRef(1);
  const generation = useRef(0),
    permissions = useRef({ canView, canControl });
  permissions.current = { canView, canControl };
  const awaiting = useRef<{ sequence: string; at: number } | null>(null),
    controlling = useRef(false),
    pointer = useRef<{ x: number; y: number } | null>(null),
    raf = useRef(0);
  const stopDecoder = () => {
    try {
      decoder.current?.close();
    } catch {}
    decoder.current = null;
    codec.current = '';
    awaiting.current = null;
  };
  const ack = (decoded: boolean) => {
    const pending = awaiting.current;
    awaiting.current = null;
    if (pending && id.current)
      void window.cshell
        .desktopViewAck(
          id.current,
          pending.sequence,
          decoded,
          performance.now() - pending.at,
          wireGeneration.current,
        )
        .catch(() => {});
  };
  const release = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    pointer.current = null;
    if (id.current)
      void window.cshell.desktopViewRelease(id.current, wireGeneration.current).catch(() => {});
  };
  const input = (event: DesktopViewInput) => {
    const session = id.current;
    if (!session || !controlling.current || !permissions.current.canControl) return;
    const wire = wireGeneration.current;
    void window.cshell.desktopViewInput(session, event, wire).catch((e) => {
      if (id.current !== session) return;
      if (wire !== wireGeneration.current) return;
      setError(String(e));
      controlling.current = false;
      setControl(false);
      release();
    });
  };
  useEffect(() => {
    generation.current++;
    setActive(false);
    setReconnecting('');
    setBusy(false);
    setInfo(undefined);
    setError('');
    setControl(false);
    const off = window.cshell.onDesktopViewEvent((event) => {
      if (event.id !== id.current) return;
      if ((event.generation ?? 1) < wireGeneration.current) return;
      if (event.type === 'state') {
        release();
        stopDecoder();
        wireGeneration.current = event.generation ?? 1;
        const ready = event.state === 'connected';
        controlling.current = ready && event.control && permissions.current.canControl;
        setControl(controlling.current);
        setActive(true);
        setBusy(false);
        setReconnecting(
          ready ? '' : '正在重连（第 ' + event.attempt + ' 次，' + event.delayMs / 1000 + ' 秒后）',
        );
        return;
      }
      if (event.type === 'config') {
        setInfo(event.info);
        return;
      }
      if (event.type === 'closed') {
        generation.current++;
        setError(event.reason);
        setActive(false);
        setReconnecting('');
        setBusy(false);
        controlling.current = false;
        release();
        id.current = '';
        stopDecoder();
        return;
      }
      if (event.type === 'error') {
        setError(event.message);
        return;
      }
      if (awaiting.current) {
        void window.cshell
          .desktopViewAck(event.id, event.sequence, false, 0, wireGeneration.current)
          .catch(() => {});
        return;
      }
      awaiting.current = { sequence: event.sequence, at: performance.now() };
      try {
        if (typeof VideoDecoder === 'undefined') throw new Error('当前客户端不支持视频解码');
        const next = event.key ? h264Codec(event.data) : undefined;
        if (next && next !== codec.current) {
          try {
            decoder.current?.close();
          } catch {}
          codec.current = next;
          const session = event.id;
          const instance = new VideoDecoder({
            output: (frame) => {
              try {
                if (id.current !== session || decoder.current !== instance) return;
                const c = canvas.current;
                if (c) {
                  if (c.width !== frame.displayWidth) c.width = frame.displayWidth;
                  if (c.height !== frame.displayHeight) c.height = frame.displayHeight;
                  c.getContext('2d', { alpha: false })?.drawImage(frame, 0, 0, c.width, c.height);
                }
                ack(true);
              } finally {
                frame.close();
              }
            },
            error: (e) => {
              if (id.current !== session || decoder.current !== instance) return;
              setError('视频解码失败：' + e.message);
              ack(false);
              stopDecoder();
            },
          });
          decoder.current = instance;
          instance.configure({
            codec: next,
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
          });
        }
        if (
          !decoder.current ||
          decoder.current.state !== 'configured' ||
          decoder.current.decodeQueueSize > 1
        ) {
          ack(false);
          return;
        }
        decoder.current.decode(
          new EncodedVideoChunk({
            type: event.key ? 'key' : 'delta',
            timestamp: event.timestamp,
            data: event.data as Uint8Array<ArrayBuffer>,
          }),
        );
      } catch (e) {
        setError(String(e));
        ack(false);
        stopDecoder();
      }
    });
    const blur = () => release();
    window.addEventListener('blur', blur);
    const hidden = () => {
      if (document.hidden) release();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      generation.current++;
      off();
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      release();
      const old = id.current;
      id.current = '';
      controlling.current = false;
      stopDecoder();
      if (old) void window.cshell.desktopViewStop(old).catch(() => {});
    };
  }, [target]);
  useEffect(() => {
    if (!canControl) {
      controlling.current = false;
      setControl(false);
      release();
    }
    if (!canView) {
      generation.current++;
      const old = id.current;
      release();
      id.current = '';
      controlling.current = false;
      setActive(false);
      setBusy(false);
      stopDecoder();
      if (old) void window.cshell.desktopViewStop(old).catch(() => {});
    }
  }, [canView, canControl]);
  const start = async () => {
    if (id.current || !permissions.current.canView) return;
    const validated = validateQuality();
    if (!validated) return;
    setBusy(true);
    setError('');
    setInfo(undefined);
    const key = crypto.randomUUID(),
      epoch = ++generation.current;
    id.current = key;
    wireGeneration.current = 1;
    try {
      const result = await window.cshell.desktopViewStart({
        id: key,
        target,
        quality: validated,
        control: control && canControl,
      });
      if (epoch !== generation.current || id.current !== key || !permissions.current.canView) {
        void window.cshell.desktopViewStop(key).catch(() => {});
        return;
      }
      setActive(true);
      controlling.current = result.control && permissions.current.canControl;
      setControl(controlling.current);
      if (!controlling.current) release();
    } catch (e) {
      if (epoch === generation.current && id.current === key) {
        setError(String(e));
        id.current = '';
        stopDecoder();
      }
      void window.cshell.desktopViewStop(key).catch(() => {});
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  const stop = async () => {
    const epoch = ++generation.current,
      key = id.current;
    release();
    id.current = '';
    controlling.current = false;
    setActive(false);
    setReconnecting('');
    setBusy(false);
    stopDecoder();
    if (key)
      await window.cshell.desktopViewStop(key).catch((e) => {
        if (epoch === generation.current) setError(String(e));
      });
  };
  const key = (event: React.KeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    if (!controlling.current) return;
    const code = desktopScanCode(event.code);
    if (!code) return;
    event.preventDefault();
    if (!event.repeat) input({ kind: 'key', code, down });
  };
  const validateQuality = () => {
    const parsed = desktopQualitySchema.safeParse(quality);
    if (
      !parsed.success ||
      ['fps', 'bitrate', 'display', 'width', 'height'].some((field) => {
        const value = quality[field as keyof DesktopQuality];
        return (
          value !== undefined &&
          (typeof value !== 'number' || !Number.isSafeInteger(value) || value > 0xffffffff)
        );
      })
    ) {
      setError('请填写有效的整数帧率、码率和分辨率；显示器编号从 0 开始。');
      return null;
    }
    return parsed.data;
  };
  const applyQuality = async () => {
    const validated = validateQuality(),
      session = id.current;
    if (!validated || !session) return;
    try {
      await window.cshell.desktopViewQuality(session, validated, wireGeneration.current);
    } catch (e) {
      if (id.current === session) setError(String(e));
    }
  };
  return (
    <section className="agent-desktop-view" aria-label="CAgent 远程桌面">
      <div className="desktop-toolbar">
        <strong>
          <Monitor size={16} />
          远程桌面
        </strong>
        {!active ? (
          <>
            <label>
              <input
                type="checkbox"
                checked={control}
                disabled={!canControl || busy}
                onChange={(e) => setControl(e.target.checked)}
              />
              允许键鼠控制
            </label>
            <button className="primary" disabled={busy || !canView} onClick={() => void start()}>
              {busy ? '连接中…' : '连接桌面'}
            </button>
          </>
        ) : (
          <>
            <span>{control ? '键鼠控制' : '仅观看'}</span>
            <button onClick={() => void stop()}>
              <Square size={13} />
              断开
            </button>
          </>
        )}
        {busy && <button onClick={() => void stop()}>取消连接</button>}
        <details>
          <summary title="画质设置">
            <SlidersHorizontal size={16} />
            画质
          </summary>
          <div className="desktop-quality">
            <label>
              目标帧率
              <input
                type="number"
                min={1}
                value={quality.fps}
                onChange={(e) => setQuality({ ...quality, fps: Number(e.target.value) })}
              />
            </label>
            <label>
              目标码率（Mbps）
              <input
                type="number"
                min={0.001}
                step={1}
                value={quality.bitrate / 1000000}
                onChange={(e) =>
                  setQuality({ ...quality, bitrate: Math.round(Number(e.target.value) * 1000000) })
                }
              />
            </label>
            <label>
              显示器编号
              <input
                type="number"
                min={0}
                disabled={active}
                value={quality.display}
                onChange={(e) => setQuality({ ...quality, display: Number(e.target.value) })}
              />
            </label>
            <label>
              目标宽度
              <input
                type="number"
                min={1}
                placeholder="原生宽度"
                value={quality.width ?? ''}
                onChange={(e) =>
                  setQuality({
                    ...quality,
                    width: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              目标高度
              <input
                type="number"
                min={1}
                placeholder="原生高度"
                value={quality.height ?? ''}
                onChange={(e) =>
                  setQuality({
                    ...quality,
                    height: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
            <small>宽高留空使用原生分辨率，实际输出以编码器支持与返回结果为准。</small>
            <label>
              <input
                type="checkbox"
                checked={quality.adaptive}
                onChange={(e) => setQuality({ ...quality, adaptive: e.target.checked })}
              />
              根据网络自动调整
            </label>
            {active && <button onClick={() => void applyQuality()}>应用画质</button>}
          </div>
        </details>
      </div>
      {reconnecting && (
        <p role="status" className="desktop-info">
          {reconnecting}
        </p>
      )}
      {info && (
        <p className="desktop-info">
          {info.width} × {info.height} · {info.encoder} · {info.hardware ? '硬件编码' : '软件编码'}
        </p>
      )}
      {(active || busy) && (
        <div className="desktop-screen">
          <canvas
            ref={canvas}
            tabIndex={0}
            aria-label={control ? '远程桌面，点击后输入' : '远程桌面，仅观看'}
            width={1}
            height={1}
            onBlur={release}
            onKeyDown={(e) => key(e, true)}
            onKeyUp={(e) => key(e, false)}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.currentTarget.focus();
              if (controlling.current) {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                input({
                  kind: 'button',
                  button: [0, 2, 1, 3, 4][e.button] ?? e.button,
                  down: true,
                });
              }
            }}
            onPointerUp={(e) => {
              if (controlling.current) {
                e.preventDefault();
                input({
                  kind: 'button',
                  button: [0, 2, 1, 3, 4][e.button] ?? e.button,
                  down: false,
                });
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={release}
            onPointerMove={(e) => {
              if (!controlling.current) return;
              const r = e.currentTarget.getBoundingClientRect();
              pointer.current = {
                x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
              };
              if (!raf.current)
                raf.current = requestAnimationFrame(() => {
                  raf.current = 0;
                  const p = pointer.current;
                  if (p) input({ kind: 'move', ...p });
                });
            }}
            onWheel={(e) => {
              if (controlling.current) {
                input({
                  kind: 'wheel',
                  delta: Math.max(-32768, Math.min(32767, Math.round(-e.deltaY))),
                  horizontal: false,
                });
              }
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
