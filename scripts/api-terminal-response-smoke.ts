import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { ElectronApplication, Page } from 'playwright';

/** Only called in the isolated desktop SSH fixture, never the user's instance. */
export async function apiTerminalResponseSmoke(app: ElectronApplication, page: Page) {
  const original = await page.evaluate(() => window.cshell.mcpStatus());
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const profileId = await page.evaluate(async () => (await window.cshell.config()).profiles[0].id);
  let completed = 0;
  let stopped = false;
  let workers: Promise<void>[] = [];
  const measure = async (phase: string) => {
    const samples: number[] = [];
    await page.locator('.xterm-screen').click();
    for (let i = 0; i < 16; i++) {
      const marker = `${phase}${i.toString(16).padStart(2, '0')}x`;
      const start = performance.now();
      await page.keyboard.type(marker);
      await page.waitForFunction((value) => document.querySelector('.xterm-screen')?.textContent?.includes(value), marker);
      samples.push(performance.now() - start);
    }
    const sorted = samples.slice().sort((a, b) => a - b);
    return { samples, p50Ms: sorted[8], p95Ms: sorted[15] };
  };
  try {
    const baseline = await measure('base');
    const status = await page.evaluate(async ({ original, profileId, port }) => window.cshell.mcpConfigure({
      ...original.settings, port, enabled: true, allowedProfiles: [profileId], allowedLocalShells: [],
      localFileRoots: [], clients: [], targetPolicies: {}, allowCommands: false,
      capabilities: ['files.read'], review: 'authorized',
    }, original.revision), { original, profileId, port });
    assert.equal(status.running, true);
    await page.evaluate(() => window.cshell.mcpCopyToken());
    const token = await app.evaluate(({ clipboard }) => clipboard.readText());
    const invoke = async (name: string, args: object) => {
      const response = await fetch(`http://127.0.0.1:${status.settings.port}/api/v1/invoke`, {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      });
      assert.equal(response.status, 200);
      return (await response.json()).result;
    };
    const connection = await invoke('connect', { profileId });
    workers = Array.from({ length: 4 }, async (_, worker) => {
      while (!stopped) {
        if (worker % 2) await invoke('invoke_connection', { sessionId: connection.sessionId, tool: 'list_files_page', arguments: { path: '.', limit: 20 } });
        else await invoke('list_servers', {});
        completed++;
      }
    });
    // Attach rejection handlers immediately while typing is in progress.
    const drained = Promise.allSettled(workers);
    const loaded = await measure('load');
    stopped = true;
    const results = await drained;
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    assert.ok(completed > 0);
    await writeFile('test-results/api-desktop-terminal-response.json', JSON.stringify({
      measuredAt: new Date().toISOString(), completed,
      scope: 'Isolated visible Electron window; keyboard dispatch to rendered SSH fixture echo, including Playwright overhead. Four concurrent audited API workers mix metadata and real SFTP requests. One local fixture target, not physical multi-machine latency.',
      baseline, loaded,
      budgetMs: Math.max(250, baseline.p95Ms * 3),
    }, null, 2));
    assert.ok(loaded.p95Ms < Math.max(250, baseline.p95Ms * 3), 'API mixed load delays desktop terminal echo');
    console.log('PASS: desktop terminal echo during audited API metadata/SFTP load');
  } finally {
    stopped = true;
    await Promise.allSettled(workers);
    await page.evaluate(async (settings) => {
      const current = await window.cshell.mcpStatus();
      await window.cshell.mcpConfigure(settings, current.revision);
    }, original.settings);
  }
}
