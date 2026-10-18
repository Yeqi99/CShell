import { createHash } from 'node:crypto';
import type { SFTPWrapper, Stats } from 'ssh2';
import { z } from 'zod';
import { remotePath } from '../paths';
import { ApiError } from './errors';

export const fileChunkInput = z
  .object({
    path: z.string().max(4096).transform(remotePath),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
    limitBytes: z.number().int().min(1).max(65536).default(16384),
    revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

/** SFTP v3 attributes are weak validators, never a content snapshot or an atomic CAS. */
export const fileChunkOutput = z
  .object({
    path: z.string(),
    offset: z.number().int().nonnegative(),
    encoding: z.literal('base64'),
    body: z.string().max(87384),
    size: z.number().int().nonnegative(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    consistency: z.literal('metadata-best-effort'),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();

export async function readSftpChunk(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const a = fileChunkInput.parse(input);
  if (a.offset > 0 && !a.revision)
    throw new ApiError(
      'INVALID_ARGUMENT',
      'Continuation requires the previous revision.',
      'Read offset zero first and retain its revision.',
    );
  signal.throwIfAborted();
  const handle = await new Promise<Buffer>((resolve, reject) =>
    sftp.open(a.path, 'r', (error, value) => (error ? reject(error) : resolve(value))),
  );
  try {
    signal.throwIfAborted();
    const stat = () =>
      new Promise<Stats>((resolve, reject) =>
        sftp.fstat(handle, (error, value) => (error ? reject(error) : resolve(value))),
      );
    const revisionOf = (s: Stats) =>
      createHash('sha256')
        .update(JSON.stringify([a.path, s.size, s.mtime, s.mode, s.uid, s.gid]))
        .digest('hex');
    const before = await stat();
    signal.throwIfAborted();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0)
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Target is not a regular file with a supported size.',
        'Select a regular file from the directory listing.',
      );
    const revision = revisionOf(before);
    const changed = () =>
      new ApiError(
        'CONFLICT',
        'File metadata changed during reading.',
        'Discard the assembled bytes and restart at offset zero; no snapshot is guaranteed.',
      );
    if (a.revision && a.revision !== revision) throw changed();
    if (a.offset > before.size)
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Offset exceeds file size.',
        'Use nextOffset from the preceding chunk.',
      );
    const buffer = Buffer.alloc(Math.min(a.limitBytes, before.size - a.offset));
    let read = 0;
    while (read < buffer.length) {
      signal.throwIfAborted();
      const count = await new Promise<number>((resolve, reject) =>
        sftp.read(handle, buffer, read, buffer.length - read, a.offset + read, (error, size) =>
          error ? reject(error) : resolve(size),
        ),
      );
      if (!Number.isInteger(count) || count < 1 || count > buffer.length - read) throw changed();
      read += count;
    }
    signal.throwIfAborted();
    if (revisionOf(await stat()) !== revision) throw changed();
    signal.throwIfAborted();
    return {
      path: a.path,
      offset: a.offset,
      encoding: 'base64',
      body: buffer.toString('base64'),
      size: before.size,
      revision,
      consistency: 'metadata-best-effort',
      nextOffset: a.offset + read < before.size ? a.offset + read : null,
    };
  } finally {
    // Always release this handle, including on cancellation. Never close the shared SFTP channel.
    await new Promise<void>((resolve, reject) =>
      sftp.close(handle, (error) => (error ? reject(error) : resolve())),
    );
  }
}
