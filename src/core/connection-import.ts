import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { connectionsFromCsv, connectionsFromText, readConnectionCsv, type ImportColumn } from '../shared/connection-batch';
import { profileSchema, type Profile } from '../shared/contracts';
import type { Store } from './store';

const mappingSchema = z.object(Object.fromEntries(
  ['name','host','port','username','password','group','protocol'].map(key => [key, z.number().int().min(0).max(99).optional()]),
)).strict();
const optionsSchema = z.object({
  mapping: mappingSchema.optional(),
  username: z.string().trim().max(128).default(''),
}).strict();
type Source = { text: string; kind: 'csv' | 'text'; delimiter: ',' | ';' | '\t'; expires: number; values: Map<number, { profile: Profile; password?: string }> };
export type { ConnectionImportPreview } from '../shared/connection-batch';
import type { ConnectionImportPreview } from '../shared/connection-batch';
export class ConnectionImport {
  private sources = new Map<string, Source>();
  constructor(private store: Store, private now = Date.now) {}
  private source(token: string) {
    for (const [id, source] of this.sources) if (source.expires < this.now()) this.sources.delete(id);
    const source = this.sources.get(token);
    if (!source) throw new Error('导入预览已失效，请重新选择来源');
    return source;
  }
  prepare(text: string, kind: 'csv' | 'text', delimiter: ',' | ';' | '\t' = ','): ConnectionImportPreview {
    z.string().max(2 * 1024 * 1024).parse(text);
    z.enum(['csv', 'text']).parse(kind); z.enum([',', ';', '\t']).parse(delimiter);
    const token = randomUUID();
    while (this.sources.size >= 4) this.sources.delete(this.sources.keys().next().value!);
    this.sources.set(token, { text, kind, delimiter, expires: this.now() + 10 * 60_000, values: new Map() });
    try { return this.preview(token, {}); }
    catch (error) { this.sources.delete(token); throw error; }
  }
  preview(token: string, options: unknown): ConnectionImportPreview {
    const source = this.source(token);
    const input = optionsSchema.parse(options);
    const table = source.kind === 'csv' ? readConnectionCsv(source.text, source.delimiter) : undefined;
    const mapping = (input.mapping ?? table?.mapping ?? {}) as Partial<Record<ImportColumn, number>>;
    source.values.clear();
    const result: ConnectionImportPreview = { token, headers: table?.headers ?? [], mapping, rows: [] };
    if (table && mapping.host === undefined) return result;
    const rows = table ? connectionsFromCsv(table, mapping) : connectionsFromText(source.text);
    const key = (p: Profile) => JSON.stringify([p.protocol ?? 'ssh', p.host.toLowerCase().replace(/\.$/, ''), p.port, p.username]);
    const known = new Set(this.store.snapshot().profiles.map(key));
    for (const row of rows) {
      if (!row.connection) { result.rows.push({ row: row.row, error: row.error }); continue; }
      const { fields, providerId } = row.connection;
      if (!['cshell.ssh', 'cshell.rdp', 'cshell.sftp', 'cshell.ftp', 'cshell.ftps'].includes(providerId)) { result.rows.push({ row: row.row, error: '此连接类型不能批量导入' }); continue; }
      const username = fields.username || input.username;
      if (!username) { result.rows.push({ row: row.row, host: fields.host, error: '缺少用户名，可填写默认用户名或重新映射列' }); continue; }
      const protocol=providerId.slice(7);
      const parsed = profileSchema.safeParse({ id: randomUUID(), name: fields.name || fields.host, protocol, host: fields.host, port: fields.port ?? (protocol === 'rdp' ? 3389 : ['ftp','ftps'].includes(protocol) ? 21 : 22), username, group: row.group ?? fields.group ?? '', favorite: false, auth: fields.auth ?? 'password' });
      if (!parsed.success) { result.rows.push({ row: row.row, error: '连接信息不完整或格式不正确' }); continue; }
      const profile = parsed.data;
      source.values.set(row.row, { profile, password: fields.password });
      result.rows.push({ row: row.row, name: profile.name, host: profile.host, port: profile.port, username: profile.username, group: profile.group, protocol: profile.protocol, hasPassword: fields.password !== undefined, duplicate: known.has(key(profile)) });
      known.add(key(profile));
    }
    return result;
  }
  async apply(token: string, selected: unknown, duplicates: unknown) {
    const source = this.source(token);
    const rows = z.array(z.number().int().positive()).min(1).max(5000).parse(selected);
    const policy = z.enum(['skip', 'keep']).parse(duplicates);
    if (new Set(rows).size !== rows.length || rows.some(row => !source.values.has(row))) throw new Error('选择的记录已变化，请重新预览');
    // Consume before awaiting: a second confirmation cannot create a duplicate batch.
    this.sources.delete(token);
    return this.store.importProfiles(rows.map(row => source.values.get(row)!), policy);
  }
  discard(token: string) { this.sources.delete(token); }
}
