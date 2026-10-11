import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath, mkdir, rename, unlink, rmdir } from 'node:fs/promises';
import { resolve, relative, sep, posix, join } from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { FileEntry } from '../shared/contracts';
import { safeName } from './paths';

// Local access is restricted to roots explicitly selected in a native directory picker.
export class LocalFiles {
  private roots = new Map<string, string>();
  async grant(path: string) {
    const label = await realpath(path);
    const root = randomUUID();
    this.roots.set(root, label);
    return { root, label };
  }
  async resolve(root: string, path: string) {
    const base = this.roots.get(root);
    if (!base) throw new Error('Local directory access expired');
    if (!path || /[\\\0:]/.test(path)) throw new Error('Invalid local path');
    const normalized = posix.resolve('/', path),
      parts = normalized.split('/').filter(Boolean);
    parts.forEach(safeName);
    const target = resolve(base, ...parts),
      rel = relative(base, target);
    if (rel === '..' || rel.startsWith('..' + sep))
      throw new Error('Local path escaped selected directory');
    let current = base;
    for (const part of ['', ...parts]) {
      if (part) current = join(current, part);
      const stat = await lstat(current).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (stat?.isSymbolicLink()) throw new Error('Symbolic links and junctions are not followed');
    }
    return target;
  }
  async list(root: string, path: string) {
    const canonical = posix.resolve('/', path),
      target = await this.resolve(root, canonical);
    const entries: FileEntry[] = [];
    for (const name of await readdir(target)) {
      const stat = await lstat(join(target, name));
      entries.push({
        name,
        path: posix.join(canonical, name),
        size: stat.size,
        directory: stat.isDirectory(),
        symlink: stat.isSymbolicLink(),
        modified: stat.mtimeMs,
      });
    }
    entries.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
    );
    return { path: canonical, entries };
  }
  async action(
    root: string,
    action: 'mkdir' | 'rename' | 'delete',
    path: string,
    destination?: string,
  ) {
    if (posix.resolve('/', path) === '/') throw new Error('Cannot modify selected root');
    const source = await this.resolve(root, path);
    if (action === 'mkdir') return mkdir(source);
    if (action === 'rename') {
      if (!destination) throw new Error('Missing destination');
      const target = await this.resolve(root, destination);
      if (await exists(target)) throw new Error('Destination already exists');
      return rename(source, target);
    }
    const stat = await lstat(source);
    if (stat.isDirectory()) await rmdir(source);
    else await unlink(source);
  }
  async copy(
    source: string,
    target: string,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
    depth = 0,
  ): Promise<void> {
    signal.throwIfAborted();
    if (depth > 64) throw new Error('Directory nesting limit reached');
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not copied');
    if (await exists(target)) throw new Error('Destination already exists; original preserved');
    if (stat.isDirectory()) {
      await mkdir(target);
      for (const name of await readdir(source))
        await this.copy(
          join(source, name),
          join(target, safeName(name)),
          signal,
          progress,
          depth + 1,
        );
    } else {
      if (!stat.isFile()) throw new Error('Only regular files can be copied');
      progress(0, stat.size);
      const temporary = `${target}.cshell-${randomUUID()}.part`;
      try {
        await pipeline(
          createReadStream(source),
          new Transform({
            transform(data: Buffer, _encoding, done) {
              progress(data.length, 0);
              done(null, data);
            },
          }),
          createWriteStream(temporary, { flags: 'wx' }),
          { signal },
        );
        signal.throwIfAborted();
        await rename(temporary, target);
      } catch (e) {
        await unlink(temporary).catch(() => {});
        throw e;
      }
    }
  }
}
export async function exists(path: string) {
  return lstat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    },
  );
}
