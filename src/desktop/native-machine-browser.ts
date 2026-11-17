import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'ssh2';
import type { chromium as Chromium } from 'playwright';
import { browserUrl } from '../core/browser-library';

export function installedEdge() {
  if (process.platform !== 'win32') return undefined;
  return [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter((root): root is string => !!root)
    .map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    .find(path => existsSync(path));
}

export function sshBrowserTimezone(client: Client): Promise<string> {
  const command = "timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || readlink /etc/localtime";
  return new Promise((resolve, reject) => {
    let channel: import('ssh2').ClientChannel | undefined;
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      channel?.close();
      reject(Error('读取机器时区超时，请检查 SSH 连接'));
    }, 8000);
    client.exec(command, (error, stream) => {
      if (error) { clearTimeout(timer); reject(error); return; }
      if (expired) { stream.close(); return; }
      channel = stream;
      let output = '';
      stream.on('data', (chunk: Buffer) => { output = (output + chunk).slice(0, 256); });
      stream.once('error', (err: Error) => { clearTimeout(timer); reject(err); });
      stream.once('close', () => {
        clearTimeout(timer);
        resolve(output.trim().replace(/^.*\/zoneinfo\//, ''));
      });
    });
  });
}

export async function openMachineEdge(url: string, port: number, lifetime: AbortSignal, timezone: string) {
  const exe = installedEdge();
  if (!exe || !browserUrl(url) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('浏览器、网页地址或机器代理端口不可用');
  if (!timezone) throw Error('机器没有报告时区，请检查连接或更新 CAgent');
  const timezoneId = new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
  lifetime.throwIfAborted();
  const { chromium }: { chromium: typeof Chromium } = require(join(__dirname, 'machine-edge-runtime'));
  const browser = await chromium.launch({
    executablePath: exe, headless: false,
    proxy: { server: 'socks5://127.0.0.1:' + port, bypass: '<-loopback>' },
    args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  const close = () => { void browser.close().catch(() => {}); };
  lifetime.addEventListener('abort', close, { once: true });
  browser.once('disconnected', () => lifetime.removeEventListener('abort', close));
  try {
    lifetime.throwIfAborted();
    const context = await browser.newContext({ timezoneId, viewport: null });
    context.on('page', page => page.once('close', () => { if (!context.pages().length) close(); }));
    const tab = await context.newPage();
    await tab.goto(url, { waitUntil: 'commit' });
  } catch (error) {
    close();
    throw error;
  }
}
