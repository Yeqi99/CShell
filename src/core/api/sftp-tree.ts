import { createHash } from 'node:crypto';
import type { SFTPWrapper, Stats } from 'ssh2';
import { z } from 'zod';
import { ApiError } from './errors';

// Absolute lexical paths only: ../aliases cannot be coordinated as tree domains.
const treePath = z
  .string()
  .min(2)
  .max(4096)
  .refine(
    (p) =>
      p.startsWith('/') &&
      !/[\\\0\r\n]/.test(p) &&
      !p.endsWith('/') &&
      p
        .split('/')
        .slice(1)
        .every((s) => !!s && s !== '.' && s !== '..'),
    'Use a non-root absolute path without dot segments',
  );
export const treeInspectInput = z.object({ path: treePath }).strict();
export const treeMutationInput = treeInspectInput
  .extend({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    action: z.enum(['rename', 'delete']),
    destination: treePath.optional(),
    acceptNonAtomic: z
      .literal(true)
      .describe(
        'External writers can race metadata checks; deletion can stop after partial progress. No rollback, trash or atomic snapshot.',
      ),
  })
  .strict()
  .refine(
    (a) => (a.action === 'rename' ? !!a.destination : a.destination === undefined),
    'Destination is required only for rename',
  );
export const treeInspectOutput = z
  .object({
    path: z.string(),
    revision: z.string(),
    entries: z.number().int(),
    consistency: z.literal('metadata-best-effort'),
  })
  .strict();
export const treeMutationOutput = z
  .object({
    path: z.string(),
    destination: z.string().optional(),
    action: z.enum(['rename', 'delete']),
    affectedEntries: z.number().int(),
    consistency: z.literal('metadata-best-effort'),
    durability: z.literal('server-acknowledged'),
  })
  .strict();
type Entry = { path: string; directory: boolean; stamp: string };
const metadata = (s: Stats) => JSON.stringify([s.size, s.mtime, s.mode, s.uid, s.gid]);
const lstat = (sftp: SFTPWrapper, path: string) =>
  new Promise<Stats>((resolve, reject) => sftp.lstat(path, (e, s) => (e ? reject(e) : resolve(s))));
async function ancestors(sftp: SFTPWrapper, path: string, signal: AbortSignal) {
  const parts = path.split('/').slice(1, -1);
  let current = '';
  for (const part of parts) {
    signal.throwIfAborted();
    current += '/' + part;
    const stat = await lstat(sftp, current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new ApiError(
        'CONFLICT',
        'Ancestor is not a plain directory.',
        'Choose a path without symbolic links.',
      );
  }
}
async function scan(sftp: SFTPWrapper, path: string, signal: AbortSignal) {
  await ancestors(sftp, path, signal);
  const entries: Entry[] = [];
  const visit = async (path: string, depth: number) => {
    signal.throwIfAborted();
    if (depth > 32 || entries.length >= 1000)
      throw new ApiError(
        'OVERLOADED',
        'Directory tree exceeds 1000 entries or 32 levels.',
        'Operate on smaller explicitly selected subtrees.',
      );
    const stat = await lstat(sftp, path);
    if (!(stat.isDirectory() || stat.isFile()) || stat.isSymbolicLink())
      throw new ApiError(
        'CONFLICT',
        'Tree contains a symbolic link or special file.',
        'Inspect the tree manually; this operation never follows links.',
      );
    entries.push({ path, directory: stat.isDirectory(), stamp: metadata(stat) });
    if (stat.isDirectory()) {
      const names = await new Promise<string[]>((resolve, reject) =>
        sftp.readdir(path, (e, list) =>
          e
            ? reject(e)
            : resolve(
                list
                  .map((item) => item.filename)
                  .filter((n) => n !== '.' && n !== '..')
                  .sort(),
              ),
        ),
      );
      if (names.length + entries.length > 1000)
        throw new ApiError(
          'OVERLOADED',
          'Directory tree exceeds 1000 entries.',
          'Select a smaller subtree.',
        );
      for (const name of names) {
        if (!name || /[\/\\\0]/.test(name)) throw new Error('Invalid server directory entry');
        const child = path + '/' + name;
        if (child.length > 4096) throw new Error('Tree path is too long');
        await visit(child, depth + 1);
      }
    }
  };
  await visit(path, 0);
  signal.throwIfAborted();
  if (!entries[0].directory)
    throw new ApiError(
      'INVALID_ARGUMENT',
      'Select a directory.',
      'Use the regular-file operations for files.',
    );
  return { entries, revision: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
export async function inspectSftpTree(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const { path } = treeInspectInput.parse(input);
  const tree = await scan(sftp, path, signal);
  return {
    path,
    revision: tree.revision,
    entries: tree.entries.length,
    consistency: 'metadata-best-effort' as const,
  };
}
export async function mutateSftpTree(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const a = treeMutationInput.parse(input);
  if (
    a.destination &&
    (a.destination === a.path ||
      a.destination.startsWith(a.path + '/') ||
      a.path.startsWith(a.destination + '/'))
  )
    throw new ApiError(
      'INVALID_ARGUMENT',
      'Source and destination overlap.',
      'Choose disjoint paths.',
    );
  const tree = await scan(sftp, a.path, signal);
  if (tree.revision !== a.revision)
    throw new ApiError(
      'CONFLICT',
      'Tree metadata changed.',
      'Inspect again before approving a new mutation.',
    );
  if (a.destination) {
    await ancestors(sftp, a.destination, signal);
    try {
      await lstat(sftp, a.destination);
      throw new ApiError('CONFLICT', 'Destination exists.', 'Choose an absent destination.');
    } catch (e) {
      if ((e as { code?: number }).code !== 2) throw e;
    }
  }
  let submitted = false;
  let acknowledged = 0;
  try {
    if (a.action === 'rename') {
      signal.throwIfAborted();
      submitted = true;
      await new Promise<void>((resolve, reject) =>
        sftp.rename(a.path, a.destination!, (e) => (e ? reject(e) : resolve())),
      );
      acknowledged = tree.entries.length;
    } else {
      for (const entry of [...tree.entries].reverse()) {
        signal.throwIfAborted();
        await ancestors(sftp, entry.path, signal);
        const now = await lstat(sftp, entry.path);
        // Directory timestamps change as our own children are removed. rmdir refuses new children.
        if (
          now.isSymbolicLink() ||
          now.isDirectory() !== entry.directory ||
          (!entry.directory && metadata(now) !== entry.stamp)
        )
          throw new Error('Tree changed during deletion');
        signal.throwIfAborted();
        submitted = true;
        await new Promise<void>((resolve, reject) => {
          const done = (e?: Error | null) => (e ? reject(e) : resolve());
          entry.directory ? sftp.rmdir(entry.path, done) : sftp.unlink(entry.path, done);
        });
        acknowledged++;
      }
    }
    signal.throwIfAborted();
  } catch (error) {
    if (!submitted) throw error;
    throw new ApiError(
      'OUTCOME_UNKNOWN',
      `Tree mutation stopped after ${acknowledged} acknowledged entries.`,
      'Inspect both paths and remaining contents. Partial deletion is possible; do not blindly retry. No rollback was attempted.',
    );
  }
  return {
    path: a.path,
    ...(a.destination ? { destination: a.destination } : {}),
    action: a.action,
    affectedEntries: acknowledged,
    consistency: 'metadata-best-effort' as const,
    durability: 'server-acknowledged' as const,
  };
}
