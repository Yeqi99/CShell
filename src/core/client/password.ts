import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { clientShellSchema } from '../../shared/client';
const derive = promisify(scrypt);
export const accessSchema = z.object({
  allowHttp: z.boolean().default(false),
  allowManage: z.boolean().default(false),
  allowHosting: z.boolean().default(false),
  allowRelay: z.boolean().default(false),
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  shells: z.array(clientShellSchema).min(1).max(6),
});
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 32)) as Buffer;
  return { salt, hash: hash.toString('hex') };
}
export async function verifyPassword(password: string, record: z.infer<typeof accessSchema>) {
  const actual = (await derive(password, record.salt, 32)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(record.hash, 'hex'));
}
