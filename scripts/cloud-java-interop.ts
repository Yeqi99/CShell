import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { encryptVault, newRecoveryKey } from '../src/core/cloud-crypto';
const directory = await mkdtemp(join(tmpdir(), 'cshell-cloud-java-'));
const executable = (name: string) =>
  process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : ''))
    : name;
try {
  execFileSync(
    executable('javac'),
    [
      '-encoding',
      'UTF-8',
      '-d',
      directory,
      'android/app/src/main/java/org/canpshell/mobile/CloudCipher.java',
      'android/app/src/test/java/org/canpshell/mobile/CloudCipherInterop.java',
    ],
    { windowsHide: true },
  );
  const key = newRecoveryKey(),
    payload = { format: 1, connections: [{ name: '中文服务器', password: 'test-only-secret' }] },
    account = 'a'.repeat(32);
  const envelope = encryptVault(payload, key, account);
  const output = execFileSync(
    executable('java'),
    [
      '-cp',
      directory,
      'org.canpshell.mobile.CloudCipherInterop',
      Buffer.from(key, 'base64url').toString('base64'),
      envelope.nonce,
      envelope.ciphertext,
      account,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.deepEqual(JSON.parse(Buffer.from(output, 'base64').toString('utf8')), payload);
  console.log(
    'PASS: Node ↔ Android Java AES-GCM interoperability, Unicode, account binding and tamper rejection',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
