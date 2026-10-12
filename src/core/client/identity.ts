import { generate } from 'selfsigned';
import { randomUUID, X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { SecretCodec } from '../store';
const identitySchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  certificate: z.string(),
});
export type ClientIdentity = z.infer<typeof identitySchema>;
export const fingerprint = (certificate: string) => new X509Certificate(certificate).fingerprint256;
export async function createIdentity(): Promise<ClientIdentity> {
  const id = randomUUID();
  const pems = await generate([{ name: 'commonName', value: id }], {
    algorithm: 'sha256',
    keyType: 'ec',
    curve: 'P-256',
    notBeforeDate: new Date(Date.now() - 60000),
    notAfterDate: new Date(Date.now() + 365 * 86400000),
  });
  return { id, key: pems.private, certificate: pems.cert };
}
/** Dedicated encrypted files: never exported with appearance or general configuration. */
export class ClientVault {
  private writes = Promise.resolve();
  constructor(
    private directory: string,
    private codec: SecretCodec,
  ) {}
  async read<T>(name: string, schema: z.ZodType<T>): Promise<T | undefined> {
    try {
      return schema.parse(
        JSON.parse(
          await this.codec.decrypt(await readFile(join(this.directory, name + '.enc'), 'utf8')),
        ),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }
  async write(name: string, value: unknown) {
    const data = JSON.stringify(value);
    const operation = this.writes.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const path = join(this.directory, name + '.enc');
      await writeFile(path + '.tmp', await this.codec.encrypt(data), { mode: 0o600 });
      await rename(path + '.tmp', path);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async identity() {
    const existing = await this.read('identity', identitySchema);
    if (existing) return existing;
    const created = await createIdentity();
    await this.write('identity', created);
    return created;
  }
  flush() {
    return this.writes;
  }
}
