import { createHash } from 'node:crypto';
import type { SFTPWrapper, Stats } from 'ssh2';
import { z } from 'zod';
import { remotePath } from '../paths';
import { ApiError } from './errors';

export const fileDeleteInput = z
  .object({
    path: z.string().max(4096).transform(remotePath),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    acceptNonAtomic: z
      .literal(true)
      .describe(
        'The metadata check and deletion are not atomic against external path replacement.',
      ),
  })
  .strict();
export const fileDeleteOutput = z
  .object({
    path: z.string(),
    deleted: z.literal(true),
    consistency: z.literal('metadata-best-effort'),
    durability: z.literal('server-acknowledged'),
  })
  .strict();

export async function deleteSftpFile(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const a = fileDeleteInput.parse(input);
  signal.throwIfAborted();
  const source = await new Promise<Stats>((resolve, reject) =>
    sftp.lstat(a.path, (e, s) => (e ? reject(e) : resolve(s))),
  );
  signal.throwIfAborted();
  if (!source.isFile())
    throw new ApiError(
      'INVALID_ARGUMENT',
      'Only regular files can be deleted by this operation.',
      'Select a regular file; directories and symlinks are not supported.',
    );
  const revision = createHash('sha256')
    .update(
      JSON.stringify([a.path, source.size, source.mtime, source.mode, source.uid, source.gid]),
    )
    .digest('hex');
  if (revision !== a.revision)
    throw new ApiError(
      'CONFLICT',
      'File metadata changed.',
      'Read the current file and decide whether to delete it.',
    );
  try {
    await new Promise<void>((resolve, reject) =>
      sftp.unlink(a.path, (e) => (e ? reject(e) : resolve())),
    );
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 3)
      throw new ApiError(
        'FORBIDDEN',
        'Remote deletion was denied.',
        'Check remote account permissions.',
      );
    if (code === 8)
      throw new ApiError(
        'UNAVAILABLE',
        'Remote deletion is unsupported.',
        'Use a provider supporting this operation.',
      );
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      'Deletion did not return a successful acknowledgement.',
      'Inspect the path before further action. Do not automatically retry against a potentially replaced file.',
    );
  }
  if (signal.aborted)
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      'Deletion was acknowledged after cancellation.',
      'Inspect the path. No restoration was attempted.',
    );
  return {
    path: a.path,
    deleted: true as const,
    consistency: 'metadata-best-effort' as const,
    durability: 'server-acknowledged' as const,
  };
}
