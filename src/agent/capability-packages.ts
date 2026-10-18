import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { constants } from 'node:fs';
import { agentCapabilityManifestSchema, type AgentCapabilityManifest, type CapabilityPackageRecord, type CapabilityPackageView } from '../shared/agent-capability-packages';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const compareVersion = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};
export function capabilityVersionCompatible(version: string, range: { min: string; maxExclusive: string }) {
  return /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(version)
    && compareVersion(range.min, range.maxExclusive) < 0 && compareVersion(version, range.min) >= 0 && compareVersion(version, range.maxExclusive) < 0;
}
export function parseCapabilityManifest(manifestJson: string, expectedSha256: string) {
  if (Buffer.byteLength(manifestJson) > 1024 * 1024) throw new Error('Capability manifest exceeds 1 MiB');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || digest(manifestJson) !== expectedSha256) throw new Error('Capability manifest digest mismatch');
  const manifest = agentCapabilityManifestSchema.parse(JSON.parse(manifestJson));
  const ranges = [manifest.compatibility.agentVersion, ...(manifest.systemApplication ? [manifest.systemApplication.version] : [])];
  if (ranges.some(range => compareVersion(range.min, range.maxExclusive) >= 0)) throw new Error('Invalid capability version range');
  return manifest;
}

/** Caller obtains expected manifest digest from a trusted catalog, never from the untrusted package itself.
 * Does not download, extract or execute anything. Root must be a host-owned immutable staging directory. */
export async function verifyCapabilityFiles(root: string, manifest: AgentCapabilityManifest) {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Package root must be a real directory');
  const canonicalRoot = await realpath(root);
  for (const file of manifest.files) {
    let path = canonicalRoot;
    for (const component of file.path.split('/')) {
      path = join(path, component);
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Package symlinks are not permitted');
    }
    const canonicalFile = await realpath(path), within = relative(canonicalRoot, canonicalFile);
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('Package file escapes its root');
    const handle = await open(canonicalFile, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== file.bytes) throw new Error(`Package file size mismatch: ${file.path}`);
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > file.bytes) throw new Error('Package file changed during verification'); hash.update(chunk); }
      const after = await handle.stat();
      if (bytes !== file.bytes || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size || hash.digest('hex') !== file.sha256) throw new Error(`Package file digest mismatch: ${file.path}`);
    } finally { await handle.close(); }
  }
  return canonicalRoot;
}

export interface CapabilityPackageHost {
  environment: { platform: string; architecture: string; agentVersion: string };
  /** Adapter identifiers are implemented/trusted by the host, never dynamically imported from manifest files. */
  hasAdapter(adapterId: string): boolean;
  inspect(manifest: AgentCapabilityManifest, root: string): Promise<{ installed: boolean; configured: boolean; systemVersion?: string }>;
  /** Existing backend must enforce grants again on every tool/event call; registration is not a permission sandbox. */
  register(manifest: AgentCapabilityManifest, root: string, grants: readonly string[]): Promise<void>;
  /** Immediately block new calls before stopping tasks/subscriptions. Must be idempotent. */
  quiesce(packageId: string): Promise<void>;
  stopTasksAndSubscriptions(packageId: string): Promise<void>;
  unregister(packageId: string): Promise<void>;
  /** Host persists records in its existing encrypted vault. No secrets/configuration live in this manifest. */
  load(): Promise<CapabilityPackageRecord[]>;
  save(records: CapabilityPackageRecord[]): Promise<void>;
}

