import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './errors';

export const disclosureLevels = ['names', 'summary', 'contract', 'guide'] as const;
export const discoverySchema = z
  .object({
    level: z.enum(disclosureLevels).default('summary'),
    query: z.string().max(200).default(''),
    capabilityId: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        'Exact stable ID from a previous catalog response; combine with level=contract or guide.',
      ),
    cursor: z.string().max(4096).optional(),
    limit: z.number().int().min(1).max(100).default(30),
    budgetBytes: z.number().int().min(512).max(262144).default(32768),
  })
  .strict();
export interface CapabilityDefinition {
  id: string;
  name: string;
  description: string;
  input: z.ZodType;
  output: Record<string, unknown>;
  permission: string;
  effects: 'read' | 'write';
  target: string;
  prerequisites: string[];
  cancellation: string;
  retry: string;
  examples: { input: unknown; explanation: string }[];
}
type CatalogRecord = Omit<CapabilityDefinition, 'input'> & { input: Record<string, unknown> };

/** One contract source; grants are filtered before hashing, counting, searching or pagination. */
export class CapabilityCatalog {
  private key = randomBytes(32);
  private records: CatalogRecord[];
  private hashes = new Map<string, string>();
  private views = new Map<string, { value: Record<string, unknown>; bytes: number }>();
  constructor(definitions: readonly CapabilityDefinition[]) {
    const ids = new Set<string>();
    this.records = definitions
      .map((d) => {
        if (ids.has(d.id)) throw new Error('Duplicate capability ID');
        ids.add(d.id);
        const record = structuredClone({
          ...d,
          input: z.toJSONSchema(d.input, { io: 'input' }) as Record<string, unknown>,
        });
        const freeze = (value: unknown) => {
          if (value && typeof value === 'object') {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
          }
        };
        freeze(record);
        this.hashes.set(d.id, createHash('sha256').update(JSON.stringify(record)).digest('hex'));
        return record;
      })
      .sort((a, b) => a.id.localeCompare(b.id, 'en'));
    for (const record of this.records)
      for (const level of disclosureLevels) {
        const value = Object.freeze(this.project(record, level));
        this.views.set(`${record.id}:${level}`, {
          value,
          bytes: Buffer.byteLength(JSON.stringify(value)),
        });
      }
  }
  private sign(payload: string) {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
  private decode(cursor: string) {
    const parts = cursor.split('.');
    if (parts.length !== 2)
      throw new ApiError('CURSOR_EXPIRED', 'Invalid catalog cursor.', 'Restart discovery without a cursor.');
    const [payload, signature = ''] = parts;
    const expected = Buffer.from(this.sign(payload)),
      actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new ApiError(
        'CURSOR_EXPIRED',
        'Invalid catalog cursor.',
        'Restart discovery without a cursor.',
      );
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        offset: number;
        binding: string;
      };
    } catch {
      throw new ApiError(
        'CURSOR_EXPIRED',
        'Invalid catalog cursor.',
        'Restart discovery without a cursor.',
      );
    }
  }
  discover(
    owner: string,
    policyRevision: string,
    visible: (d: CatalogRecord) => boolean,
    value: unknown = {},
  ) {
    const parsed = discoverySchema.safeParse(value);
    if (!parsed.success)
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Invalid discovery options.',
        'Use the discovery input schema.',
      );
    const args = parsed.data;
    const authorized = this.records.filter(visible);
    const revision = createHash('sha256')
      .update(JSON.stringify([owner, policyRevision, authorized.map((d) => this.hashes.get(d.id))]))
      .digest('hex');
    const query = args.query.toLowerCase();
    const records = authorized.filter(
      (d) =>
        (!args.capabilityId || args.capabilityId === d.id) &&
        `${d.id} ${d.name} ${d.description}`.toLowerCase().includes(query),
    );
    const binding = createHash('sha256')
      .update(JSON.stringify([revision, query, args.level, args.capabilityId]))
      .digest('hex');
    let offset = 0;
    if (args.cursor) {
      const cursor = this.decode(args.cursor);
      if (
        cursor.binding !== binding ||
        !Number.isSafeInteger(cursor.offset) ||
        cursor.offset < 0 ||
        cursor.offset > records.length
      )
        throw new ApiError(
          'CURSOR_EXPIRED',
          'Catalog, permissions or query changed.',
          'Restart discovery without a cursor.',
        );
      offset = cursor.offset;
    }
    const items: Record<string, unknown>[] = [];
    let itemBytes = 0;
    const response = (next: number, sign = true) => {
      const payload = Buffer.from(JSON.stringify({ offset: next, binding })).toString('base64url');
      return {
        apiVersion: '1',
        revision,
        level: args.level,
        total: records.length,
        items,
        nextCursor:
          next < records.length ? `${payload}.${sign ? this.sign(payload) : 'x'.repeat(43)}` : null,
      };
    };
    for (let i = offset; i < records.length && items.length < args.limit; i++) {
      const view = this.views.get(`${records[i].id}:${args.level}`)!;
      items.push(view.value);
      itemBytes += view.bytes;
      const bytes =
        Buffer.byteLength(JSON.stringify({ ...response(i + 1, false), items: [] })) +
        itemBytes +
        items.length -
        1;
      if (bytes > args.budgetBytes) {
        items.pop();
        itemBytes -= view.bytes;
        if (!items.length)
          throw new ApiError(
            'BUDGET_TOO_SMALL',
            'A complete capability does not fit the response budget.',
            'Increase budgetBytes or select a lower detail level.',
            { requiredBytes: bytes },
          );
        break;
      }
    }
    return response(offset + items.length);
  }
  private project(
    d: CatalogRecord,
    level: (typeof disclosureLevels)[number],
  ): Record<string, unknown> {
    const base = { id: d.id, name: d.name, version: this.hashes.get(d.id)! };
    if (level === 'names') return base;
    const summary = {
      ...base,
      description: d.description,
      target: d.target,
      permission: d.permission,
      effects: d.effects,
    };
    if (level === 'summary') return summary;
    const contract = {
      ...summary,
      inputSchema: d.input,
      outputSchema: d.output,
      prerequisites: d.prerequisites,
      cancellation: d.cancellation,
      retry: d.retry,
    };
    return level === 'guide' ? { ...contract, examples: d.examples } : contract;
  }
}
