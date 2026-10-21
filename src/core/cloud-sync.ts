import { mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SecretCodec } from './store';
import { decryptVault, encryptVault, newRecoveryKey, vaultDigest } from './cloud-crypto';
import type { CloudEnvelope, CloudSession, CloudStatus, CloudRevision } from '../shared/cloud-sync';

interface LocalState {
  session?: CloudSession;
  key?: string;
  revision: number;
  digest?: string;
  lastSync?: string;
  pending?: { baseRevision: number; mutationId: string; envelope: CloudEnvelope; digest: string };
}
export interface CloudAdapter {
  export(): Promise<unknown>;
  validate(value: unknown): void;
  import(value: unknown): Promise<void>;
}
export class CloudSync {
  private data: LocalState = { revision: 0 };
  private state: CloudStatus['state'] = 'signed-out';
  private error?: string;
  private busy = false;
  private preserveUnreadable = false;
  constructor(
    private directory: string,
    private codec: SecretCodec,
    private adapter: CloudAdapter,
    private endpoint = 'https://shell.canp.ai/api',
    private request = fetch,
  ) {}
  async load() {
    try {
      this.data = JSON.parse(
        await this.codec.decrypt(await readFile(join(this.directory, 'cloud-sync.enc'), 'utf8')),
      );
      this.state = !this.data.session ? 'signed-out' : this.data.key ? 'ready' : 'locked';
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.data = { revision: 0 };
        this.state = 'error';
        this.error = '无法解密云同步登录信息，原文件已保留；本机离线功能不受影响';
        this.preserveUnreadable = true;
      }
    }
  }
  status(): CloudStatus {
    return {
      email: this.data.session?.email,
      unlocked: !!this.data.key,
      revision: this.data.revision,
      lastSync: this.data.lastSync,
      state: this.state,
      error: this.error,
    };
  }
  private async persist() {
    const text = await this.codec.encrypt(JSON.stringify(this.data));
    await mkdir(this.directory, { recursive: true });
    if (this.preserveUnreadable) {
      await rename(
        join(this.directory, 'cloud-sync.enc'),
        join(this.directory, 'cloud-sync-unreadable-' + Date.now() + '.enc'),
      );
      this.preserveUnreadable = false;
    }
    await writeFile(join(this.directory, 'cloud-sync.enc.tmp'), text, { mode: 0o600 });
    await rename(
      join(this.directory, 'cloud-sync.enc.tmp'),
      join(this.directory, 'cloud-sync.enc'),
    );
  }
  private async api(path: string, body?: unknown): Promise<any> {
    const response = await this.request(this.endpoint + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.data.session ? { Authorization: 'Bearer ' + this.data.session.token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('云端响应为空');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        bytes += r.value.length;
        if (bytes > 13 * 1024 * 1024) throw new Error('云端响应超过上限');
        chunks.push(r.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) {
      if (response.status === 409) this.state = 'conflict';
      throw new Error(typeof value.error === 'string' ? value.error.slice(0, 300) : '云端请求失败');
    }
    return value;
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('同步操作正在进行');
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
  async requestCode(email: string) {
    await this.api('/v1/auth/code', { email });
  }
  async login(email: string, code: string) {
    return this.exclusive(async () => {
      const session: CloudSession = await this.api('/v1/auth/login', { email, code });
      if (!/^[a-f0-9]{32}$/.test(session.accountId) || !/^[A-Za-z0-9_-]{43}$/.test(session.token))
        throw new Error('登录响应不正确');
      const same = this.data.session?.accountId === session.accountId;
      this.data = same ? { ...this.data, session } : { session, revision: 0 };
      this.state = this.data.key ? 'ready' : 'locked';
      this.error = undefined;
      await this.persist();
      return this.status();
    });
  }
  private async remote(): Promise<CloudRevision> {
    if (!this.data.session) throw new Error('请先登录');
    const value: CloudRevision = await this.api('/v1/vault');
    if (
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      (value.revision === 0) !== (value.envelope === null)
    )
      throw new Error('云端版本不正确');
    if (value.revision < this.data.revision) throw new Error('云端版本回退，已停止同步');
    return value;
  }
  async createVault() {
    return this.exclusive(async () => {
      const remote = await this.remote();
      if (remote.envelope || this.data.key) throw new Error('保险库已存在，请使用原恢复密钥');
      const key = newRecoveryKey();
      this.data.key = key;
      this.state = 'ready';
      await this.persist();
      return { recoveryKey: key };
    });
  }
  async unlock(key: string) {
    return this.exclusive(async () => {
      const remote = await this.remote();
      if (!remote.envelope) throw new Error('云端还没有保险库，请先在原设备创建并同步');
      const plaintext = decryptVault(remote.envelope, key, this.data.session!.accountId);
      this.adapter.validate(plaintext);
      this.data.key = key;
      this.state = 'ready';
      await this.persist();
      return this.status();
    });
  }
  async sync(direction?: 'upload' | 'download') {
    return this.exclusive(async () => {
      if (!this.data.session || !this.data.key) throw new Error('请先登录并解锁保险库');
      this.state = 'syncing';
      this.error = undefined;
      try {
        // Explicit reconciliation supersedes an unacknowledged upload; inspect the
        // latest server revision before deciding what the user chose to overwrite.
        if (direction && this.data.pending) {
          delete this.data.pending;
          await this.persist();
        }
        // Retry exactly the persisted mutation after an uncertain network result.
        if (this.data.pending) {
          const p = this.data.pending;
          try {
            const r = await this.api('/v1/vault', p);
            this.data.revision = r.revision;
            this.data.digest = p.digest;
            delete this.data.pending;
            await this.persist();
          } catch (error) {
            if (this.status().state !== 'conflict' || !direction) throw error;
            delete this.data.pending;
            await this.persist();
            this.state = 'syncing';
          }
        }
        const remote = await this.remote(),
          local = await this.adapter.export(),
          digest = vaultDigest(local);
        const changed = this.data.digest !== digest,
          remoteChanged = remote.revision !== this.data.revision;
        if (!direction && ((!this.data.digest && remote.envelope) || (changed && remoteChanged))) {
          this.state = 'conflict';
          throw new Error('本机与云端均有数据变化，请选择保留本机或恢复云端；覆盖前会保留加密备份');
        }
        if (direction === 'download' || (!changed && remoteChanged)) {
          if (!remote.envelope) throw new Error('云端尚无数据');
          const value = decryptVault(remote.envelope, this.data.key, this.data.session.accountId);
          this.adapter.validate(value);
          // Keep the outgoing local snapshot encrypted, even if restoring later fails.
          await this.backup(local, 'local');
          if (vaultDigest(await this.adapter.export()) !== digest)
            throw new Error('本机设置已变化，请重新同步');
          await this.adapter.import(value);
          this.data.digest = vaultDigest(await this.adapter.export());
          this.data.revision = remote.revision;
        } else if (changed || direction === 'upload') {
          if (remote.envelope) {
            const old = decryptVault(remote.envelope, this.data.key, this.data.session.accountId);
            await this.backup(old, 'remote');
          }
          this.data.pending = {
            baseRevision: remote.revision,
            mutationId: randomUUID(),
            envelope: encryptVault(local, this.data.key, this.data.session.accountId),
            digest,
          };
          await this.persist();
          const result = await this.api('/v1/vault', this.data.pending);
          this.data.revision = result.revision;
          this.data.digest = digest;
          delete this.data.pending;
        }
        this.data.lastSync = new Date().toISOString();
        await this.persist();
        this.state = 'ready';
        return this.status();
      } catch (e) {
        this.error = e instanceof Error ? e.message : '同步失败';
        if (this.state !== 'conflict') this.state = 'error';
        throw e;
      }
    });
  }
  private async backup(value: unknown, source: string) {
    const directory = join(this.directory, 'cloud-backups');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, Date.now() + '-' + source + '-' + randomUUID() + '.enc'),
      await this.codec.encrypt(JSON.stringify(value)),
      { mode: 0o600 },
    );
    const backups = (await readdir(directory))
      .filter((name) => /^\d+-(local|remote)-[a-f0-9-]+\.enc$/.test(name))
      .sort();
    for (const name of backups.slice(0, -20)) await unlink(join(directory, name));
  }
  async logout() {
    return this.exclusive(async () => {
      if (this.data.session) await this.api('/v1/auth/logout', {});
      this.data = { revision: 0 };
      await this.persist();
      this.state = 'signed-out';
      this.error = undefined;
    });
  }
}
