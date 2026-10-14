/** Isolated actual Agent TLS + native PTY fixture for Android instrumentation. Never uses real Agent data. */
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ClientServer } from '../src/core/client/server';
import { ClientVault } from '../src/core/client/identity';
import { AgentTerminalProvider } from '../src/core/agent-terminal';
import type { Server as TlsServer } from 'node:tls';
const directory = await mkdtemp(join(tmpdir(), 'cshell-android-agent-test-'));
const key = randomBytes(32);
const codec = {
  async encrypt(text: string) {
    const iv = randomBytes(12),
      c = createCipheriv('aes-256-gcm', key, iv);
    return Buffer.concat([iv, c.update(text), c.final(), c.getAuthTag()]).toString('base64');
  },
  async decrypt(text: string) {
    const b = Buffer.from(text, 'base64'),
      d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
  },
};
let server: ClientServer;
let revoking = false;
const recentOutput = new Map<string, string>();
const terminal = new AgentTerminalProvider((event) => {
  server.event(event);
  if (event.type === 'data')
    recentOutput.set(
      event.sessionId,
      ((recentOutput.get(event.sessionId) || '') + event.data).slice(-2048),
    );
  if (event.type === 'closed') recentOutput.delete(event.sessionId);
  if (
    event.type === 'data' &&
    recentOutput.get(event.sessionId)?.includes('__CSHELL_TEST_REVOKE__') &&
    !revoking
  ) {
    revoking = true;
    const peer = server.status().peers[0];
    if (peer) void server.revoke(peer.fingerprint);
  }
});
server = new ClientServer(new ClientVault(directory, codec), terminal, {
  shells: async () =>
    (await terminal.shells()).map((s) => ({
      shell: (s.environment === 'wsl' ? 'wsl' : s.id) as
        'cmd' | 'powershell' | 'bash' | 'zsh' | 'sh' | 'wsl',
      label: s.label,
      ...(s.distribution ? { distribution: s.distribution } : {}),
    })),
});
const password = randomBytes(24).toString('hex');
try {
  await server.load();
  await server.setAccess({
    password,
    shells: process.platform === 'win32' ? ['cmd', 'powershell', 'wsl'] : ['bash', 'zsh', 'sh'],
  });
  await server.start({ bind: '127.0.0.1', port: 47839 });
  // Test-only diagnostics: handshake failures contain no application credentials.
  (server as unknown as { server: TlsServer }).server.on('tlsClientError', (error) => {
    const tlsError = error as Error & { code?: string; reason?: string };
    console.error(
      'Agent fixture TLS handshake:',
      tlsError.code || 'unknown',
      tlsError.reason || tlsError.message,
    );
  });
  const output = process.argv[2] || 'test-results/android-agent-fixture.json';
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify({
      host: '10.0.2.2',
      port: 47839,
      password,
      fingerprint: server.status().fingerprint,
    }),
    { mode: 0o600 },
  );
  console.log('Android native Agent fixture ready; isolated credentials written to ' + output);
  const timer = setTimeout(() => void stop(), 15 * 60 * 1000);
  async function stop() {
    clearTimeout(timer);
    await server.stop();
    terminal.dispose();
    await rm(directory, { recursive: true, force: true });
    process.exit(0);
  }
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
} catch (error) {
  await server.stop();
  terminal.dispose();
  await rm(directory, { recursive: true, force: true });
  throw error;
}
