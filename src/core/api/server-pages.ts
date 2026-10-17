import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './errors';

export const serverSummary = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    host: z.string(),
    port: z.number().int(),
    username: z.string(),
    protocol: z.enum(['ssh', 'client']),
  })
  .strict();
export const serverPageInput = z
  .object({
    query: z.string().max(256).default(''),
    limit: z.number().int().min(1).max(200).default(100),
    budgetBytes: z.number().int().min(512).max(262144).default(65536),
    cursor: z.string().max(1024).optional(),
  })
  .strict();
export const serverPageOutput = z
  .object({
    version: z.string().length(64),
    total: z.number().int().nonnegative(),
    items: z.array(serverSummary).max(200),
    nextCursor: z.string().nullable(),
    remaining: z.number().int().nonnegative(),
  })
  .strict();
const cursorSchema = z
  .object({
    version: z.string().length(64),
    offset: z.number().int().nonnegative(),
    expires: z.number().int(),
  })
  .strict();

/** Stateless cursors: callers supply only their already authorization-filtered summaries. */
export class ServerPages {
  private readonly secret = randomBytes(32);
  private sign(body: string) {
    return createHmac('sha256', this.secret).update(body).digest();
  }
  page(
    owner: string,
    generation: number,
    visible: z.infer<typeof serverSummary>[],
    input: unknown,
  ) {
    const a = serverPageInput.parse(input);
    const query = a.query.trim().toLowerCase();
    const ordered = [...visible].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const version = createHash('sha256')
      .update(JSON.stringify([owner, generation, query, ordered]))
      .digest('hex');
    const entries = ordered.filter((p) =>
      [p.name, p.host, p.username, p.protocol].some((value) => value.toLowerCase().includes(query)),
    );
    let offset = 0,
      expires = Date.now() + 300000;
    if (a.cursor) {
      try {
        const parts = a.cursor.split('.');
        if (parts.length !== 2) throw new Error();
        const signature = Buffer.from(parts[1], 'base64url');
        const expected = this.sign(parts[0]);
        if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
          throw new Error();
        const parsed = cursorSchema.parse(
          JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
        );
        if (
          parsed.version !== version ||
          parsed.expires <= Date.now() ||
          parsed.offset > entries.length
        )
          throw new Error();
        ({ offset, expires } = parsed);
      } catch {
        throw new ApiError(
          'CURSOR_EXPIRED',
          'Connection directory cursor is invalid or stale.',
          'Start discovery again without a cursor.',
        );
      }
    }
    const result = (items: z.infer<typeof serverSummary>[]) => {
      const next = offset + items.length;
      const body = Buffer.from(JSON.stringify({ version, offset: next, expires })).toString(
        'base64url',
      );
      return {
        version,
        total: entries.length,
        items,
        remaining: entries.length - next,
        nextCursor:
          next < entries.length ? `${body}.${this.sign(body).toString('base64url')}` : null,
      };
    };
    const items: z.infer<typeof serverSummary>[] = [];
    for (const entry of entries.slice(offset, offset + a.limit)) {
      const candidate = result([...items, entry]);
      if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > a.budgetBytes) {
        if (!items.length)
          throw new ApiError(
            'BUDGET_TOO_SMALL',
            'One complete connection summary exceeds the response budget.',
            'Increase budgetBytes; no fields were truncated.',
          );
        break;
      }
      items.push(entry);
    }
    return result(items);
  }
}
