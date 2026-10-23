import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const keySchema = z.string().min(1).max(160).refine(key => key !== '__proto__' && key !== 'constructor' && key !== 'prototype');
const textSchema = z.string().max(100000);
const recordSchema = z.record(keySchema, textSchema).refine(record => Object.keys(record).length <= 200 && JSON.stringify(record).length <= 1000000);

/** Local drafts use the same account directory and encryption context as AI history.
 * Loading never submits a message or resumes an operation. */
export class AiDrafts {
  private data: Record<string, string> = {};
  private writes: Promise<void> = Promise.resolve();
  private path: string;
  constructor(directory: string, private codec: { encryptPrivate(text: string): Promise<string>; decryptPrivate(text: string): Promise<string> }) {
    this.path = join(directory, 'ai-drafts.enc');
  }
  async load() {
    try { this.data = recordSchema.parse(JSON.parse(await this.codec.decryptPrivate(await readFile(this.path, 'utf8')))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async snapshot() { await this.writes; return { ...this.data }; }
  save(key: unknown, text: unknown) {
    const id = keySchema.parse(key), value = textSchema.parse(text);
    const next = this.writes.catch(() => {}).then(async () => {
      const data = { ...this.data };
      if (value) data[id] = value; else delete data[id];
      recordSchema.parse(data);
      await writeFile(this.path + '.tmp', await this.codec.encryptPrivate(JSON.stringify(data)), { mode: 0o600 });
      await rename(this.path + '.tmp', this.path);
      this.data = data;
    });
    this.writes = next;
    return next;
  }
}
