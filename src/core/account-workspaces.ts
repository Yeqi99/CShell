import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { SecretCodec } from './store';

/** Local encrypted workspace snapshots. Never part of a cloud payload. */
export class AccountWorkspaces<T> {
  private owner = 'guest';
  private busy = false;
  constructor(
    private directory: string,
    private codec: SecretCodec,
    private adapter: {
      capture(): Promise<T>;
      restore(value: T, owner: string): Promise<void>;
      empty(): T;
      validate(value: unknown): T;
      assertIdle(): void;
    },
  ) {}
  private file(owner: string) {
    if (owner !== 'guest' && !/^[a-f0-9]{32}$/.test(owner))
      throw Error('Invalid account workspace');
    return join(this.directory, createHash('sha256').update(owner).digest('hex') + '.enc');
  }
  private async read(owner: string): Promise<T | undefined> {
    try {
      return this.adapter.validate(
        JSON.parse(await this.codec.decrypt(await readFile(this.file(owner), 'utf8'))),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw Error('本机工作区读取失败，原数据已保留');
    }
  }
  private async save(owner: string, value: T) {
    const path = this.file(owner),
      tmp = path + '.' + randomUUID() + '.tmp';
    await mkdir(this.directory, { recursive: true });
    await writeFile(tmp, await this.codec.encrypt(JSON.stringify(value)), { mode: 0o600 });
    await rename(tmp, path);
  }
  private async marker(owner: string) {
    const path = join(this.directory, 'owner.enc');
    await writeFile(path + '.tmp', await this.codec.encrypt(owner), { mode: 0o600 });
    await rename(path + '.tmp', path);
  }
  async load(currentAccount?: string) {
    await mkdir(this.directory, { recursive: true });
    try {
      this.owner = await this.codec.decrypt(
        await readFile(join(this.directory, 'owner.enc'), 'utf8'),
      );
      this.file(this.owner);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw Error('本机账号工作区标记异常，停止自动切换');
      this.owner = currentAccount || 'guest';
      await this.save(this.owner, await this.adapter.capture());
      await this.marker(this.owner);
    }
    // A crash between swapping the runtime and persisting the login must not expose another account.
    const expected = currentAccount || 'guest';
    if (this.owner !== expected) {
      const next = (await this.read(expected)) || this.adapter.empty();
      await this.adapter.restore(next, expected);
      await this.marker(expected);
      this.owner = expected;
    }
  }
  async switchTo(owner: string) {
    this.file(owner);
    if (this.busy) throw Error('正在切换账号工作区');
    if (owner === this.owner) return;
    this.adapter.assertIdle();
    this.busy = true;
    const previousOwner = this.owner;
    try {
      const previous = await this.adapter.capture();
      await this.save(previousOwner, previous);
      const next = (await this.read(owner)) || this.adapter.empty();
      await this.save(owner, next);
      await this.marker(owner);
      try {
        await this.adapter.restore(next, owner);
        this.owner = owner;
      } catch (e) {
        await this.adapter.restore(previous, previousOwner);
        await this.marker(previousOwner);
        throw e;
      }
    } finally {
      this.busy = false;
    }
  }
  async guest() {
    if (this.busy) throw Error('正在切换账号工作区');
    return this.owner === 'guest' ? await this.adapter.capture() : await this.read('guest');
  }
  async clearGuest() {
    if (this.busy) throw Error('正在切换账号工作区');
    if (this.owner === 'guest') throw Error('请登录后管理未登录数据，当前工作区不会被清除');
    await unlink(this.file('guest')).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
  current() {
    return this.owner;
  }
}
