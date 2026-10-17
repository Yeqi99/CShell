import { createHash } from 'node:crypto';
import { lstat, open, mkdir, rename, unlink, rmdir } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ApiLocalFiles, type LocalFileRoot } from './local-file-read';
import { ApiError } from './errors';
import { fileCreateInput } from './sftp-create';

const path = z
  .string()
  .min(2)
  .max(4096)
  .refine(
    (s) =>
      s.startsWith('/') &&
      !/[\\:\0\r\n]/.test(s) &&
      s
        .split('/')
        .slice(1)
        .every((part) => part && part !== '.' && part !== '..'),
    'Use a non-root absolute root-relative path without empty or dot components',
  );
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const base = { path, acceptNonAtomic: z.literal(true) };
export const localStatInput = z.object({ rootId: z.string().uuid(), path }).strict();
export const localMutationInput = z
  .object({
    rootId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(128),
    operation: z.discriminatedUnion('action', [
      z
        .object({
          ...base,
          action: z.literal('create'),
          bodyBase64: fileCreateInput.shape.bodyBase64,
        })
        .strict(),
      z
        .object({
          ...base,
          action: z.literal('write'),
          revision,
          offset: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER - 32768),
          bodyBase64: fileCreateInput.shape.bodyBase64,
        })
        .strict(),
      z.object({ ...base, action: z.literal('rename'), revision, destination: path }).strict(),
      z.object({ ...base, action: z.literal('delete'), revision }).strict(),
      z.object({ ...base, action: z.literal('mkdir') }).strict(),
      z.object({ ...base, action: z.literal('rmdir'), revision }).strict(),
      z.object({ ...base, action: z.literal('renameDirectory'), revision, destination: path }).strict(),
    ]),
  })
  .strict();
export const localStatOutput = z
  .object({
    path: z.string(),
    directory: z.boolean(),
    size: z.number().nonnegative(),
    revision,
    consistency: z.literal('metadata-best-effort'),
  })
  .strict();
export const localMutationOutput = z
  .object({
    action: z.string(),
    path: z.string(),
    destination: z.string().optional(),
    bytes: z.number().int().nonnegative().optional(),
    consistency: z.literal('metadata-best-effort'),
    atomicPublication: z.literal(false),
  })
  .strict();
const stamp = (root: LocalFileRoot, path: string, stat: Stats) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        root.identity,
        path,
        stat.dev,
        stat.ino,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
      ]),
    )
    .digest('hex');

