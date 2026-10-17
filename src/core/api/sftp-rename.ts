import { createHash } from 'node:crypto';
import type { SFTPWrapper, Stats } from 'ssh2';
import { z } from 'zod';
import { remotePath, remoteFileConflict } from '../paths';
import { ApiError } from './errors';

export const fileRenameInput = z
  .object({
    path: z.string().max(4096).transform(remotePath),
    destination: z.string().max(4096).transform(remotePath),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    acceptNonAtomic: z
      .literal(true)
      .describe(
        'Metadata and destination checks are not atomic against external writers or path replacement.',
      ),
  })
  .strict();
export const fileRenameOutput = z
  .object({
    path: z.string(),
    destination: z.string(),
    renamed: z.literal(true),
    consistency: z.literal('metadata-best-effort'),
    durability: z.literal('server-acknowledged'),
  })
  .strict();

export async function renameSftpFile(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const a = fileRenameInput.parse(input);
  signal.throwIfAborted();
  if (remoteFileConflict(a.path) === remoteFileConflict(a.destination))
    throw new ApiError(
      'INVALID_ARGUMENT',
      'Source and destination are the same path.',
      'Choose a different destination.',
    );
  const stat = (path: string) =>
    new Promise<Stats>((resolve, reject) =>
      sftp.lstat(path, (e, s) => (e ? reject(e) : resolve(s))),
    );
  const source = await stat(a.path);
  signal.throwIfAborted();
  if (!source.isFile())
    throw new ApiError(
      'INVALID_ARGUMENT',
      'Only regular files can be renamed by this operation.',
      'Select a regular file; directory and symlink moves are not supported.',
    );
  const revision = createHash('sha256')
    .update(
      JSON.stringify([a.path, source.size, source.mtime, source.mode, source.uid, source.gid]),
    )
    .digest('hex');
  if (revision !== a.revision)
    throw new ApiError(
      'CONFLICT',
      'Source metadata changed.',
      'Read the source again and decide whether to rename it.',
    );
  let destinationExists = true;
  try {
    await stat(a.destination);
  } catch (error) {
    if ((error as { code?: number }).code !== 2) throw error;
    destinationExists = false;
  }
  signal.throwIfAborted();
  if (destinationExists)
    throw new ApiError(
      'CONFLICT',
      'Destination exists.',
      'Choose an absent destination. No overwrite was attempted.',
    );
  try {
    // Standard SFTP rename, never the overwrite-capable OpenSSH posix-rename extension.
    await new Promise<void>((resolve, reject) =>
      sftp.rename(a.path, a.destination, (e) => (e ? reject(e) : resolve())),
    );
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 3)
      throw new ApiError(
        'FORBIDDEN',
        'Remote rename was denied.',
        'Check remote account permissions.',
      );
    if (code === 8)
      throw new ApiError(
        'UNAVAILABLE',
        'Remote rename is unsupported.',
        'Use a provider supporting this operation.',
      );
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      'Rename did not return a successful acknowledgement.',
      'Inspect both paths before retrying. No retry or rollback was attempted.',
    );
  }
  if (signal.aborted)
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      'Rename was acknowledged after cancellation.',
      'Inspect both paths. No rollback was attempted.',
    );
  return {
    path: a.path,
    destination: a.destination,
    renamed: true as const,
    consistency: 'metadata-best-effort' as const,
    durability: 'server-acknowledged' as const,
  };
}
