import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { ElectronApplication, Page } from 'playwright';
export async function editorAssistantSmoke(
  app: ElectronApplication,
  page: Page,
  id: string,
  inputs: string[],
) {
  const output = (text: string) =>
    page.evaluate(({ id, text }) => window.cshell.input(id, text), { id, text });
  const pane = page.locator('.terminal-pane.active');
  const bar = pane.locator('.editor-actions');
  const screen = pane.locator('.xterm-screen');
  let redraw = 0;
  const received = async (action: () => Promise<unknown>, expected: string) => {
    const count = inputs.length;
    await action();
    for (let n = 0; n < 100 && inputs.slice(count).join('').length < expected.length; n++)
      await delay(20);
    assert.equal(inputs.slice(count).join(''), expected, await bar.innerText());
    if (expected.startsWith('\x1c')) {
      // Toolbar expansion/collapse resizes the PTY. The echo fixture cannot
      // redraw like Vim, so wait for layout and acknowledge a unique new frame.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const marker = `hello-${++redraw}.txt`;
      await output(`\x1b[2J\x1b[H${marker}\r\n~\r\n~\x1b[999;1H1,1 All`);
      await page.waitForFunction(
        (marker) =>
          document
            .querySelector('.terminal-pane.active .xterm-screen')
            ?.textContent?.includes(marker) &&
          document
            .querySelector('.terminal-pane.active .xterm-screen')
            ?.textContent?.includes('1,1 All'),
        marker,
      );
    }
  };
  await output('\r\nDocumentation mentions vim and nano.\r\n');
  assert.equal(await bar.count(), 0);
  await output('\x1b[?1049h\x1b[2J\x1b[Hhello.txt\r\n~\r\n~\x1b[999;1H1,1 All');
  await pane.getByLabel('Vim 操作面板', { exact: true }).waitFor();
  assert.equal(await pane.getByText('先按 Esc', { exact: true }).count(), 0);
  assert.equal(await pane.locator('.editor-reference').count(), 0);
  await received(
    () => bar.getByRole('button', { name: '插入模式', exact: true }).click(),
    '\x1c\x0ei',
  );
  await received(
    () => bar.getByRole('button', { name: '退出当前模式', exact: true }).click(),
    '\x1c\x0e',
  );
  await bar.getByRole('button', { name: '更多操作', exact: true }).click();
  await received(() => bar.getByLabel('切换 Vim 模式').selectOption('visual'), '\x1c\x0ev');
  await bar.getByRole('button', { name: '退出选项', exact: true }).click();
  await received(
    () => bar.getByRole('menuitem', { name: /退出当前窗口.*:q$/ }).click(),
    '\x1c\x0e:quit\r',
  );
  await bar.getByRole('button', { name: '退出选项', exact: true }).click();
  await bar.getByRole('menuitem', { name: /不保存退出当前窗口/ }).click();
  const beforeCancel = inputs.length;
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(inputs.length, beforeCancel);
  await bar.getByRole('button', { name: '退出选项', exact: true }).click();
  await bar.getByRole('menuitem', { name: /不保存退出当前窗口/ }).click();
  await received(
    () => page.getByRole('dialog').getByRole('button', { name: '放弃并退出', exact: true }).click(),
    '\x1c\x0e:quit!\r',
  );
  await output(
    '\x1b[2J\x1b[H~\r\n~\x1b[999;1HE37: No write since last change\r\nPress ENTER or type command to continue',
  );
  await bar.getByRole('button', { name: '退出选项', exact: true }).click();
  await bar.getByRole('menuitem', { name: /放弃全部修改并退出/ }).click();
  await received(
    () => page.getByRole('dialog').getByRole('button', { name: '放弃并退出', exact: true }).click(),
    '\r\x1c\x0e:qall!\r',
  );
  await output('\x1b[2J\x1b[Hhello.txt\r\n~\r\n~\x1b[999;1H1,1 All');
  await received(
    () => bar.getByRole('button', { name: '文件开头', exact: true }).click(),
    '\x1c\x0e:normal! gg\r',
  );
  await received(
    () => bar.getByRole('button', { name: '文件结尾', exact: true }).click(),
    '\x1c\x0e:normal! G\r',
  );
  await bar.getByRole('button', { name: '跳到行', exact: true }).click();
  await bar.getByLabel('目标行号').fill('42');
  await received(() => bar.getByLabel('目标行号').press('Enter'), '\x1c\x0e:42\r');
  await bar.getByRole('button', { name: '搜索', exact: true }).click();
  await bar.getByLabel('搜索文件内容').fill("a'|q! /路径");
  await received(
    () => bar.getByLabel('搜索文件内容').press('Enter'),
    "\x1c\x0e:let @/ = '\\Va''|q! /路径'\r:call search(@/, 'w')\r",
  );
  await received(
    () => bar.getByRole('button', { name: '撤销', exact: true }).click(),
    '\x1c\x0e:undo\r',
  );
  await received(
    () => bar.getByRole('button', { name: '保存文件', exact: true }).click(),
    '\x1c\x0e:write\r',
  );
  assert.equal(
    await pane.locator('.xterm-helper-textarea').evaluate((el) => document.activeElement === el),
    true,
  );
  await output(
    '\x1b[2J\x1b[Hconfig.yaml\r\nserver:\r\n  port: 8080\r\n  host: localhost\r\n~\r\n~\x1b[999;1H4,1 All',
  );
  await page.screenshot({ path: 'test-results/vim-actions-light.png' });
  assert.equal(
    await pane.locator('.xterm-viewport').evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await page.screenshot({ path: 'test-results/vim-actions-dark.png' });
  await page.getByRole('button', { name: '切换为浅色', exact: true }).click();
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  if (await page.getByRole('button', { name: '添加连接记录', exact: true }).isVisible())
    await page.getByRole('button', { name: '添加连接记录', exact: true }).click();
  assert.equal(await page.locator('.editor-actions:visible').count(), 0);
  await page.getByRole('button', { name: '关闭连接编辑 · 放弃未保存修改', exact: true }).click();
  await bar.waitFor();
  await output('\x1b[2J\x1b[H$ ');
  await page.waitForFunction(
    () => document.querySelector('.terminal-pane.active .xterm-rows')?.textContent?.trim() === '$',
  );
  const staleCount = inputs.length;
  await bar.getByRole('button', { name: '保存文件', exact: true }).click();
  await bar.getByRole('alert').filter({ hasText: '当前编辑器已离开或不可用' }).waitFor();
  assert.equal(inputs.length, staleCount);
  await bar.getByRole('button', { name: '关闭错误', exact: true }).click();
  await output('\x1b[?1049l');
  await bar.waitFor({ state: 'hidden' });
  await output(
    '\x1b[?1049h\x1b[2J\x1b[H GNU nano 7.2  config.yaml\r\nport: 8080\x1b[999;1H^G Help ^O Write Out ^W Where Is ^X Exit',
  );
  await pane.getByLabel('Nano 操作面板', { exact: true }).waitFor();
  // A real editor redraws after the toolbar changes PTY size; the echo fixture does not.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await output(
    '\x1b[2J\x1b[H GNU nano 7.2 config.yaml\r\nport: 8080\x1b[999;1H^G Help ^O Write Out ^W Where Is ^X Exit',
  );
  await page.waitForFunction(() =>
    document.querySelector('.terminal-pane.active .xterm-rows')?.textContent?.includes('GNU nano'),
  );
  await received(() => bar.getByRole('button', { name: '搜索', exact: true }).click(), '\x17');
  await output('\x1b[999;1H\x1b[2K^C Cancel');
  await page.waitForFunction(() =>
    document
      .querySelector('.terminal-pane.active .xterm-screen')
      ?.textContent?.includes('^C Cancel'),
  );
  const count = inputs.length;
  await bar.getByRole('button', { name: '保存文件', exact: true }).click();
  await bar.getByRole('alert').filter({ hasText: '编辑器正在等待输入' }).waitFor();
  assert.equal(inputs.length, count);
  await bar.getByRole('button', { name: '关闭错误', exact: true }).click();
  await output(
    '\x1b[2J\x1b[H GNU nano 7.2 config.yaml\r\nport: 8080\x1b[999;1H^G Help ^O Write Out ^W Where Is ^X Exit',
  );
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.terminal-pane.active .xterm-screen')
        ?.textContent?.includes('^C Cancel'),
  );
  await received(() => bar.getByRole('button', { name: '保存文件', exact: true }).click(), '\x0f');
  await received(() => bar.getByRole('button', { name: '文件结尾', exact: true }).click(), '\x1b/');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.unmaximize();
    window.setSize(900, 640);
  });
  await page.waitForFunction(() => innerWidth <= 900);
  assert.equal(await pane.evaluate((el) => el.scrollWidth > el.clientWidth), false);
  assert.ok((await pane.locator('.terminal-host').boundingBox())!.height > 200);
  await page.screenshot({ path: 'test-results/editor-actions-compact.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920));
  await output('\x1b[?1049l');
  await bar.waitFor({ state: 'hidden' });
  await screen.click({ button: 'right' });
  await pane
    .locator('.terminal-assistant-choices')
    .getByRole('button', { name: 'Vim', exact: true })
    .click();
  await bar.waitFor();
  const afterExit = inputs.length;
  await bar.getByRole('button', { name: '保存文件', exact: true }).click();
  await bar.getByRole('alert').filter({ hasText: '当前编辑器已离开或不可用' }).waitFor();
  assert.equal(inputs.length, afterExit);
  await screen.click({ button: 'right' });
  await pane
    .locator('.terminal-assistant-choices')
    .getByRole('button', { name: '自动', exact: true })
    .click();
  await bar.waitFor({ state: 'hidden' });
  console.log(
    'PASS: editor action packets over SSH, literal search quoting, jump/save/undo, Nano prompts, inactive rejection, focus, themes and compact layout',
  );
}