/** Reservations coordinate this API's lexical paths, not external OS writers or hard links. */
export function localMutationLocks(
  root: LocalFileRoot,
  operation: z.infer<typeof localMutationInput>['operation'],
) {
  return [operation.path, ...('destination' in operation ? [operation.destination] : [])].map(
    (p) => {
      let absolute = resolve(root.path, ...p.split('/').filter(Boolean)).replaceAll('\\', '/');
      if (process.platform === 'win32') absolute = absolute.toLowerCase();
      return `tree:${absolute}`;
    },
  );
}
export async function inspectLocalFile(
  files: ApiLocalFiles,
  root: LocalFileRoot,
  path: string,
  check: () => void,
) {
  const { target } = await files.resolve(root, path, check);
  const info = await lstat(target);
  await files.resolve(root, path, check);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
    throw new ApiError(
      'INVALID_ARGUMENT',
      'Select a regular file or directory.',
      'List the authorized root again.',
    );
  return localStatOutput.parse({
    path,
    directory: info.isDirectory(),
    size: info.size,
    revision: stamp(root, path, info),
    consistency: 'metadata-best-effort',
  });
}
export async function mutateLocalFile(
  files: ApiLocalFiles,
  root: LocalFileRoot,
  operation: z.infer<typeof localMutationInput>['operation'],
  check: () => void,
) {
  const { target } = await files.resolve(root, operation.path, check);
  let submitted = false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if ('revision' in operation) {
      const info = await lstat(target);
      if (stamp(root, operation.path, info) !== operation.revision)
        throw new ApiError(
          'CONFLICT',
          'Local path changed.',
          'Inspect the current path and decide again.',
        );
      if (
        info.isSymbolicLink() ||
        (operation.action === 'rmdir' || operation.action === 'renameDirectory' ? !info.isDirectory() : !info.isFile())
      )
        throw new ApiError(
          'INVALID_ARGUMENT',
          'Operation does not support this file type.',
          'Use rmdir only for an empty directory; other mutations require regular files.',
        );
    }
    if (operation.action === 'rename' || operation.action === 'renameDirectory') {
      if (operation.action === 'renameDirectory') {
        const [source, destination] = localMutationLocks(root, operation);
        if (destination.startsWith(source + '/') || source.startsWith(destination + '/'))
          throw new ApiError('INVALID_ARGUMENT', 'Directory source and destination overlap.', 'Choose an absent destination outside the source tree.');
      }
      if (operation.destination === operation.path)
        throw new ApiError(
          'INVALID_ARGUMENT',
          'Source and destination are identical.',
          'Choose a different destination.',
        );
      const destination = (await files.resolve(root, operation.destination, check)).target;
      const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (existing)
        throw new ApiError(
          'CONFLICT',
          'Destination already exists.',
          'Choose an absent destination; do not overwrite.',
        );
      await files.resolve(root, operation.path, check);
      check();
      submitted = true;
      await rename(target, destination);
    } else if (operation.action === 'write' || operation.action === 'create') {
      if (operation.action === 'create') {
        check();
        submitted = true;
      }
      handle = await open(target, operation.action === 'create' ? 'wx' : 'r+', 0o600);
      await files.resolve(root, operation.path, check);
      const opened = await handle.stat(),
        current = await lstat(target);
      if (
        !opened.isFile() ||
        current.isSymbolicLink() ||
        opened.dev !== current.dev ||
        opened.ino !== current.ino
      )
        throw new ApiError(
          'CONFLICT',
          'File identity changed while opening.',
          'Inspect the path before any retry.',
        );
      if (
        operation.action === 'write' &&
        (stamp(root, operation.path, opened) !== operation.revision ||
          operation.offset > opened.size)
      )
        throw new ApiError(
          'CONFLICT',
          'Revision or offset changed.',
          'Read current metadata; sparse writes and truncation are unsupported.',
        );
      const body = Buffer.from(operation.bodyBase64, 'base64');
      let written = 0;
      while (written < body.length) {
        check();
        submitted = true;
        const result = await handle.write(
          body,
          written,
          body.length - written,
          (operation.action === 'write' ? operation.offset : 0) + written,
        );
        if (!result.bytesWritten) throw new Error('No write progress');
        written += result.bytesWritten;
      }
      await handle.sync();
    } else {
      await files.resolve(root, operation.path, check);
      check();
      submitted = true;
      if (operation.action === 'mkdir') await mkdir(target, { mode: 0o700 });
      else if (operation.action === 'rmdir') await rmdir(target);
      else await unlink(target);
    }
    check();
    return localMutationOutput.parse({
      action: operation.action,
      path: operation.path,
      ...('destination' in operation ? { destination: operation.destination } : {}),
      ...('bodyBase64' in operation
        ? { bytes: Buffer.from(operation.bodyBase64, 'base64').length }
        : {}),
      consistency: 'metadata-best-effort',
      atomicPublication: false,
    });
  } catch (error) {
    if (submitted)
      throw new ApiError(
        'OUTCOME_UNKNOWN',
        'Local mutation was submitted; effects may be partial.',
        'Inspect the path before another action. No rollback or automatic retry.',
        { reason: error instanceof ApiError ? error.code : 'IO_OR_CANCELLATION' },
      );
    throw error;
  } finally {
    try {
      await handle?.close();
    } catch {
      throw new ApiError(
        'OUTCOME_UNKNOWN',
        'File handle close failed.',
        'Inspect the file before another operation; do not automatically retry.',
      );
    }
  }
}
