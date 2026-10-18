import type { SFTPWrapper } from 'ssh2';
import { z } from 'zod';
import { remotePath } from '../paths';
import { ApiError } from './errors';

export const directoryCreateInput = z
  .object({
    path: z.string().max(4096).transform(remotePath),
  })
  .strict();
export const directoryCreateOutput = z
  .object({
    path: z.string(),
    created: z.literal(true),
    requestedMode: z.literal('0700'),
    durability: z.literal('server-acknowledged'),
  })
  .strict();

/** One MKDIR request: no recursive parents, chmod, overwrite or automatic retry. */
export async function createSftpDirectory(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const { path } = directoryCreateInput.parse(input);
  signal.throwIfAborted();
  try {
    await new Promise<void>((resolve, reject) =>
      sftp.mkdir(path, { mode: 0o700 }, (error) => (error ? reject(error) : resolve())),
    );
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 3)
      throw new ApiError(
        'FORBIDDEN',
        'Remote directory creation was denied.',
        'Check the remote account and parent directory permissions.',
      );
    if (code === 11)
      throw new ApiError(
        'CONFLICT',
        'The path already exists.',
        'Choose another path; existing directories are not treated as successful creation.',
      );
    if (code === 8)
      throw new ApiError(
        'UNAVAILABLE',
        'The server does not support directory creation.',
        'Use a provider that supports this operation.',
      );
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      'Directory creation did not return a successful acknowledgement.',
      'Inspect the path before retrying. No retry or cleanup was attempted.',
    );
  }
  if (signal.aborted)
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      'Directory creation was acknowledged after cancellation.',
      'Inspect the path before further action. The directory was not removed.',
    );
  return {
    path,
    created: true as const,
    requestedMode: '0700' as const,
    durability: 'server-acknowledged' as const,
  };
}
