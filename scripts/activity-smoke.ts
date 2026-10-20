import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-activity-ui-'));
await writeFile(
  join(data, 'activity.json'),
  JSON.stringify({
    enabled: true,
    since: Date.now(),
    events: [
      {
        id: randomUUID(),
        time: Date.now(),
        kind: 'connection',
        action: 'connect',
        provider: 'cshell.ssh',
        status: 'success',
        duration: 123,
      },
    ],
  }),
);
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.locator('.topbar').getByRole('button', { name: '统计与历史' }).click();
  await page.getByRole('heading', { name: '统计与历史' }).waitFor();
  await page.locator('.activity-recent').waitFor();
  assert.equal(await page.locator('.activity-stats article').count(), 5);
  await page.getByRole('button', { name: '统计设置', exact: true }).click();
  await page.getByLabel('记录本机操作', { exact: true }).uncheck();
  await page.getByText('记录已暂停，已有历史仍可查看。').waitFor();
  assert.equal(
    await page.evaluate(async () => (await window.cshell.activitySnapshot()).enabled),
    false,
  );
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/activity-desktop.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(950, 680));
  await page.screenshot({ path: 'test-results/activity-narrow.png' });
  assert.equal(
    await page.locator('.activity-main').evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.getByRole('button', { name: '操作记录', exact: true }).click();
  assert.equal(await page.locator('.activity-table-wrap tbody tr').count(), 1);
  await page.getByLabel('搜索记录', { exact: true }).fill('no-match');
  assert.equal(await page.locator('.activity-table-wrap tbody tr').count(), 0);
  console.log(
    'PASS: activity counts, filters, recording pause, settings, history and narrow layout',
  );
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
