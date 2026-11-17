import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import {
  browserSnapshotInput,
  browserSnapshotOutput,
  screenshotOutput,
} from '../shared/visual-tools';
import { captureBrowserView, isolatedFrameOperation } from './browser-frames';

const WORLD = 987;
/** This fixed function is the entire page-side protocol. Callers cannot supply code. */
function pageOperation(args: any) {
  const root = globalThis as typeof globalThis & {
    __cshellTools?: {
      id: string;
      revision: number;
      captured: number;
      refs: Map<string, Element>;
      redactions: Set<string>;
      observer: MutationObserver;
    };
  };
  let state = root.__cshellTools;
  if (!state) {
    state = {
      id: '',
      revision: 0,
      captured: 0,
      refs: new Map(),
      redactions: new Set(),
      observer: new MutationObserver(() => {
        root.__cshellTools!.revision++;
      }),
    };
    state.observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    root.__cshellTools = state;
  }
  const scrub = (value: string) => {
    for (const secret of [...state!.redactions].sort((a, b) => b.length - a.length))
      value = value.split(secret).join('[输入内容已隐藏]');
    return value;
  };
  const protect = (value: string) => {
    if (!value || state!.redactions.has(value)) return;
    if (
      state!.redactions.size >= 256 ||
      [...state!.redactions].reduce((n, s) => n + s.length, 0) + value.length > 1048576
    )
      throw Error('此页面输入已达保护容量，请关闭该标签页后重新打开');
    state!.redactions.add(value);
  };
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const toggle = (el: Element): el is HTMLInputElement =>
    el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
  const labels = (el: Element) => toggle(el) ? Array.from(el.labels ?? []).filter(visible) : [];
  if (args.action === 'snapshot') {
    state.refs.clear();
    state.id = args.id;
    state.captured = state.revision;
    const roots: (Document | ShadowRoot)[] = [document];
    for (let i = 0; i < roots.length && roots.length < 64; i++)
      for (const el of roots[i].querySelectorAll('*'))
        if (el.shadowRoot && roots.length < 64) {
          roots.push(el.shadowRoot);
          state.observer.observe(el.shadowRoot, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
        }
    const all = roots
      .flatMap((root) => [
        ...root.querySelectorAll(
          'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],[role="radio"],[role="checkbox"],[contenteditable="true"]',
        ),
      ])
      .filter(el => visible(el) || labels(el).length > 0);
    const elements = all.slice(0, args.maxElements).map((e, i) => {
      const ref = 'e' + (i + 1);
      state!.refs.set(ref, e);
      const input = e as HTMLInputElement;
      const label =
        e.getAttribute('aria-label') ||
        (input.labels ? [...input.labels].map((l) => l.innerText).join(' ') : '') ||
        (e as HTMLElement).innerText ||
        e.getAttribute('title') ||
        e.getAttribute('placeholder') ||
        '';
      return {
        ref,
        role: e.getAttribute('role') || (toggle(e) ? e.type : e.tagName.toLowerCase()),
        ...(toggle(e) ? { checked: e.checked } : {}),
        name: scrub(label.trim()).slice(0, 1000),
        tag: e.tagName.toLowerCase(),
        ...(e.tagName === 'A' ? { href: scrub((e as HTMLAnchorElement).href).slice(0, 8192) } : {}),
        disabled: !!input.disabled || e.getAttribute('aria-disabled') === 'true',
      };
    });
    const text =
      (document.body?.innerText || '') +
      roots
        .slice(1)
        .map(
          (root) =>
            '\n' + [...root.children].map((e) => (e as HTMLElement).innerText || '').join('\n'),
        )
        .join('');
    return {
      tabId: args.tabId,
      ...(args.frameId ? { frameId: args.frameId } : {}),
      snapshotId: args.id,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollY,
        documentHeight: document.scrollingElement?.scrollHeight ?? innerHeight,
        headings: Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,[role="heading"]'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
            const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
            if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false;
            return el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) &&
              el.contains(document.elementFromPoint(x, y));
          })
          .slice(0, 24)
          .map(el => scrub(el.innerText).trim().slice(0, 200)),
      },
      url: scrub(location.href).slice(0, 8192),
      title: scrub(document.title).slice(0, 1000),
      text: scrub(text).slice(0, args.maxText),
      truncated: text.length > args.maxText || all.length > args.maxElements,
      elements,
    };
  }
  if (args.action === 'text')
    return {
      url: scrub(location.href).slice(0, 8192),
      title: scrub(document.title).slice(0, 1000),
      text: scrub(document.body?.innerText || '').slice(0, args.maxText),
    };
  if (args.action === 'scroll') {
    const before = { x: scrollX, y: scrollY };
    window.scrollBy({ left: args.x, top: args.y, behavior: "instant" });
    return { scrollX, scrollY, moved: before.x !== scrollX || before.y !== scrollY };
  }
  if (state.id !== args.snapshotId || state.captured !== state.revision)
    throw Error('页面已变化，请重新读取 browser_snapshot');
  const e = state.refs.get(args.ref) as HTMLElement | undefined;
  if (!e?.isConnected || (!visible(e) && !labels(e).length)) throw Error('元素已不可用，请重新读取 browser_snapshot');
  if ((e as HTMLInputElement).disabled || e.getAttribute('aria-disabled') === 'true')
    throw Error('元素已禁用');
  if (args.action === 'click') {
    for (const candidate of [e, ...labels(e)]) {
      if (!visible(candidate)) continue;
      candidate.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = candidate.getBoundingClientRect();
      const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
      const upper = Math.max(0, r.top), lower = Math.min(innerHeight, r.bottom);
      if (right <= left || lower <= upper) continue;
      for (const [fx, fy] of [[0.5,0.5],[0.2,0.2],[0.8,0.2],[0.2,0.8],[0.8,0.8]]) {
        const x = left + (right - left) * fx, y = upper + (lower - upper) * fy;
        let top = document.elementFromPoint(x, y);
        while (top?.shadowRoot) {
          const inner = top.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === top) break;
          top = inner;
        }
        if (!top || !candidate.contains(top)) continue;
        if (candidate !== e && top !== e && top.closest('a[href],button,input,textarea,select,[contenteditable="true"]')) continue;
        if (args.frameId) {
          candidate.click();
          return { clicked: true };
        }
        return { x, y };
      }
    }
    throw Error('元素被遮挡，请重新读取页面');
  }
  if (args.action === 'fill') {
    if (
      e instanceof HTMLInputElement &&
      ['file', 'hidden', 'checkbox', 'radio', 'submit', 'button'].includes(e.type)
    )
      throw Error('此控件不支持填入文本');
    if ((e as HTMLInputElement).readOnly) throw Error('此控件只读');
    protect(args.text);
    e.focus();
    if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
      const prototype =
        e instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(e, args.text);
    } else if (e.isContentEditable) e.textContent = args.text;
    else throw Error('此控件不支持填入文本');
    e.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }),
    );
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return {};
  }
  if (args.action === 'select') {
    if (
      !(e instanceof HTMLSelectElement) ||
      ![...e.options].some((o) => o.value === args.value && !o.disabled)
    )
      throw Error('选项不可用');
    protect(args.value);
    e.value = args.value;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return {};
  }
  throw Error('不支持的网页操作');
}
export async function runPageOperation(
  contents: WebContents,
  args: Record<string, unknown>,
  guard?: () => void,
) {
  const source = `Promise.resolve().then(()=>(${pageOperation.toString()})(${JSON.stringify(args)})).then(value=>({ok:true,value}),error=>({ok:false,error:String(error.message||error).slice(0,1000)}))`;
  guard?.();
  const result =
    typeof args.frameId === 'string'
      ? await isolatedFrameOperation(contents, args.frameId, source, guard)
      : await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: source }], true);
  if (!result?.ok) throw Error(result?.error || '网页操作未返回有效结果');
  return result.value;
}
export async function readBrowserSnapshot(contents: WebContents, raw: unknown, guard?: () => void) {
  const p = browserSnapshotInput.parse(raw);
  return browserSnapshotOutput.parse(
    await runPageOperation(contents, { action: 'snapshot', ...p, id: randomUUID() }, guard),
  );
}
// Electron may leave capturePage pending when a background view has no compositor frame.
async function waitForCapture<T>(start: () => Promise<T>, signal: AbortSignal, timeoutMs: number) {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Browser capture timed out')), timeoutMs);
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([start(), deadline]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export async function captureBrowser(
  contents: WebContents,
  target: string,
  maxWidth: number,
  quality: number,
  guard: () => void,
  signal: AbortSignal,
) {
  let image: Electron.NativeImage;
  try {
    image = await waitForCapture(() => contents.capturePage(undefined, { stayAwake: true }), signal, 8_000);
    if (image.isEmpty()) throw Error('empty capture');
  } catch (error) {
    signal.throwIfAborted();
    if (!/UnknownVizError|display surface|empty capture|failed to capture|capture timed out/i.test(String(error))) throw error;
    guard?.();
    const { nativeImage } = await import('electron');
    try {
      const frame = await waitForCapture(() => captureBrowserView(contents, quality, guard), signal, 8_000);
      image = nativeImage.createFromBuffer(frame);
      if (image.isEmpty()) throw Error('empty capture');
    } catch (fallbackError) {
      guard?.();
      throw Error('网页截图暂不可用；请用 browser_snapshot 检查页面并通过 browser_interact 验证行为，报告截图未取得。', { cause: fallbackError });
    }
  }
  guard?.();
  const original = image.getSize();
  if (!original.width || !original.height) throw Error('网页尚未生成可捕获画面');
  const scale = Math.min(1, maxWidth / Math.max(original.width, original.height));
  const resized =
    scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(original.width * scale)),
          height: Math.max(1, Math.round(original.height * scale)),
        })
      : image;
  const data = resized.toJPEG(quality),
    size = resized.getSize();
  if (data.byteLength > 2 * 1024 * 1024) throw Error('截图超过 2 MiB，请降低分辨率或质量');
  return screenshotOutput.parse({
    mimeType: 'image/jpeg',
    dataBase64: data.toString('base64'),
    ...size,
    target,
    frameId: randomUUID(),
  });
}
