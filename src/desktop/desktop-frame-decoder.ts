import { BrowserWindow, session } from 'electron';
import type { DesktopViewEvent } from '../shared/desktop-view';
import { abortable } from '../core/desktop-automation';

let decoderSession: Promise<Electron.Session> | undefined;
function secureDecoderSession() {
  return (decoderSession ??= (async () => {
    // WebCodecs requires a secure context. This nonpersistent partition handles
    // HTTPS entirely in-process; it can never make an external network request.
    const value = session.fromPartition('cshell-desktop-image-decoder');
    value.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    value.setPermissionCheckHandler(() => false);
    value.protocol.handle(
      'https',
      (request) =>
        new Response(
          request.url === 'https://cshell-decoder.invalid/'
            ? '<title>CShell desktop decoder</title>'
            : '',
          {
            status: request.url === 'https://cshell-decoder.invalid/' ? 200 : 403,
            headers: {
              'Content-Type': 'text/html',
              'Content-Security-Policy': "default-src 'none'; img-src data:",
            },
          },
        ),
    );
    return value;
  })());
}

/** A trusted blank decoder page, never a browsable remote page or extension process. */
function decodeFrame(input: {
  data: string;
  timestamp: number;
  maxWidth: number;
  quality: number;
}) {
  return new Promise<{ dataBase64: string; width: number; height: number }>((resolve, reject) => {
    const bytes = Uint8Array.from(atob(input.data), (c) => c.charCodeAt(0));
    let codec: string | undefined;
    for (let i = 0; i + 7 < bytes.length; i++) {
      let n = -1;
      if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) n = i + 3;
      else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1)
        n = i + 4;
      if (n >= 0 && (bytes[n] & 31) === 7 && n + 3 < bytes.length) {
        codec =
          'avc1.' +
          [bytes[n + 1], bytes[n + 2], bytes[n + 3]]
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('');
        break;
      }
    }
    if (!codec || typeof VideoDecoder === 'undefined') {
      reject(Error('无法解码当前桌面画面'));
      return;
    }
    const timer = setTimeout(() => {
      try {
        decoder.close();
      } catch {}
      reject(Error('桌面画面解码超时'));
    }, 5000);
    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          const scale = Math.min(
              1,
              input.maxWidth / Math.max(frame.displayWidth, frame.displayHeight),
            ),
            canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(frame.displayWidth * scale));
          canvas.height = Math.max(1, Math.round(frame.displayHeight * scale));
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw Error('无法创建截图画布');
          context.drawImage(frame, 0, 0, canvas.width, canvas.height);
          const dataBase64 = canvas.toDataURL('image/jpeg', input.quality / 100).split(',')[1];
          resolve({ dataBase64, width: canvas.width, height: canvas.height });
        } catch (error) {
          reject(error);
        } finally {
          frame.close();
          clearTimeout(timer);
          decoder.close();
        }
      },
      error: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      decoder.configure({
        codec,
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-software',
      });
      decoder.decode(
        new EncodedVideoChunk({ type: 'key', timestamp: input.timestamp, data: bytes }),
      );
      void decoder.flush().catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    } catch (error) {
      clearTimeout(timer);
      try {
        decoder.close();
      } catch {}
      reject(error);
    }
  });
}
export async function decodeDesktopFrame(
  frame: Extract<DesktopViewEvent, { type: 'frame' }>,
  options: { maxWidth: number; quality: number },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (frame.data.byteLength > 16 * 1024 * 1024) throw Error('桌面压缩画面超过安全大小');
  const privateSession = await secureDecoderSession();
  signal.throwIfAborted();
  const window = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      session: privateSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  const stop = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  signal.addEventListener('abort', stop, { once: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    await abortable(window.loadURL('https://cshell-decoder.invalid/'), signal);
    const result = (await abortable(
      window.webContents.executeJavaScript(
        `(${decodeFrame.toString()})(${JSON.stringify({ data: Buffer.from(frame.data).toString('base64'), timestamp: frame.timestamp, ...options })})`,
      ),
      signal,
    )) as { dataBase64: string; width: number; height: number };
    if (Buffer.byteLength(result.dataBase64, 'base64') > 2 * 1024 * 1024)
      throw Error('截图超过 2 MiB，请降低分辨率或质量');
    return result;
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
  }
}
