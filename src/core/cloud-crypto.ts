import { createCipheriv, createDecipheriv, randomBytes, createHash, pbkdf2Sync } from 'node:crypto';
import type { CloudEnvelope } from '../shared/cloud-sync';

export function newRecoveryKey() {
  return randomBytes(32).toString('base64url');
}
export function wrapRecoveryKey(key:string,password:string,account:string) {
  const salt=randomBytes(32);
  const derived=pbkdf2Sync(password,salt,210000,32,'sha256').toString('base64url');
  return {salt:salt.toString('base64'),envelope:encryptVault({key},derived,account)};
}
export function unwrapRecoveryKey(box: {salt:string;envelope:CloudEnvelope}, password:string, account:string): string {
  const salt = Buffer.from(box.salt, 'base64');
  if(salt.length !== 32) throw new Error('自动解锁数据不正确');
  const derived = pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('base64url');
  const value = decryptVault(box.envelope, derived, account) as {key:string};
  keyBytes(value.key);
  return value.key;
}
function keyBytes(key: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('恢复密钥格式不正确');
  const bytes = Buffer.from(key, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== key)
    throw new Error('恢复密钥格式不正确');
  return bytes;
}
const aad = (accountId: string) => Buffer.from('cshell-sync:1:' + accountId);
export function encryptVault(value: unknown, key: string, accountId: string): CloudEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce);
  cipher.setAAD(aad(accountId));
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 8 * 1024 * 1024) throw new Error('同步数据超过 8 MiB 上限');
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  return { format: 1, nonce: nonce.toString('base64'), ciphertext: encrypted.toString('base64') };
}
export function decryptVault(envelope: CloudEnvelope, key: string, accountId: string): unknown {
  if (
    envelope?.format !== 1 ||
    typeof envelope.nonce !== 'string' ||
    typeof envelope.ciphertext !== 'string' ||
    envelope.ciphertext.length > 12 * 1024 * 1024
  )
    throw new Error('不支持的云端数据格式');
  const nonce = Buffer.from(envelope.nonce, 'base64'),
    data = Buffer.from(envelope.ciphertext, 'base64');
  if (nonce.length !== 12 || data.length < 16) throw new Error('云端数据不完整');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), nonce);
  decipher.setAAD(aad(accountId));
  decipher.setAuthTag(data.subarray(-16));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8'),
  );
}
/** Object order does not cause false conflicts; array order remains meaningful. */
export function vaultDigest(value: unknown): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
