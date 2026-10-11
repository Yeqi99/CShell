import assert from 'node:assert/strict';
import type { ElectronApplication, Page } from 'playwright';
export async function dockerSmoke(
  app: ElectronApplication,
  page: Page,
  id: string,
  inputs: string[],
) {
  const output = (text: string) =>
    page.evaluate(({ id, text }) => window.cshell.input(id, text), { id, text });
  await output('\x1b[?1049l\r\nroot@test:~# ');
  await page.waitForFunction(() =>
    document
      .querySelector('.terminal-pane.active .xterm-rows')
      ?.textContent?.includes('root@test:~#'),
  );
  await page.locator('.terminal-pane.active .xterm-screen').click();
  await page.keyboard.type('doc');
  await page.getByRole('listbox', { name: 'Linux commands' }).waitFor();
  await page.screenshot({ path: 'test-results/command-suggestions-light.png' });
  const count = inputs.length;
  await page.keyboard.press('Control+Space');
  await page.waitForFunction(() =>
    document.querySelector('.terminal-pane.active .xterm-rows')?.textContent?.includes('docker ps'),
  );
  assert.equal(inputs.slice(count).join(''), 'ker ps');
  await page.keyboard.press('Enter');
  await output('\r\nPassword: ');
  await page.keyboard.type('doc');
  assert.equal(await page.locator('.command-suggestions').count(), 0);
  await page.keyboard.press('Control+c');
  await assert.rejects(
    page.evaluate((id) => window.cshell.dockerSnapshot(id), id),
    /未启用/,
  );
  await page.getByRole('button', { name: '插件与应用', exact: true }).click();
  await page
    .locator('.plugin-row')
    .filter({ has: page.getByRole('heading', { name: /^Docker/ }) })
    .getByRole('button', { name: '安装', exact: true })
    .click();
  await page
    .locator('.plugin-row')
    .filter({ has: page.getByRole('heading', { name: /^Docker/ }) })
    .getByRole('button', { name: '停用', exact: true })
    .waitFor();
  await page.getByRole('button', { name: '关闭扩展', exact: true }).click();
  const tools = page.locator('.tools-panel:visible');
  await tools.getByRole('button', { name: 'Docker', exact: true }).click();
  const docker = tools.getByRole('region', { name: 'Docker', exact: true });
  await docker.getByText('web-app', { exact: true }).first().waitFor();
  await docker.locator('.docker-stats').getByText('40.0%', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.screenshot({ path: 'test-results/docker-containers-light.png' });
  await docker.getByRole('button', { name: '已停止', exact: true }).click();
  assert.equal(await docker.locator('.docker-list .docker-row').count(), 1);
  await docker.getByRole('button', { name: '启动容器', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('.docker-list')?.textContent?.includes('worker'),
  );
  await docker.getByRole('button', { name: '运行中', exact: true }).click();
  await docker.getByLabel('搜索 Docker 资源').fill('worker');
  await docker.getByRole('button', { name: '停止容器', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('.docker-list')?.textContent?.includes('worker'),
  );
  await docker.getByLabel('搜索 Docker 资源').fill('web-app');
  await docker.getByRole('button', { name: '设置端口映射', exact: true }).click();
  await docker.getByLabel('hostPort 1', { exact: true }).fill('9090');
  await page.screenshot({ path: 'test-results/docker-ports-light.png' });
  await docker.getByRole('button', { name: '应用端口并重建', exact: true }).click();
  await docker.getByRole('status').filter({ hasText: '已重建' }).waitFor();
  await docker.getByText(/127.0.0.1:9090/).waitFor();
  await docker.getByLabel('搜索 Docker 资源').fill('');
  await docker.getByRole('button', { name: '镜像', exact: true }).click();
  await docker.getByText('nginx:latest', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/docker-images-light.png' });
  await docker
    .locator('.docker-row')
    .filter({ hasText: 'nginx:latest' })
    .getByRole('button', { name: '从镜像创建容器', exact: true })
    .click();
  await docker.getByLabel('容器名称', { exact: true }).fill('desktop-created');
  await docker.getByRole('button', { name: '添加端口', exact: true }).click();
  await docker.getByRole('button', { name: '创建并启动', exact: true }).click();
  await docker.getByText('desktop-created', { exact: true }).first().waitFor();
  const created = docker.locator('.docker-row').filter({ hasText: 'desktop-created' });
  await created.getByRole('button', { name: '停止容器', exact: true }).click();
  await docker.getByRole('button', { name: '已停止', exact: true }).click();
  await created.getByRole('button', { name: '启动容器', exact: true }).waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({
      response: 0,
      checkboxChecked: false,
    })) as typeof dialog.showMessageBox;
  });
  await created.getByRole('button', { name: '删除容器', exact: true }).click();
  await docker.locator('.docker-progress').waitFor({ state: 'hidden' });
  assert.equal(await created.count(), 1);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({
      response: 1,
      checkboxChecked: false,
    })) as typeof dialog.showMessageBox;
  });
  await created.getByRole('button', { name: '删除容器', exact: true }).click();
  await created.waitFor({ state: 'hidden' });
  await docker.getByRole('button', { name: '运行中', exact: true }).click();
  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await page.screenshot({ path: 'test-results/docker-containers-dark.png' });
  await page.getByRole('button', { name: '切换为浅色', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 640));
  await page.waitForFunction(() => innerWidth <= 900);
  assert.equal(await docker.evaluate((el) => el.scrollWidth > el.clientWidth), false);
  await page.screenshot({ path: 'test-results/docker-compact.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920));
  await tools.getByRole('button', { name: '文件', exact: true }).click();
  await tools.getByText('projects', { exact: true }).waitFor();
  // Return the opt-in setting to the original state for unrelated baseline tests.
  await page.getByRole('button', { name: '插件与应用', exact: true }).click();
  await page
    .locator('.plugin-row')
    .filter({ has: page.getByRole('heading', { name: /^Docker/ }) })
    .getByRole('button', { name: '停用', exact: true })
    .click();
  await page
    .locator('.plugin-row')
    .filter({ has: page.getByRole('heading', { name: /^Docker/ }) })
    .getByRole('button', { name: '启用', exact: true })
    .waitFor();
  await page.getByRole('button', { name: '关闭扩展', exact: true }).click();
  assert.equal(await tools.getByRole('button', { name: 'Docker', exact: true }).count(), 0);
  console.log(
    'PASS: command completion without execution, password prompt exclusion, Docker opt-in, real SSH HTTP transport, filters/search, lifecycle, image create, port recreation, stats, themes and compact layout',
  );
}
