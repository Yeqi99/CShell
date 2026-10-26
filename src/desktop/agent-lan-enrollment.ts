import { randomBytes } from 'node:crypto';
import { fingerprint } from '../core/client/identity';
import { clientPasswordSchema, type ClientInfo, type ClientDevice } from '../shared/client';
import type { AgentLanSource, AgentLanPrepared } from '../shared/agent-lan';
type Candidate = { source: AgentLanSource; info: ClientInfo };
interface Pending { expiresAt: number; candidates: Candidate[] }
/** A discovery result is never a grant. Probe is passwordless; confirmation is a separate invocation. */
export class AgentLanEnrollment {
  private pending = new Map<string, Pending>();
  private busy = false;
  private epoch = 0;
  constructor(private options: {
    sources(): AgentLanSource[];
    enabled(): boolean;
    probe(endpoint: { host: string; port: number }): Promise<ClientInfo>;
    pair(info: ClientInfo, password: string): Promise<ClientDevice>;
  }) {}
  clear() { this.epoch++;this.pending.clear(); }
  private requireEnabled() { if (!this.options.enabled()) throw new Error('请先启用机房设备发现扩展'); }
  private prune() { for (const [token, batch] of this.pending) if (Date.now() > batch.expiresAt) this.pending.delete(token); }
  async prepare(ids: string[]): Promise<AgentLanPrepared> {
    this.requireEnabled();this.prune();if (this.busy || this.pending.size >= 4) throw new Error('已有机房身份检查，请完成或稍后重试');
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 64 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('每批请选择 1–64 台不同设备');
    const epoch = this.epoch, sources = this.options.sources(), candidates: Candidate[] = [], failures: AgentLanPrepared['failures'] = [];
    const queue = [...ids];this.busy = true;
    try {
      const checked = await Promise.allSettled(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (queue.length) {
          this.requireEnabled();if (epoch !== this.epoch) throw new Error('机房身份检查已取消');
          const id = queue.shift()!, source = sources.find(s => s.id === id);
          if (!source) { failures.push({ id, error: '设备已离线，请重新发现' });continue; }
          try {
            const info = await this.options.probe({ host: source.address, port: source.port });
            if (info.deviceId !== source.deviceId || fingerprint(info.certificate) !== source.fingerprint || info.host !== source.address || info.port !== source.port) throw new Error('Identity mismatch');
            candidates.push({ source: { ...source, name: info.name }, info: { ...info } });
          } catch { failures.push({ id, error: '无法核验真实设备身份；未发送密码' }); }
        }
      }));
      if (checked.some(result => result.status === 'rejected')) throw new Error('机房身份检查已取消');
      this.requireEnabled();if (epoch !== this.epoch) throw new Error('机房身份检查已取消');
      const token = randomBytes(24).toString('hex'), expiresAt = Date.now() + 120000;
      this.pending.set(token, { expiresAt, candidates });return { token, expiresAt, candidates: candidates.map(c => ({ ...c.source })), failures };
    } finally { this.busy = false; }
  }
  async confirm(input: { token: string; confirmed: true; fingerprints: { id: string; fingerprint: string }[]; password: string }) {
    this.requireEnabled();this.prune();if (this.busy) throw new Error('已有机房认证正在进行');
    if (!input || input.confirmed !== true || typeof input.token !== 'string' || !Array.isArray(input.fingerprints)) throw new Error('请先核对并确认本批设备身份');
    const batch = this.pending.get(input.token);if (!batch || !batch.candidates.length) throw new Error('身份确认已过期，请重新检查');
    const password = clientPasswordSchema.parse(input.password);
    if (input.fingerprints.length !== batch.candidates.length || new Set(input.fingerprints.map(c => c.id)).size !== batch.candidates.length
      || batch.candidates.some(c => !input.fingerprints.some(x => x.id === c.source.id && x.fingerprint === c.source.fingerprint))) throw new Error('确认列表与已核验身份不一致');
    this.pending.delete(input.token);this.busy = true;const epoch = this.epoch;
    const devices: ClientDevice[] = [], failures: { id: string; error: string }[] = [];
    try {
      // Provider persists one devices array: serialize enrollment to avoid lost writes.
      for (const c of batch.candidates) {
        this.requireEnabled();if (epoch !== this.epoch) throw new Error('机房认证已取消');
        const current = this.options.sources().find(s => s.id === c.source.id);
        if (!current || current.address !== c.source.address || current.port !== c.source.port || current.fingerprint !== c.source.fingerprint) {
          failures.push({ id: c.source.id, error: '设备已离线或身份改变；未发送密码' });continue;
        }
        try { devices.push(await this.options.pair(c.info, password)); }
        catch { failures.push({ id: c.source.id, error: '认证未完成，请检查机房密码或设备状态' }); }
      }
      return { devices, failures };
    } finally { this.busy = false; }
  }
}
