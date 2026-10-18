import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FileEntry } from '../../shared/contracts';
import { remotePath } from '../paths';
import { ApiError } from './errors';

export const directoryPageInput = z
  .object({
    path: z.string().max(4096).transform(remotePath),
    limit: z.number().int().min(1).max(200).default(100),
    cursor: z.string().max(1024).optional(),
  })
  .strict();
const cursorSchema = z
  .object({
    revision: z.string().length(64),
    offset: z.number().int().nonnegative(),
    expires: z.number().int(),
  })
  .strict();

export const directoryPageOutput = z
  .object({
    path: z.string(),
    revision: z.string().length(64),
    total: z.number().int().nonnegative(),
    consistency: z.literal('metadata-best-effort'),
    entries: z
      .array(
        z
          .object({
            name: z.string(),
            path: z.string(),
            directory: z.boolean(),
            symlink: z.boolean(),
            size: z.number(),
            modified: z.number(),
          })
          .strict(),
      )
      .max(200),
    nextCursor: z.string().max(1024).nullable(),
  })
  .strict();

/** Per-live-connection cursor signer. Retains no directory snapshots or open handles. */
export class DirectoryPages {
  private secret = randomBytes(32);
  private signature(body: string) {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
  page(list: { path: string; entries: FileEntry[] }, input: unknown) {
    const a = directoryPageInput.parse(input);
    const hash = createHash('sha256').update(JSON.stringify([a.path, list.path]));
    for (const entry of list.entries) hash.update(JSON.stringify(entry)).update('\n');
    const revision = hash.digest('hex');
    let offset = 0,
      expires = Date.now() + 300000;
    if (a.cursor) {
      try {
        const parts = a.cursor.split('.');
        if (parts.length !== 2 || this.signature(parts[0]) !== parts[1]) throw new Error();
        const decoded = cursorSchema.parse(
          JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
        );
        if (
          decoded.revision !== revision ||
          decoded.expires <= Date.now() ||
          decoded.offset > list.entries.length
        )
          throw new Error();
        offset = decoded.offset;
        expires = decoded.expires;
      } catch {
        throw new ApiError(
          'CURSOR_EXPIRED',
          'Directory cursor is invalid, expired or the listing changed.',
          'Restart without a cursor on this same connection; discard previous pages.',
        );
      }
    }
    const envelope = {
      path: list.path,
      revision,
      total: list.entries.length,
      consistency: 'metadata-best-effort',
      entries: [] as FileEntry[],
      nextCursor: 'x'.repeat(512) as string | null,
    };
    let bytes = Buffer.byteLength(JSON.stringify(envelope));
    if (bytes > 65536)
      throw new ApiError(
        'BUDGET_TOO_SMALL',
        'Directory metadata exceeds the page byte budget.',
        'Use a shorter canonical path or inspect it in the desktop file view.',
      );
    const entries: FileEntry[] = [];
    for (const entry of list.entries.slice(offset, offset + a.limit)) {
      const size = Buffer.byteLength(JSON.stringify(entry)) + (entries.length ? 1 : 0);
      if (bytes + size > 65536) break;
      bytes += size;
      entries.push(entry);
    }
    if (!entries.length && offset < list.entries.length)
      throw new ApiError(
        'BUDGET_TOO_SMALL',
        'A directory entry exceeds the page byte budget.',
        'Use the desktop file view to inspect this directory.',
      );
    let nextCursor: string | null = null;
    if (offset + entries.length < list.entries.length) {
      const body = Buffer.from(
        JSON.stringify({ revision, offset: offset + entries.length, expires }),
      ).toString('base64url');
      nextCursor = `${body}.${this.signature(body)}`;
    }
    return { ...envelope, entries, nextCursor };
  }
}
