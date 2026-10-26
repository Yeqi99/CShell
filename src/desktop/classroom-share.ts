import { createSocket, type Socket } from 'node:dgram';
import { createServer, get, type Server } from 'node:http';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { randomBytes } from 'node:crypto';
import { isIPv4 } from 'node:net';
import type { ClassroomBridge, ClassroomFrame, ClassroomScreen, ClassroomSource, ClassroomStatus } from '../shared/classroom';

const GROUP = '239.255.72.83', PORT = 47883;
const MAX_FRAME = 3 * 1024 * 1024, TTL = 7000, FRAME_INTERVAL = 200;
type Captured = { jpeg: Buffer; capturedAt: number };
type Source = ClassroomSource & { port: number; token: string };
type Interfaces = Record<string, NetworkInterfaceInfo[] | undefined>;
export interface ClassroomCapture {
  screens(): Promise<ClassroomScreen[]>;
  capture(screenId: string): Promise<Buffer>;
}
export const electronClassroomCapture: ClassroomCapture = {
  async screens() {
    const { desktopCapturer } = await import('electron');
    return (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }))
      .map(s => ({ id: s.id, name: s.name }));
  },
  async capture(screenId) {
    const { desktopCapturer } = await import('electron');
    const source = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } })).find(s => s.id === screenId);
    if (!source || source.thumbnail.isEmpty()) throw new Error('无法采集所选屏幕，请检查屏幕是否仍连接');
    return source.thumbnail.toJPEG(65);
  },
};
function ipNumber(ip: string): number { return ip.split('.').reduce((n, v) => ((n << 8) | Number(v)) >>> 0, 0); }
export function sameClassroomLan(address: string, interfaces: Interfaces): boolean {
  if (!isIPv4(address) || address.startsWith('127.') || address === '0.0.0.0') return false;
  return Object.values(interfaces).flat().some(i => i && i.family === 'IPv4' && !i.internal && isIPv4(i.netmask)
    && i.netmask !== '0.0.0.0' && (ipNumber(address) & ipNumber(i.netmask)) === (ipNumber(i.address) & ipNumber(i.netmask)));
}
export function parseClassroomAnnouncement(bytes: Buffer, address: string, now: number): Source | null {
  if (bytes.length > 1024 || !isIPv4(address)) return null;
  try {
    const p = JSON.parse(bytes.toString('utf8'));
    if (p.protocol !== 'cshell-classroom-v1' || p.kind !== 'share' || !/^[a-f0-9]{32}$/.test(p.id)
      || !/^[a-f0-9]{64}$/.test(p.token) || !Number.isInteger(p.port) || p.port < 1024 || p.port > 65535
      || typeof p.label !== 'string' || !p.label.trim() || p.label.length > 60 || /[\u0000-\u001f\u007f]/.test(p.label)) return null;
    return { id: p.id, token: p.token, port: p.port, label: p.label, address, lastSeen: now };
  } catch { return null; }
}
function bounded<T>(task: Promise<T>, ms = 4000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([task, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('屏幕共享请求超时')), ms); })])
    .finally(() => clearTimeout(timer));
}
export class ClassroomShareService implements ClassroomBridge {
  private readonly capture: ClassroomCapture;
  private readonly platform: string;
  private readonly interfaces: () => Interfaces;
  private udp: Socket | null = null;
  private socketOpening: Promise<void> | null = null;
  private server: Server | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private discovering = false;
  private sharing: ClassroomStatus['sharing'] = null;
  private token = '';
  private sources = new Map<string, Source>();
  private rates = new Map<string, { at: number; count: number }>();
  private cache: Captured | null = null;
  private capturing: Promise<Captured> | null = null;
  private error: string | null = null;
  private generation = 0;
  private starting = false;
  private reads = 0;
  private outgoing = 0;
  constructor(options: { capture?: ClassroomCapture; platform?: string; interfaces?: () => Interfaces } = {}) {
    this.capture = options.capture ?? electronClassroomCapture;
    this.platform = options.platform ?? process.platform;
    this.interfaces = options.interfaces ?? networkInterfaces;
  }
  private supported() { if (this.platform !== 'win32') throw new Error('屏幕共享首版仅支持 Windows'); }
  async screens() { this.supported(); return bounded(this.capture.screens()); }
  async status(): Promise<ClassroomStatus> {
    const now = Date.now();
    for (const [id, s] of this.sources) if (now - s.lastSeen > TTL) this.sources.delete(id);
    return { supported: this.platform === 'win32', discovering: this.discovering, sharing: this.sharing ? { ...this.sharing } : null,
      sources: [...this.sources.values()].map(({ id, label, address, lastSeen }) => ({ id, label, address, lastSeen })), error: this.error };
  }
  private allowed(address: string) { return sameClassroomLan(address, this.interfaces()); }
  private rate(key: string, max: number) {
    const now = Date.now();
    for (const [k, r] of this.rates) if (now - r.at >= 1000) this.rates.delete(k);
    const r = this.rates.get(key) ?? { at: now, count: 0 };
    if (!this.rates.has(key) && this.rates.size >= 256) return false;
    this.rates.set(key, r);return ++r.count <= max;
  }
  private openDiscoverySocket(): Promise<void> {
    if (this.socketOpening) return this.socketOpening;
    const task = this.bindDiscoverySocket().finally(() => { if (this.socketOpening === task) this.socketOpening = null; });
    this.socketOpening = task;return task;
  }
  private async bindDiscoverySocket() {
    if (this.udp) return;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });this.udp = socket;
    socket.on('message', (bytes, remote) => {
      if (!this.discovering || !this.allowed(remote.address) || !this.rate('udp:' + remote.address, 12)) return;
      const source = parseClassroomAnnouncement(bytes, remote.address, Date.now());
      if (!source || source.id === this.sharing?.id || (!this.sources.has(source.id) && this.sources.size >= 64)) return;
      const existing = this.sources.get(source.id);
      if (existing && (existing.address !== source.address || existing.token !== source.token || existing.port !== source.port)) return;
      this.sources.set(source.id, source);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const closed = () => reject(new Error('发现启动已取消'));
        socket.once('error', reject);socket.once('close', closed);
        socket.bind(PORT, '0.0.0.0', () => { socket.removeListener('error', reject);socket.removeListener('close', closed);resolve(); });
      });
      socket.on('error', () => { this.error = '局域网发现不可用，请检查本机网络和防火墙'; });
      socket.setMulticastTTL(1);socket.setMulticastLoopback(true);
      let joined = 0;
      for (const i of Object.values(this.interfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) {
        try { socket.addMembership(GROUP, i.address);joined++; } catch { /* Another interface may still work. */ }
      }
      if (!joined) throw new Error('没有可用的局域网 IPv4 接口');
      this.timer = setInterval(() => this.announce(), 2000);this.timer.unref();
    } catch (e) { this.closeSocket();throw e; }
  }
  private announce() {
    if (!this.udp || !this.sharing) return;
    const data = Buffer.from(JSON.stringify({ protocol: 'cshell-classroom-v1', kind: 'share', id: this.sharing.id,
      label: this.sharing.label, token: this.token, port: this.sharing.port }));
    for (const i of Object.values(this.interfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) {
      try { this.udp.setMulticastInterface(i.address);this.udp.send(data, PORT, GROUP, () => {}); } catch { this.error = '共享已开启，但局域网公告发送失败'; }
    }
  }
  private closeSocket() {
    if (this.timer) clearInterval(this.timer);this.timer = null;
    try { this.udp?.close(); } catch { /* Bind may already have failed. */ } this.udp = null;
  }
  async setDiscovery(enabled: boolean) {
    this.supported();if (typeof enabled !== 'boolean') throw new Error('无效发现开关');
    if (enabled) { try { await this.openDiscoverySocket();this.discovering = true;this.error = null; } catch (error) { this.error = '局域网发现不可用，请检查本机网络和防火墙';throw error; } }
    else { this.discovering = false;this.sources.clear();if (!this.sharing) this.closeSocket(); }
    return this.status();
  }
  private validateJpeg(jpeg: Buffer) {
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg.length > MAX_FRAME || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('屏幕画面格式或大小无效');
  }
  private async currentFrame(): Promise<Captured> {
    if (!this.sharing) throw new Error('共享已停止');
    if (this.cache && Date.now() - this.cache.capturedAt < FRAME_INTERVAL) return this.cache;
    if (this.capturing) return bounded(this.capturing);
    const generation = this.generation, screen = this.sharing.screenId;
    const pending = this.capture.capture(screen).then(jpeg => {
      this.validateJpeg(jpeg);if (generation !== this.generation || !this.sharing) throw new Error('共享已停止');
      this.error = null;return this.cache = { jpeg, capturedAt: Date.now() };
    }).catch(e => { if (generation === this.generation) this.error = '屏幕采集失败，请检查所选屏幕后重试';throw e; })
      .finally(() => { if (this.capturing === pending) this.capturing = null; });
    this.capturing = pending;
    return bounded(pending).catch(e => { if (generation === this.generation) this.error = '屏幕采集超时或失败，请检查所选屏幕';throw e; });
  }
  async start(options: { screenId: string; label: string }) {
    this.supported();if (this.starting || this.sharing) throw new Error('请先停止当前共享');
    if (!options || typeof options.screenId !== 'string' || typeof options.label !== 'string') throw new Error('无效共享设置');
    const label = options.label.trim();if (!label || label.length > 60 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error('共享名称需为 1–60 个可见字符');
    this.starting = true;const generation = ++this.generation;
    try {
      if (!(await this.screens()).some(s => s.id === options.screenId)) throw new Error('所选屏幕不存在');
      const jpeg = await bounded(this.capture.capture(options.screenId));this.validateJpeg(jpeg);
      if (generation !== this.generation) throw new Error('共享启动已取消');
      await this.openDiscoverySocket();
      if (generation !== this.generation) throw new Error('共享启动已取消');
      const server = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!this.sharing || req.method !== 'GET' || req.url !== '/frame/' + this.token || !this.allowed(req.socket.remoteAddress ?? '')) { res.writeHead(404).end();return; }
        if (this.reads >= 64 || !this.rate('http:' + req.socket.remoteAddress, 8)) { res.writeHead(429).end();return; }
        this.reads++;
        try { const frame = await this.currentFrame();if (generation !== this.generation) { res.writeHead(410).end();return; }
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': frame.jpeg.length, 'X-Captured-At': String(frame.capturedAt) });res.end(frame.jpeg);
        } catch { res.writeHead(503).end(); } finally { this.reads--; }
      });
      this.server = server;server.maxConnections = 64;server.requestTimeout = 5000;server.headersTimeout = 5000;server.keepAliveTimeout = 1000;
      await new Promise<void>((resolve, reject) => { server.once('error', reject);server.listen(0, '0.0.0.0', () => { server.removeListener('error', reject);resolve(); }); });
      server.on('error', () => { this.error = '共享网络服务不可用'; });
      if (generation !== this.generation) throw new Error('共享启动已取消');
      const address = server.address();if (!address || typeof address === 'string') throw new Error('共享监听失败');
      this.token = randomBytes(32).toString('hex');this.sharing = { id: randomBytes(16).toString('hex'), label, screenId: options.screenId, port: address.port };
      this.cache = { jpeg, capturedAt: Date.now() };this.error = null;this.announce();return this.status();
    } catch (e) { await this.stop();this.error = e instanceof Error ? e.message : '共享启动失败';throw e; }
    finally { this.starting = false; }
  }
  async stop() {
    ++this.generation;this.sharing = null;this.token = '';this.cache = null;this.capturing = null;
    const server = this.server;this.server = null;
    if (server) { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); }
    if (!this.discovering) this.closeSocket();return this.status();
  }
  async frame(sourceId: string): Promise<ClassroomFrame> {
    this.supported();await this.status();
    const source = this.sources.get(sourceId);
    if (!this.discovering || !source || !this.allowed(source.address)) throw new Error('共享源已离线，请重新发现');
    if (this.outgoing >= 8) throw new Error('观看请求过多，请稍后重试');
    this.outgoing++;
    try { return await new Promise<ClassroomFrame>((resolve, reject) => {
      const request = get({ host: source.address, port: source.port, path: '/frame/' + source.token, agent: false, timeout: 4000 }, response => {
        if (response.statusCode !== 200 || response.headers['content-type'] !== 'image/jpeg') { response.resume();reject(new Error('共享暂不可用或已停止'));return; }
        const chunks: Buffer[] = [];let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length;if (size > MAX_FRAME) { response.destroy(new Error('共享画面超出大小限制'));return; }chunks.push(chunk); });
        response.on('error', () => reject(new Error('共享画面读取失败')));
        response.on('end', () => { try { const jpeg = Buffer.concat(chunks);this.validateJpeg(jpeg);
          if (!this.discovering || this.sources.get(sourceId)?.token !== source.token) throw new Error('观看已停止');
          resolve({ dataUrl: 'data:image/jpeg;base64,' + jpeg.toString('base64'), capturedAt: Date.now() });
        } catch (e) { reject(e); } });
      });
      request.on('timeout', () => request.destroy(new Error('共享画面读取超时')));
      request.on('error', () => reject(new Error('无法读取共享画面，请检查网络或教师是否停止共享')));
      const deadline = setTimeout(() => request.destroy(new Error('共享画面读取超时')), 4000);
      request.on('close', () => clearTimeout(deadline));
    }); } finally { this.outgoing--; }
  }
  async dispose() { this.discovering = false;this.sources.clear();await this.stop();this.closeSocket(); }
}
