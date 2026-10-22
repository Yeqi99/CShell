import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-route-test-'));
  let directCalls = 0, proxyCalls = 0;
  const reply = (res: import('node:http').ServerResponse) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  };
  const target = createServer((_, res) => { directCalls++; reply(res); });
  const proxy = createServer((req, res) => {
    assert.match(req.url!, /^http:\/\/127\.0\.0\.1:/);
    proxyCalls++; reply(res);
  });
  for (const server of [target, proxy]) await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const targetPort = (target.address() as { port: number }).port;
  const proxyPort = (proxy.address() as { port: number }).port;
  const env = { ...process.env, CSHELL_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
    const provider = { id: randomUUID(), name: 'Route fixture', url: `http://127.0.0.1:${targetPort}/v1`, model: 'fixture' };
    await page.evaluate(async ({ provider, proxyPort }) => {
      await window.cshell.networkSave!({ mode: 'proxy', url: `http://127.0.0.1:${proxyPort}` });
      await window.cshell.aiProviderTest(provider);
    }, { provider, proxyPort });
    assert.equal(proxyCalls, 1); assert.equal(directCalls, 0);
    proxy.closeAllConnections(); await new Promise<void>(r => proxy.close(() => r()));
    const failure = await page.evaluate(async provider => {
      try { await window.cshell.aiProviderTest(provider); return ''; }
      catch (error) { return String(error); }
    }, provider);
    assert.ok(failure); assert.equal(directCalls, 0, 'failed proxy must never fall back to direct');
    await page.evaluate(async provider => {
      await window.cshell.networkSave!({ mode: 'direct' });
      await window.cshell.aiProviderTest(provider);
    }, provider);
    assert.equal(directCalls, 1);
    await mkdir('test-results', { recursive: true });
    await page.getByTitle('偏好设置', { exact: true }).click();
    await page.getByRole('button', { name: '网络与代理', exact: true }).click();
    await page.getByRole('button', { name: '手动代理', exact: true }).click();
    await page.getByRole('textbox', { name: '代理地址', exact: true }).fill('socks5://127.0.0.1:1080');
    await page.screenshot({ path: 'test-results/network-route.png' });
    console.log('PASS: explicit proxy, loopback bypass disabled, no direct fallback, explicit direct recovery');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    for (const server of [target, proxy]) { server.closeAllConnections(); server.close(); }
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