export class CapabilityPackages {
  private records = new Map<string, CapabilityPackageRecord>();
  private registered = new Set<string>();
  private serial: Promise<unknown> = Promise.resolve();
  private ready = false;
  constructor(private readonly host: CapabilityPackageHost) {}
  private lock<T>(action: () => Promise<T>): Promise<T> { const result = this.serial.then(action); this.serial = result.catch(() => {}); return result; }
  private persist() { return this.host.save(structuredClone([...this.records.values()])); }
  private check() { if (!this.ready) throw new Error('Capability packages not initialized'); }
  async init() {
    return this.lock(async () => {
      if (this.ready) return;
      const saved = await this.host.load();
      if (!Array.isArray(saved) || saved.length > 100) throw new Error('Invalid capability package storage');
      for (const record of saved) {
        const manifest = parseCapabilityManifest(record.manifestJson, record.manifestSha256);
        if (manifest.id !== record.id || manifest.version !== record.version || typeof record.root !== 'string' || !isAbsolute(record.root) || !Array.isArray(record.grants) || record.grants.some(grant => !manifest.permissions.includes(grant)) || this.records.has(record.id)) throw new Error('Invalid capability package record');
        this.records.set(record.id, { ...structuredClone(record), status: 'not-configured', reason: '运行时已重启，需要重新检查依赖与配置' });
      }
      await this.persist(); this.ready = true;
    });
  }
  list(): CapabilityPackageView[] {
    return [...this.records.values()].map(record => {
      const manifest = parseCapabilityManifest(record.manifestJson, record.manifestSha256);
      return { id: record.id, name: manifest.name, version: record.version, status: record.status, reason: record.reason, grants: [...record.grants], requiredPermissions: [...manifest.permissions], registered: this.registered.has(record.id) };
    });
  }
  private async deactivate(id: string) {
    await this.host.quiesce(id);
    await this.host.stopTasksAndSubscriptions(id);
    await this.host.unregister(id);
    this.registered.delete(id);
  }
  private compatibility(manifest: AgentCapabilityManifest) {
    const env = this.host.environment;
    if (!(manifest.compatibility.platforms as string[]).includes(env.platform)) return '当前操作系统不兼容';
    if (!(manifest.compatibility.architectures as string[]).includes(env.architecture)) return '当前处理器架构不兼容';
    if (!capabilityVersionCompatible(env.agentVersion, manifest.compatibility.agentVersion)) return '当前 cagent 版本不兼容';
    if (!this.host.hasAdapter(manifest.adapterId)) return '此运行时尚未实现该能力适配器';
    return undefined;
  }
  async stage(manifestJson: string, root: string, trustedManifestSha256: string) {
    return this.lock(async () => {
      this.check();
      const manifest = parseCapabilityManifest(manifestJson, trustedManifestSha256);
      const canonicalRoot = await verifyCapabilityFiles(root, manifest);
      const previous = this.records.get(manifest.id);
      if (!previous && this.records.size >= 100) throw new Error('Capability package limit reached');
      if (previous) {
        try { await this.deactivate(manifest.id); }
        catch (error) { previous.status = 'fault'; previous.reason = '无法停止旧版本任务；升级未完成'; await this.persist(); throw error; }
      }
      this.records.set(manifest.id, { id: manifest.id, version: manifest.version, root: canonicalRoot, manifestJson, manifestSha256: trustedManifestSha256,
        grants: previous?.grants.filter(grant => manifest.permissions.includes(grant)) ?? [], status: 'not-configured' });
      // Stage never installs a system app and never grants new capabilities.
      await this.persist(); await this.inspectAndRegister(manifest.id); return this.list().find(record => record.id === manifest.id)!;
    });
  }
  private async inspectAndRegister(id: string) {
    const record = this.records.get(id); if (!record) throw new Error('Capability package not found');
    try {
      const manifest = parseCapabilityManifest(record.manifestJson, record.manifestSha256);
      await this.deactivate(id);
      const reason = this.compatibility(manifest);
      if (reason) { record.status = 'incompatible'; record.reason = reason; }
      else {
        await verifyCapabilityFiles(record.root, manifest);
        const inspected = await this.host.inspect(manifest, record.root);
        if (!inspected.installed) { record.status = 'not-installed'; record.reason = '系统应用尚未安装；需独立安装计划与授权'; }
        else if (manifest.systemApplication && (!inspected.systemVersion || !capabilityVersionCompatible(inspected.systemVersion, manifest.systemApplication.version))) { record.status = 'incompatible'; record.reason = '系统应用版本不兼容或未能核验'; }
        else if (!inspected.configured) { record.status = 'not-configured'; record.reason = '系统应用或工具包装器尚未完成配置'; }
        else if (![...manifest.tools,...manifest.events].some(capability=>capability.permissions.every(permission=>record.grants.includes(permission)))) { record.status = 'authorization-required'; record.reason = '工具与事件需要独立授权'; }
        else {
          // Persist non-ready state before adapter registration; a crash must never imply ready.
          record.status = 'not-configured'; record.reason = '正在注册已核验能力'; await this.persist();
          await this.host.register(manifest, record.root, Object.freeze([...record.grants]));
          this.registered.add(id); record.status = 'available'; delete record.reason;
        }
      }
    } catch {
      record.status = 'fault'; record.reason = '检查或注册失败，能力已停用';
      // Adapter registration may have partially completed. Try both blocking and cleanup.
      try { await this.deactivate(id); } catch { record.reason = '停止或清理失败，需检查适配器；不显示为可用'; }
    }
    try { await this.persist(); }
    catch (error) { record.status = 'fault'; record.reason = '状态保存失败'; try { await this.deactivate(id); } catch {} throw error; }
  }
  async refresh(id: string) { return this.lock(async () => { this.check(); await this.inspectAndRegister(id); return this.list().find(record => record.id === id)!; }); }
  /** Only a trusted local permissions handler may call this after explicit user configuration.
   * Never expose this method as an autonomous model tool or infer grants from installation. */
  async setPermissions(id: string, permissions: string[]) {
    return this.lock(async () => {
      this.check(); const record = this.records.get(id); if (!record) throw new Error('Capability package not found');
      const manifest = parseCapabilityManifest(record.manifestJson, record.manifestSha256);
      if (permissions.length > 64 || new Set(permissions).size !== permissions.length || permissions.some(permission => !manifest.permissions.includes(permission))) throw new Error('Unknown or duplicate capability permission');
      try { await this.deactivate(id); }
      catch (error) { record.status = 'fault'; record.reason = '无法停止原任务，权限变更未完成'; await this.persist(); throw error; }
      record.grants = [...permissions]; record.status = 'not-configured'; await this.persist(); await this.inspectAndRegister(id);
      return this.list().find(item => item.id === id)!;
    });
  }
  async uninstall(id: string) {
    return this.lock(async () => {
      this.check(); const record = this.records.get(id); if (!record) return;
      try { await this.deactivate(id); }
      catch (error) { record.status = 'fault'; record.reason = '任务或订阅尚未停止；卸载未完成'; await this.persist(); throw error; }
      // Does not remove the user's system app, secrets or data. Host owns a separate deletion plan.
      this.records.delete(id); await this.persist();
    });
  }
  async suspendAll() {
    return this.lock(async()=>{
      this.check();
      for(const record of this.records.values()){
        try{await this.deactivate(record.id);record.status='not-configured';record.reason='运行时已停止，重启后重新检查';}
        catch{record.status='fault';record.reason='停止任务或订阅失败';}
      }
      await this.persist();
    });
  }
}
