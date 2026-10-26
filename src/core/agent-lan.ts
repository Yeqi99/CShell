import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { isIPv4 } from 'node:net';
import { agentLanAnnouncementSchema, type AgentLanAnnouncement, type AgentLanSource, type AgentLanStatus } from '../shared/agent-lan';
export const AGENT_LAN_GROUP = '239.255.72.84', AGENT_LAN_PORT = 47884, AGENT_LAN_TTL = 9000;
type Interfaces = Record<string, NetworkInterfaceInfo[] | undefined>;
const number = (ip: string) => ip.split('.').reduce((n, v) => ((n << 8) | Number(v)) >>> 0, 0);
export function agentLanPeer(address: string, interfaces: Interfaces) {
  if (!isIPv4(address) || /^(127|0|224|239)\./.test(address)) return false;
  return Object.values(interfaces).flat().some(i => i && i.family === 'IPv4' && !i.internal && isIPv4(i.netmask) && i.netmask !== '0.0.0.0'
    && (number(address) & number(i.netmask)) === (number(i.address) & number(i.netmask)));
}
export class AgentLanDirectory {
  private entries = new Map<string, AgentLanSource>();
  private rates = new Map<string, { at: number; count: number }>();
  constructor(private interfaces: () => Interfaces = networkInterfaces) {}
  accept(bytes: Buffer, address: string, now = Date.now()): boolean {
    if (bytes.length > 1024 || !agentLanPeer(address, this.interfaces())) return false;
    for (const [k, r] of this.rates) if (now - r.at > 1000) this.rates.delete(k);
    const r = this.rates.get(address) ?? { at: now, count: 0 };
    if (!this.rates.has(address) && this.rates.size >= 256) return false;
    this.rates.set(address, r);if (++r.count > 8) return false;
    let raw: unknown;try { raw = JSON.parse(bytes.toString('utf8')); } catch { return false; }
    const parsed = agentLanAnnouncementSchema.safeParse(raw);if (!parsed.success) return false;
    const { protocol: _, ...value } = parsed.data;
    this.list(now);
    const old = this.entries.get(value.deviceId);
    if (old && (old.address !== address || old.port !== value.port || old.fingerprint !== value.fingerprint)) return false;
    if (!old && this.entries.size >= 128) return false;
    this.entries.set(value.deviceId, { ...value, id: value.deviceId, address, lastSeen: now });return true;
  }
  list(now = Date.now()): AgentLanSource[] {
    for (const [id, s] of this.entries) if (now - s.lastSeen > AGENT_LAN_TTL) this.entries.delete(id);
    return [...this.entries.values()].map(s => ({ ...s }));
  }
  clear() { this.entries.clear();this.rates.clear(); }
}
/** Separate opt-in multicast capability. Never scans ports, probes TLS or sends passwords. */
export class AgentLanService {
  readonly directory: AgentLanDirectory;
  private socket: Socket | null = null;
  private enabled = false;
  private advertisement: AgentLanAnnouncement | null = null;
  private bind: string | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private error: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private interfaces: () => Interfaces = networkInterfaces) { this.directory = new AgentLanDirectory(interfaces); }
  status(): AgentLanStatus { return { enabled: this.enabled, advertising: !!this.advertisement && !!this.socket,
    sources: this.enabled ? this.directory.list() : [], error: this.error }; }
  private serial<T>(work: () => Promise<T>) { const task = this.queue.then(work);this.queue = task.catch(() => {});return task; }
  setDiscovery(enabled: boolean) {
    return this.serial(async () => {
      if (typeof enabled !== 'boolean') throw new Error('无效发现开关');
      this.enabled = enabled;if (!enabled) this.directory.clear();
      await this.reconcile();return this.status();
    });
  }
  setAdvertisement(value: AgentLanAnnouncement | null, bind?: string) {
    const parsed = value === null ? null : agentLanAnnouncementSchema.parse(value);
    if (bind && !['0.0.0.0', '::'].includes(bind) && !isIPv4(bind)) throw new Error('发现公告需使用本机 IPv4 监听');
    return this.serial(async () => { this.advertisement = parsed;this.bind = bind;await this.reconcile();this.announce();return this.status(); });
  }
  private async reconcile() {
    if (!this.enabled && !this.advertisement) { this.closeSocket();return; }
    if (this.socket && !this.error) return;
    if (this.socket) this.closeSocket();
    const socket = createSocket({ type: 'udp4', reuseAddr: true });this.socket = socket;
    socket.on('message', (bytes, remote) => { if (this.enabled) this.directory.accept(bytes, remote.address); });
    try {
      await new Promise<void>((resolve, reject) => { socket.once('error', reject);socket.bind(AGENT_LAN_PORT, '0.0.0.0', () => { socket.removeListener('error', reject);resolve(); }); });
      socket.on('error', () => { this.error = '机房发现网络不可用，请检查局域网和防火墙';this.closeSocket();this.enabled = false; });
      socket.setMulticastTTL(1);socket.setMulticastLoopback(true);
      let joined = 0;
      for (const i of Object.values(this.interfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) {
        try { socket.addMembership(AGENT_LAN_GROUP, i.address);joined++; } catch { /* Try next local interface. */ }
      }
      if (!joined) throw new Error('没有可用局域网接口');
      this.error = null;this.timer = setInterval(() => this.announce(), 2500);this.timer.unref();
    } catch { this.error = '机房发现不可用，请检查本机网络或端口占用';this.closeSocket();this.enabled = false;throw new Error(this.error); }
  }
  private announce() {
    if (!this.advertisement || !this.socket) return;
    const bytes = Buffer.from(JSON.stringify(this.advertisement));
    for (const i of Object.values(this.interfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal && (!this.bind || ['0.0.0.0', '::'].includes(this.bind) || i.address === this.bind)) {
      try { this.socket.setMulticastInterface(i.address);this.socket.send(bytes, AGENT_LAN_PORT, AGENT_LAN_GROUP, error => { if (error) this.error = '机房公告发送失败'; }); } catch { this.error = '机房公告发送失败'; }
    }
  }
  private closeSocket() { if (this.timer) clearInterval(this.timer);this.timer = null;try { this.socket?.close(); } catch {}this.socket = null; }
  dispose() { return this.serial(async () => { this.enabled = false;this.advertisement = null;this.directory.clear();this.closeSocket(); }); }
}
