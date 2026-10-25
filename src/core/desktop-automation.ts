import { randomUUID } from 'node:crypto';
import {
  desktopCaptureInput,
  desktopInteractInput,
  screenshotOutput,
} from '../shared/visual-tools';
import type { DesktopViewEvent, DesktopViewInput } from '../shared/desktop-view';

type Frame = Extract<DesktopViewEvent, { type: 'frame' }>;
export interface DesktopAutomationHost {
  start(input: {
    id: string;
    target: string;
    control: boolean;
    quality: { fps: number; bitrate: number; display: number; adaptive: boolean };
  }): Promise<{ generation?: number; control: boolean }>;
  stop(id: string): Promise<unknown>;
  input(id: string, event: DesktopViewInput, generation: number): unknown;
  release(id: string, generation: number): unknown;
  ack(
    id: string,
    sequence: string,
    decoded: boolean,
    decodeMs: number,
    generation: number,
  ): unknown;
  subscribe(listener: (event: DesktopViewEvent) => void): () => void;
  status(target: string, signal: AbortSignal): Promise<unknown>;
  validate(target: string): void;
  decode(
    frame: Frame,
    options: { maxWidth: number; quality: number },
    signal: AbortSignal,
  ): Promise<{ dataBase64: string; width: number; height: number }>;
}
export function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? Error('操作已取消'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? Error('操作已取消'));
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
/** Short-lived authenticated views. No ticket escapes the host and input is never replayed. */
export class DesktopAutomation {
  private busy = new Set<string>();
  constructor(
    private host: DesktopAutomationHost,
    private timeoutMs = 20000,
  ) {}
  async invoke(
    target: string,
    action: string,
    raw: unknown,
    parent: AbortSignal,
    authorize?: () => void,
  ) {
    parent.throwIfAborted();
    authorize?.();
    this.host.validate(target);
    if (action === 'status') return this.host.status(target, parent);
    const capture = action === 'capture' ? desktopCaptureInput.parse(raw) : undefined;
    const input = action === 'interact' ? desktopInteractInput.parse(raw) : undefined;
    if (!capture && !input) throw Error('未知桌面工具操作');
    if (this.busy.has(target)) throw Error('此机器正在执行另一项桌面工具操作');
    this.busy.add(target);
    const controller = new AbortController(),
      signal = controller.signal,
      id = randomUUID();
    const abort = () => controller.abort(parent.reason ?? Error('操作已取消'));
    parent.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(Error('桌面工具等待真实画面超时')),
      this.timeoutMs,
    );
    timer.unref();
    let generation = 1,
      finished = false,
      processing = false,
      settled = false;
    let resolveFrame!: (result: {
        frame: Frame;
        image?: { dataBase64: string; width: number; height: number };
      }) => void,
      rejectFrame!: (error: unknown) => void;
    const ready = new Promise<{
      frame: Frame;
      image?: { dataBase64: string; width: number; height: number };
    }>((resolve, reject) => {
      resolveFrame = resolve;
      rejectFrame = reject;
    });
    void ready.catch(() => {});
    const guard = () => {
      signal.throwIfAborted();
      authorize?.();
      this.host.validate(target);
    };
    const off = this.host.subscribe((event) => {
      if (event.id !== id || finished) return;
      if (event.type === 'state') {
        if (event.state === 'reconnecting') {
          controller.abort(Error('桌面连接中断，操作未重放'));
          return;
        }
        generation = event.generation ?? 1;
      }
      if (event.type === 'closed' || event.type === 'error') {
        rejectFrame(Error(event.type === 'closed' ? event.reason : event.message));
        return;
      }
      if (event.type !== 'frame') return;
      if (processing || settled || !event.key) {
        try {
          this.host.ack(id, event.sequence, false, 0, event.generation ?? generation);
        } catch {}
        return;
      }
      processing = true;
      const started = performance.now();
      void (async () => {
        try {
          guard();
          const image = capture ? await this.host.decode(event, capture, signal) : undefined;
          guard();
          this.host.ack(
            id,
            event.sequence,
            true,
            performance.now() - started,
            event.generation ?? generation,
          );
          settled = true;
          resolveFrame({ frame: event, image });
        } catch (error) {
          rejectFrame(error);
        } finally {
          processing = false;
        }
      })();
    });
    try {
      const started = await abortable(
        this.host.start({
          id,
          target,
          control: !!input,
          quality: { fps: 10, bitrate: 4000000, display: 0, adaptive: true },
        }),
        signal,
      );
      generation = started.generation ?? generation;
      guard();
      if (input && !started.control) throw Error('远端未授予键鼠控制权限');
      const frame = await abortable(ready, signal);
      guard();
      if (capture)
        return screenshotOutput.parse({
          mimeType: 'image/jpeg',
          ...frame.image,
          target,
          frameId: frame.frame.sequence,
        });
      const send = (event: DesktopViewInput) => {
        guard();
        return this.host.input(id, event, generation);
      };
      if (input!.action === 'click') {
        send({ kind: 'move', x: input!.x, y: input!.y });
        for (let i = 0; i < input!.count; i++) {
          send({
            kind: 'button',
            button: { left: 0, right: 1, middle: 2 }[input!.button],
            down: true,
          });
          send({
            kind: 'button',
            button: { left: 0, right: 1, middle: 2 }[input!.button],
            down: false,
          });
        }
      } else if (input!.action === 'move') send({ kind: 'move', x: input!.x, y: input!.y });
      else if (input!.action === 'scroll')
        send({ kind: 'wheel', delta: input!.delta, horizontal: input!.horizontal });
      else if (input!.action === 'text') send({ kind: 'text', text: input!.text });
      else if (input!.action === 'key') {
        for (const code of input!.modifiers) send({ kind: 'key', code, down: true });
        send({ kind: 'key', code: input!.code, down: true });
        send({ kind: 'key', code: input!.code, down: false });
        for (const code of [...input!.modifiers].reverse())
          send({ kind: 'key', code, down: false });
      } else this.host.release(id, generation);
      return { completed: true, target };
    } finally {
      finished = true;
      off();
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
      controller.abort();
      try {
        await this.host.release(id, generation);
      } catch {}
      try {
        await this.host.stop(id);
      } finally {
        this.busy.delete(target);
      }
    }
  }
}
