import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { SFTPWrapper } from 'ssh2';
import type { Transfer } from '../shared/contracts';
import { childPath, safeName } from './paths';
import { SshService } from './ssh';

export class Transfers {
  get size() {
    return this.jobs.size;
  }
  private jobs = new Map<string, { state: Transfer; controller: AbortController }>();
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private ssh: SshService,
    private emit: (state: Transfer) => void,
    private overwrite: (path: string) => Promise<boolean>,
  ) {}
  cancel(id: string) {
    this.jobs.get(id)?.controller.abort();
  }
  cancelSession(id: string) {
    for (const job of this.jobs.values()) if (job.state.sessionId === id) job.controller.abort();
  }
  dispose() {
    for (const job of this.jobs.values()) job.controller.abort();
  }
  enqueueOperation(
    sessionId: string,
    name: string,
    operation: (state: Transfer, signal: AbortSignal, publish: () => void) => Promise<void>,
  ) {
    const state: Transfer = {
      id: randomUUID(),
      sessionId,
      name,
      direction: 'copy',
      done: 0,
      total: 0,
      state: 'running',
    };
    const controller = new AbortController();
    this.jobs.set(state.id, { state, controller });
    this.emit({ ...state });
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        try {
          controller.signal.throwIfAborted();
          await operation(state, controller.signal, () => this.emit({ ...state }));
          state.state = 'done';
        } catch (error) {
          state.state = controller.signal.aborted ? 'cancelled' : 'failed';
          state.error = (error as Error).message;
        } finally {
          this.emit({ ...state });
          this.jobs.delete(state.id);
        }
      });
    return state.id;
  }
  copyRemote(sourceId: string, source: string, targetId: string, target: string) {
    return this.enqueueOperation(targetId, posix.basename(source), async (state, signal) => {
      const from = await this.ssh.sftp(sourceId),
        to = await this.ssh.sftp(targetId);
      await this.remoteCopy(from, source, to, target, state, signal, 0);
    });
  }
  private async remoteCopy(
    from: SFTPWrapper,
    source: string,
    to: SFTPWrapper,
    target: string,
    state: Transfer,
    signal: AbortSignal,
    depth: number,
  ): Promise<void> {
    signal.throwIfAborted();
    if (depth > 64) throw new Error('Directory nesting limit reached');
    const stat = await this.remoteStat(from, source);
    if (!stat) throw new Error('Source no longer exists');
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not copied');
    if (await this.remoteStat(to, target))
      throw new Error('Destination already exists; original preserved');
    if (stat.isDirectory()) {
      await new Promise<void>((r, j) => to.mkdir(target, (e) => (e ? j(e) : r())));
      const files = await new Promise<import('ssh2').FileEntryWithStats[]>((r, j) =>
        from.readdir(source, (e, files) => (e ? j(e) : r(files))),
      );
      for (const file of files) {
        if (file.filename === '.' || file.filename === '..') continue;
        await this.remoteCopy(
          from,
          childPath(source, file.filename),
          to,
          childPath(target, file.filename),
          state,
          signal,
          depth + 1,
        );
      }
    } else {
      if (!stat.isFile()) throw new Error('Only regular files can be copied');
      state.total += stat.size;
      const temporary = `${target}.cshell-${state.id}.part`;
      try {
        await pipeline(
          from.createReadStream(source),
          this.progress(state),
          to.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        signal.throwIfAborted();
        await new Promise<void>((r, j) => to.rename(temporary, target, (e) => (e ? j(e) : r())));
      } catch (e) {
        await new Promise<void>((r) => to.unlink(temporary, () => r()));
        throw e;
      }
    }
  }
  enqueue(
    sessionId: string,
    direction: 'upload' | 'download',
    source: string,
    destination: string,
  ) {
    const state: Transfer = {
      id: randomUUID(),
      sessionId,
      direction,
      name: direction === 'upload' ? basename(source) : posix.basename(source),
      done: 0,
      total: 0,
      state: 'running',
    };
    const controller = new AbortController();
    this.jobs.set(state.id, { state, controller });
    this.emit({ ...state });
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        try {
          controller.signal.throwIfAborted();
          const sftp = await this.ssh.sftp(sessionId);
          if (direction === 'upload')
            await this.upload(
              sftp,
              source,
              childPath(destination, state.name),
              state,
              controller.signal,
              0,
            );
          else
            await this.download(
              sftp,
              source,
              join(destination, safeName(state.name)),
              state,
              controller.signal,
              0,
            );
          state.state = 'done';
        } catch (error) {
          state.state = controller.signal.aborted ? 'cancelled' : 'failed';
          state.error = (error as Error).message;
        } finally {
          this.emit({ ...state });
          this.jobs.delete(state.id);
        }
      });
    return state.id;
  }
  private progress(state: Transfer) {
    let last = 0;
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        state.done += chunk.length;
        if (Date.now() - last > 100) {
          last = Date.now();
          this.emit({ ...state });
        }
        callback(null, chunk);
      },
    });
  }
  private async remoteStat(sftp: SFTPWrapper, path: string) {
    return new Promise<import('ssh2').Stats | null>((resolve, reject) =>
      sftp.lstat(path, (error, stats) =>
        !error ? resolve(stats) : (error as any).code === 2 ? resolve(null) : reject(error),
      ),
    );
  }
  private async upload(
    sftp: SFTPWrapper,
    source: string,
    target: string,
    state: Transfer,
    signal: AbortSignal,
    depth: number,
  ): Promise<void> {
    signal.throwIfAborted();
    if (depth > 64) throw new Error('Directory nesting limit reached');
    const stat = await lstat(source),
      existing = await this.remoteStat(sftp, target);
    if (stat.isSymbolicLink() || existing?.isSymbolicLink())
      throw new Error('Symbolic links are not transferred');
    if (stat.isDirectory()) {
      if (existing && !existing.isDirectory()) throw new Error('Destination is not a directory');
      if (!existing) await new Promise<void>((r, j) => sftp.mkdir(target, (e) => (e ? j(e) : r())));
      for (const name of await readdir(source))
        await this.upload(
          sftp,
          join(source, name),
          childPath(target, name),
          state,
          signal,
          depth + 1,
        );
    } else {
      if (!stat.isFile()) throw new Error('Only regular files can be uploaded');
      if (existing && (!existing.isFile() || !(await this.overwrite(target))))
        throw new Error('Overwrite declined');
      signal.throwIfAborted();
      state.total += stat.size;
      const temporary = `${target}.cshell-${state.id}.part`;
      try {
        await pipeline(
          createReadStream(source),
          this.progress(state),
          sftp.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        signal.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
          if (existing)
            sftp.ext_openssh_rename(temporary, target, (e) =>
              e
                ? reject(
                    new Error('Server cannot atomically replace file; original preserved', {
                      cause: e,
                    }),
                  )
                : resolve(),
            );
          else sftp.rename(temporary, target, (e) => (e ? reject(e) : resolve()));
        });
      } catch (error) {
        await new Promise<void>((r) => sftp.unlink(temporary, () => r()));
        throw error;
      }
    }
  }
  private async download(
    sftp: SFTPWrapper,
    source: string,
    target: string,
    state: Transfer,
    signal: AbortSignal,
    depth: number,
  ): Promise<void> {
    signal.throwIfAborted();
    if (depth > 64) throw new Error('Directory nesting limit reached');
    const stat = await this.remoteStat(sftp, source);
    if (!stat) throw new Error('Remote file no longer exists');
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat.isSymbolicLink() || existing?.isSymbolicLink())
      throw new Error('Symbolic links are not transferred');
    if (stat.isDirectory()) {
      if (existing && !existing.isDirectory()) throw new Error('Destination is not a directory');
      await mkdir(target, { recursive: true });
      const entries = await new Promise<import('ssh2').FileEntryWithStats[]>((r, j) =>
        sftp.readdir(source, (e, files) => (e ? j(e) : r(files))),
      );
      for (const entry of entries) {
        if (entry.filename === '.' || entry.filename === '..') continue;
        await this.download(
          sftp,
          childPath(source, entry.filename),
          join(target, safeName(entry.filename)),
          state,
          signal,
          depth + 1,
        );
      }
    } else {
      if (!stat.isFile()) throw new Error('Only regular files can be downloaded');
      if (existing && (!existing.isFile() || !(await this.overwrite(target))))
        throw new Error('Overwrite declined');
      signal.throwIfAborted();
      state.total += stat.size;
      const temporary = `${target}.cshell-${state.id}.part`;
      try {
        await pipeline(
          sftp.createReadStream(source),
          this.progress(state),
          createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        signal.throwIfAborted();
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    }
  }
}
