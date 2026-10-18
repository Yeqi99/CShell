import { createHash } from 'node:crypto';
import type { SFTPWrapper, Stats } from 'ssh2';
import { z } from 'zod';
import { fileCreateInput } from './sftp-create';
import { ApiError } from './errors';

export const fileWriteInput = fileCreateInput
  .extend({
    offset: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 32768),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    acceptNonAtomic: z
      .literal(true)
      .describe(
        'Required acknowledgement: SFTP metadata checks cannot provide atomic compare-and-swap against external writers.',
      ),
  })
  .strict();
export const fileWriteOutput = z
  .object({
    path: z.string(),
    bytes: z.number().int().min(0).max(32768),
    nextOffset: z.number().int().nonnegative(),
    revision: z.string(),
    consistency: z.literal('metadata-best-effort'),
    atomicPublication: z.literal(false),
  })
  .strict();
export async function writeSftpChunk(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const a = fileWriteInput.parse(input);
  const bytes = Buffer.from(a.bodyBase64, 'base64');
  signal.throwIfAborted();
  const handle = await new Promise<Buffer>((resolve, reject) =>
    sftp.open(a.path, 'r+', (e, h) => (e ? reject(e) : resolve(h))),
  );
  let submitted = false;
  const stat = () =>
    new Promise<Stats>((resolve, reject) =>
      sftp.fstat(handle, (e, s) => (e ? reject(e) : resolve(s))),
    );
  const revision = (s: Stats) =>
    createHash('sha256')
      .update(JSON.stringify([a.path, s.size, s.mtime, s.mode, s.uid, s.gid]))
      .digest('hex');
  let output: z.infer<typeof fileWriteOutput> | undefined;
  let failure: unknown;
  try {
    const before = await stat();
    signal.throwIfAborted();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || a.offset > before.size)
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Write requires a regular file and an offset within its current size.',
        'Read the file before writing. Sparse writes are not supported.',
      );
    if (revision(before) !== a.revision)
      throw new ApiError(
        'CONFLICT',
        'File metadata changed before writing.',
        'Read the current content and decide whether to submit a new write.',
      );
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      signal.throwIfAborted();
      submitted = true;
      await new Promise<void>((resolve, reject) =>
        sftp.write(
          handle,
          bytes,
          offset,
          Math.min(16384, bytes.length - offset),
          a.offset + offset,
          (e) => (e ? reject(e) : resolve()),
        ),
      );
    }
    signal.throwIfAborted();
    const after = await stat();
    if (after.size !== Math.max(before.size, a.offset + bytes.length))
      throw new Error('File size changed during writing');
    output = {
      path: a.path,
      bytes: bytes.length,
      nextOffset: a.offset + bytes.length,
      revision: revision(after),
      consistency: 'metadata-best-effort',
      atomicPublication: false,
    };
  } catch (e) {
    failure = e;
  }
  try {
    await new Promise<void>((resolve, reject) =>
      sftp.close(handle, (e) => (e ? reject(e) : resolve())),
    );
  } catch (e) {
    failure ??= e;
  }
  if (failure || signal.aborted) {
    if (submitted)
      throw new ApiError(
        'OUTCOME_UNKNOWN',
        'File bytes may have changed.',
        'Inspect the target before retrying. No rollback or deletion was attempted.',
      );
    throw failure ?? signal.reason;
  }
  return output!;
}
