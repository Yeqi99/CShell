import { _electron as electron } from 'playwright';
import { createServer } from 'node:net';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-probe-test-'));
  let handshakes = 0;
  const server = createServer(socket => { handshakes++; socket.on('error', () => {}); socket.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const env = { ...process.env, CSHELL_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
    await page.evaluate(async ({ id, port }) => {
      await window.cshell.saveProfile({ id, name: '本机测试服务', host: '127.0.0.1', port, username: 'fixture', protocol: 'ssh', auth: 'password', group: '', favorite: false } as any);
    }, { id: randomUUID(), port });
    await page.getByTitle('偏好设置', { exact: true }).click();
    await page.getByRole('button', { name: '网络与代理', exact: true }).click();
    await page.locator('summary').filter({ hasText: '连接延迟测试' }).click();
    await page.getByLabel('目标连接', { exact: true }).selectOption({ label: '本机测试服务' });
    await page.getByRole('button', { name: '开始测试', exact: true }).click();
    await page.locator('.network-probe-result').waitFor();
    assert.equal(handshakes, 5);
    assert.match(await page.locator('.network-probe-result').innerText(), /0 \/ 5/);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await page.getByRole('button', { name: '开始测试', exact: true }).click();
    await page.locator('.network-probe-result').filter({ hasText: '5 / 5' }).waitFor();
    assert.equal(await page.locator('.network-probe-stats strong').first().innerText(), '—');
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/network-probe.png' });
    console.log('PASS: real Electron probe, 5 real TCP connections, refusal renders missing latency');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });


