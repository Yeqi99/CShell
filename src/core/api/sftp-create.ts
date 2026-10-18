import { createHash } from 'node:crypto';
import type { SFTPWrapper } from 'ssh2';
import { z } from 'zod';
import { remotePath } from '../paths';
import { ApiError } from './errors';

export const fileCreateInput = z
  .object({
    path: z.string().max(4096).transform(remotePath),
    bodyBase64: z
      .string()
      .max(43692)
      .refine(
        (value) =>
          Buffer.from(value, 'base64').toString('base64') === value &&
          Buffer.from(value, 'base64').length <= 32768,
        'Provide canonical base64 for at most 32768 bytes',
      ),
  })
  .strict();

export const fileCreateOutput = z
  .object({
    path: z.string(),
    bytes: z.number().int().min(0).max(32768),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    condition: z.literal('exclusive-create'),
    durability: z.literal('server-acknowledged'),
    atomicPublication: z.literal(false),
  })
  .strict();

export async function createSftpFile(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const a = fileCreateInput.parse(input);
  const bytes = Buffer.from(a.bodyBase64, 'base64');
  signal.throwIfAborted();
  let handle: Buffer;
  try {
    handle = await new Promise<Buffer>((resolve, reject) =>
      sftp.open(a.path, 'wx', 0o600, (error, value) => (error ? reject(error) : resolve(value))),
    );
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 3)
      throw new ApiError(
        'FORBIDDEN',
        'Remote file creation was denied.',
        'Check the remote account and directory permissions.',
      );
    if (code === 11)
      throw new ApiError(
        'CONFLICT',
        'The target already exists.',
        'Choose another path; existing files are never overwritten.',
      );
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      'Exclusive file creation did not return a usable handle.',
      'Inspect the target before retrying; it may exist. No automatic cleanup was attempted.',
    );
  }
  let failure: unknown;
  try {
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      signal.throwIfAborted();
      const length = Math.min(16384, bytes.length - offset);
      await new Promise<void>((resolve, reject) =>
        sftp.write(handle, bytes, offset, length, offset, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }
    signal.throwIfAborted();
  } catch (error) {
    failure = error;
  }
  try {
    await new Promise<void>((resolve, reject) =>
      sftp.close(handle, (error) => (error ? reject(error) : resolve())),
    );
  } catch (error) {
    failure ??= error;
  }
  if (failure || signal.aborted)
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      'File creation may have left partial or complete content.',
      'Inspect the target before further action. No automatic deletion or retry was performed.',
    );
  return {
    path: a.path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    condition: 'exclusive-create',
    durability: 'server-acknowledged',
    atomicPublication: false,
  };
}
