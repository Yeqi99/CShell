import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, link, unlink } from 'node:fs/promises';
import { isAbsolute, dirname, join, posix } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { SFTPWrapper } from 'ssh2';
import type { ConnectionTool } from './connections/contracts';

const paths = z
  .object({
    localPath: z.string().max(32767).refine(isAbsolute),
    remotePath: z
      .string()
      .max(4096)
      .regex(/^\//)
      .refine((p) => !p.includes('\0') && !p.split('/').includes('..')),
  })
  .strict();
export function localSshTransfers(sftp: () => Promise<SFTPWrapper>): ConnectionTool[] {
  return (['upload', 'download'] as const).map((direction) => ({
    name: 'local_desktop_' + direction,
    capability: 'local.desktop',
    needsReview: () => true,
    input: paths,
    description:
      direction === 'upload'
        ? 'Stream a regular LOCAL file to a new absolute path on the bound SSH server. Returns bytes and SHA-256.'
        : 'Stream a regular file from the bound SSH server to a new absolute LOCAL path. Returns bytes and SHA-256.',
    invoke: async (raw, signal) => {
      const { localPath, remotePath } = paths.parse(raw);
      const remote = await sftp(),
        hash = createHash('sha256');
      let bytes = 0;
      const meter = new Transform({
        transform(chunk, _encoding, done) {
          hash.update(chunk);
          bytes += chunk.length;
          done(null, chunk);
        },
      });
      const temporary = '.cshell-' + randomUUID() + '.part';
      if (direction === 'upload') {
        if (!(await lstat(localPath)).isFile()) throw Error('本机源路径必须是普通文件');
        const staging = posix.join(posix.dirname(remotePath), temporary);
        await new Promise<void>((ok, fail) =>
          remote.lstat(remotePath, (err) =>
            (err as { code?: number } | undefined)?.code === 2
              ? ok()
              : fail(err ?? Error('远端目标已存在')),
          ),
        );
        try {
          await pipeline(
            createReadStream(localPath),
            meter,
            remote.createWriteStream(staging, { flags: 'wx', mode: 0o600 }),
            { signal },
          );
          signal.throwIfAborted();
          await new Promise<void>((ok, fail) =>
            remote.rename(staging, remotePath, (e) => (e ? fail(e) : ok())),
          );
        } catch (error) {
          remote.unlink(staging, () => {});
          throw error;
        }
      } else {
        await new Promise<void>((ok, fail) =>
          remote.lstat(remotePath, (e, st) =>
            e ? fail(e) : st.isFile() ? ok() : fail(Error('远端源路径必须是普通文件')),
          ),
        );
        const staging = join(dirname(localPath), temporary);
        try {
          await pipeline(
            remote.createReadStream(remotePath),
            meter,
            createWriteStream(staging, { flags: 'wx', mode: 0o600 }),
            { signal },
          );
          signal.throwIfAborted();
          await link(staging, localPath);
        } finally {
          await unlink(staging).catch((e) => {
            if (e.code !== 'ENOENT') throw e;
          });
        }
      }
      return JSON.stringify({
        direction,
        localPath,
        remotePath,
        bytes,
        sha256: hash.digest('hex'),
      });
    },
  }));
}
