import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
export async function extensionsSmoke(
  app: ElectronApplication,
  page: Page,
  sessionId: string,
  root: string,
  analysisInputs: string[],
) {
  await page.getByRole('button', { name: '插件与应用', exact: true }).click();
  const workbench = page.locator('.extension-workbench:visible');
  await workbench.getByRole('heading', { name: '插件市场', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  for (const name of ['Anaconda', 'Python']) {
    const row = workbench
      .locator('.plugin-row')
      .filter({ has: page.getByRole('heading', { name: new RegExp('^' + name) }) });
    await row.getByRole('button', { name: '安装', exact: true }).click();
    await row.getByRole('button', { name: '停用', exact: true }).waitFor();
  }
  await page.screenshot({ path: 'test-results/plugin-market-light.png' });
  await workbench.getByRole('button', { name: '环境', exact: true }).click();
  const manager = workbench.locator('.environment-manager:visible');
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLSelectElement>('.environment-manager:not([hidden]) select')
        ?.options.length === 4,
  );
  await manager
    .getByRole('combobox')
    .first()
    .selectOption('/home/test/miniconda3/envs/science/bin/python');
  await manager.getByRole('button', { name: '查看依赖', exact: true }).click();
  await manager.locator('.environment-packages').getByText('numpy', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/conda-environments-light.png' });
  await manager.getByRole('button', { name: '安装', exact: true }).click();
  await workbench.getByRole('heading', { name: '应用市场', exact: true }).waitFor();
  await workbench.getByRole('button', { name: '检查安装条件', exact: true }).click();
  await workbench.locator('.installation-plan').getByText(sessionId, { exact: false }).count();
  assert.match(
    await workbench.locator('.installation-plan pre').innerText(),
    /science\/bin\/python/,
  );
  await page.screenshot({ path: 'test-results/application-install-plan.png' });
  await workbench.getByRole('button', { name: '安装到此服务器', exact: true }).click();
  await workbench.locator('.extension-jobs').getByText('已完成', { exact: true }).waitFor();
  await workbench.getByRole('button', { name: 'Python', exact: true }).click();
  const editor = workbench.locator('.python-editor-slot:visible .cm-content');
  await editor.fill('import os\nos.pa');
  await editor.press('Control+Space');
  await workbench.locator('.cm-tooltip-autocomplete').getByText('path', { exact: true }).waitFor();
  await page.waitForTimeout(150); // CodeMirror's completion interaction guard
  await editor.press('Enter');
  assert.match(await editor.innerText(), /os.path/);
  await page.screenshot({ path: 'test-results/python-completion-light.png' });
  await writeFile(join(root, 'sample.py'), 'import os\nos.pa\n');
  await page.evaluate(
    ({ sessionId }) =>
      window.dispatchEvent(
        new CustomEvent('cshell:open-python', { detail: { sessionId, path: '/sample.py' } }),
      ),
    { sessionId },
  );
  await workbench
    .locator('.python-file-tabs')
    .getByRole('button', { name: 'sample.py', exact: true })
    .waitFor();
  await workbench
    .locator('.python-editor-slot:visible .cm-content')
    .getByText('os.pa', { exact: true })
    .waitFor();
  await workbench.getByRole('button', { name: '草稿', exact: true }).click();
  assert.match(
    await workbench.locator('.python-editor-slot:visible .cm-content').innerText(),
    /os.path/,
  );
  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/python-workspace-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
  await workbench.getByRole('button', { name: '插件市场', exact: true }).click();
  await page.screenshot({ path: 'test-results/plugin-market-compact.png' });
  const overflow = await workbench.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
  assert.equal(overflow, false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920));
  await page.getByRole('button', { name: '切换为浅色', exact: true }).click();
  await page.getByRole('button', { name: '关闭扩展', exact: true }).click();
  await page.locator('.terminal-pane.active .xterm-screen').waitFor();
  await page.getByRole('button', { name: '插件与应用', exact: true }).click();
  await workbench.getByRole('button', { name: 'Python', exact: true }).click();
  assert.match(
    await workbench.locator('.python-editor-slot:visible .cm-content').innerText(),
    /os.path/,
  );
  await page.getByRole('button', { name: '关闭扩展', exact: true }).click();
  const output = async (text: string) => {
    await page.evaluate(({ sessionId, text }) => window.cshell.input(sessionId, text), {
      sessionId,
      text,
    });
    // IPC completion is not SSH echo/render completion. Wait for the actual prompt before typing.
    await page.waitForFunction((tail) => {
      const rows = [...document.querySelectorAll('.terminal-pane.active .xterm-rows > div')]
        .map((row) => row.textContent?.trimEnd() ?? '')
        .filter(Boolean);
      return rows.at(-1)?.endsWith(tail.trimEnd());
    }, text.split('\n').at(-1)!);
  };
  await output('\r\n$ ');
  await page.locator('.terminal-pane.active .xterm-screen').click();
  await page.keyboard.type('/usr/bin/python3');
  await page.keyboard.press('Enter');
  await output('\r\n>>> ');
  await page.getByLabel('终端 Python 环境', { exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLSelectElement>('.python-repl-context select')?.value ===
      '/usr/bin/python3',
  );
  await page.keyboard.type("input('Password: ')");
  await page.keyboard.press('Enter');
  await output('\r\nPassword: ');
  await page.keyboard.type('PRIVATE_INPUT_SENTINEL');
  assert.equal(await page.locator('.command-suggestions').count(), 0);
  await page.keyboard.press('Enter');
  await output('\r\n>>> ');
  await page.keyboard.type('os.pa');
  await page.locator('.command-suggestions').getByText('os.path', { exact: true }).waitFor();
  await page.keyboard.press('Control+Space');
  await page.waitForFunction(() =>
    document.querySelector('.terminal-pane.active .xterm-rows')?.textContent?.includes('os.path'),
  );
  assert.equal(
    analysisInputs.some((input) => input.includes('PRIVATE_INPUT_SENTINEL')),
    false,
  );
  await page.screenshot({ path: 'test-results/python-repl-completion.png' });
  await output('\r\n$ ');
  await page.locator('.python-repl-context').waitFor({ state: 'hidden' });
  console.log(
    'PASS: plugin lifecycle, dependency installation, environment selection, Python file detection, semantic completion, REPL context, drafts, themes and compact market',
  );
}
