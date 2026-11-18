import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionTool } from '../core/connections/contracts';

const localUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
const selector = z.string().min(1).max(1000);
const input = z
  .object({
    operation: z.discriminatedUnion('action', [
      z
        .object({
          action: z.literal('open'),
          url: z.string().url().refine(localUrl, '请使用本机开发服务器地址'),
        })
        .strict(),
      z.object({ action: z.enum(['inspect', 'close']) }).strict(),
      z.object({ action: z.literal('click'), selector }).strict(),
      z.object({ action: z.literal('fill'), selector, text: z.string().max(8000) }).strict(),
      z
        .object({
          action: z.literal('resize'),
          width: z.number().int().min(320).max(2560),
          height: z.number().int().min(240).max(1600),
        })
        .strict(),
    ]),
    screenshot: z.boolean().default(false),
  })
  .strict();

export class LocalBrowserTests {
  private windows = new Map<string, { window: BrowserWindow; errors: string[] }>();
  tool(owner: string): ConnectionTool {
    return {
      name: 'local_desktop_browser',
      capability: 'local.desktop',
      description:
        'Test a localhost web app in a dedicated Chromium window for this conversation. Open HTTP(S), inspect visible text, accessible labels, viewport overflow and console errors, click/fill by unique CSS selector, resize for responsive tests, capture the page, close.',
      input,
      needsReview: (a) => input.parse(a).operation.action !== 'inspect',
      invoke: async (raw, signal) => {
        const { operation: op, screenshot } = input.parse(raw);
        let test = this.windows.get(owner);
        if (op.action === 'open' && !test) {
          if (this.windows.size >= 6) throw Error('请关闭一个浏览器测试窗口');
          const isolated = session.fromPartition('cshell-browser-test-' + randomUUID());
          isolated.setPermissionRequestHandler((_w, _p, cb) => cb(false));
          isolated.setPermissionCheckHandler(() => false);
          isolated.on('will-download', (e) => e.preventDefault());
          const window = new BrowserWindow({
            width: 1024,
            height: 768,
            useContentSize: true,
            webPreferences: {
              session: isolated,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          test = { window, errors: [] };
          this.windows.set(owner, test);
          const errors = test.errors;
          window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          window.webContents.on('will-navigate', (e, url) => {
            if (!localUrl(url)) e.preventDefault();
          });
          window.webContents.on('will-redirect', (e, url) => {
            if (!localUrl(url)) e.preventDefault();
          });
          window.webContents.on('console-message', (details) => {
            if (details.level === 'error') {
              errors.push(details.message.slice(0, 800));
              if (errors.length > 10) errors.shift();
            }
          });
          window.once('closed', () => this.windows.delete(owner));
        }
        if (!test) throw Error('请先打开本机测试网页');
        const { window, errors } = test,
          web = window.webContents;
        if (op.action === 'close') {
          window.destroy();
          return '{"closed":true}';
        }
        signal.throwIfAborted();
        if (op.action === 'open') {
          errors.length = 0;
          const stop = () => web.stop();
          signal.addEventListener('abort', stop, { once: true });
          const timer = setTimeout(stop, 30000);
          try {
            await web.loadURL(op.url);
          } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', stop);
          }
        }
        if (op.action === 'resize') window.setContentSize(op.width, op.height);
        if (op.action === 'fill' || op.action === 'click') {
          const point = await web.executeJavaScript(
            `(()=>{const matches=document.querySelectorAll(${JSON.stringify(op.selector)});if(matches.length!==1)throw Error('选择器必须匹配一个元素');const el=matches[0];el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);if(!el.contains(document.elementFromPoint(x,y)))throw Error('元素被遮挡或不可见');if(${op.action === 'fill'}){if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement)||el.disabled||el.readOnly)throw Error('请选择可编辑的输入框');el.focus();el.select()}return {x,y}})()`,
          );
          signal.throwIfAborted();
          if (op.action === 'fill') await web.insertText(op.text);
          else
            for (const type of ['mouseDown', 'mouseUp'] as const)
              web.sendInputEvent({ ...point, type, button: 'left', clickCount: 1 });
        }
        await new Promise((r) => setTimeout(r, 120));
        signal.throwIfAborted();
        const state = await web.executeJavaScript(
          `(()=>({title:document.title,url:location.href,width:innerWidth,height:innerHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,text:(document.body?.innerText||'').slice(0,4000),controls:Array.from(document.querySelectorAll('a,button,input,select,textarea,[role=button]')).filter(el=>el.getClientRects().length).slice(0,40).map(el=>({tag:el.tagName,id:el.id,label:(el.getAttribute('aria-label')||el.labels?.[0]?.innerText||el.innerText||el.getAttribute('placeholder')||'').slice(0,100)}))}))()`,
        );
        state.errors = [...errors];
        if(screenshot){const image=await web.capturePage();const frame=image.getSize();const scaled=frame.width>1600||frame.height>1600?image.resize(frame.width>=frame.height?{width:1600}:{height:1600}):image;
          state.image={mimeType:'image/jpeg',dataBase64:scaled.toJPEG(75).toString('base64'),...scaled.getSize(),target:'本机浏览器',frameId:randomUUID(),capturedAt:Date.now()};}
        return JSON.stringify(state);
      },
    };
  }
  dispose() {
    for (const t of this.windows.values()) t.window.destroy();
    this.windows.clear();
  }
}
