import { _electron as electron, chromium, type ElectronApplication } from 'playwright';
import { mkdtemp, rm, writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from '../tests/fixture';
import ssh2 from 'ssh2';
/**
 * Opt-in, isolated SSH render benchmark. Never points at user machines or reads saved credentials.
 * Run serially with other builds/benchmarks stopped. No CI hook or universal latency threshold.
 * APP_PATH / CSHELL_EXECUTABLE selects a package; APP_ARGS may contain a JSON string array for dev.
 * Without an executable, resolve exactly one Windows package matching package.json's version.
 * APP_LABEL names test-results output. PRESSURE=false skips the background load;
 * SEMANTIC_COLORS=false is an explicit control run. UI text assumes the default zh-CN locale.
 * Measurements start at keydown dispatch, end at DOM mutation / the next animation frame,
 * and are not OS-input-to-photon measurements or WAN network RTTs.
 */
const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
let executable = process.env.APP_PATH ?? process.env.CSHELL_EXECUTABLE;
if (!executable) {
  const candidates = [
    resolve('release', `pro-${manifest.version}`, 'win-unpacked', 'CShell Pro.exe'),
    resolve('release', manifest.version, 'win-unpacked', 'CShell.exe'),
  ];
  const available: string[] = [];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      available.push(candidate);
    } catch {}
  }
  assert.equal(
    available.length,
    1,
    'Set APP_PATH or CSHELL_EXECUTABLE when no current package or more than one edition is present.',
  );
  executable = available[0];
}
const launchArgs: unknown = process.env.APP_ARGS ? JSON.parse(process.env.APP_ARGS) : undefined;
assert.ok(
  launchArgs === undefined ||
    (Array.isArray(launchArgs) && launchArgs.every((arg) => typeof arg === 'string')),
  'APP_ARGS must be a JSON array of strings.',
);
const label =
  (process.env.APP_LABEL ?? `${manifest.version}-${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80) || 'results';
const output = resolve('test-results', `ssh-render-latency-${label}`);
await mkdir(output, { recursive: true });
const data = await mkdtemp(join(tmpdir(), 'cshell-latency-'));
const server = await fixture();
let background: Awaited<ReturnType<typeof fixture>> | undefined,
  outputTimer: ReturnType<typeof setInterval> | undefined;
const semantic = process.env.SEMANTIC_COLORS !== 'false';
const stats = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b);
  return {
    samples: a.length,
    min: +a[0].toFixed(2),
    p50: +a[Math.floor((a.length - 1) * 0.5)].toFixed(2),
    p95: +a[Math.floor((a.length - 1) * 0.95)].toFixed(2),
    max: +a[a.length - 1].toFixed(2),
    mean: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2),
  };
};
const direct = async () => {
  const client = new ssh2.Client();
  await new Promise<void>((ok, fail) => {
    client
      .once('ready', ok)
      .once('error', fail)
      .connect({
        host: '127.0.0.1',
        port: server.port,
        username: 'tester',
        password: server.password,
        hostVerifier: () => true,
      });
  });
  const stream = await new Promise<ssh2.ClientChannel>((ok, fail) =>
    client.shell((e, s) => (e ? fail(e) : ok(s))),
  );
  await new Promise((r) => setTimeout(r, 100));
  const values: number[] = [];
  for (let i = 0; i < 45; i++) {
    const t = performance.now();
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(Error('direct echo timeout')), 5000);
      stream.once('data', () => {
        clearTimeout(timer);
        ok();
      });
      stream.write('x');
    });
    if (i >= 5) values.push(performance.now() - t);
  }
  stream.close();
  client.end();
  return stats(values);
};
let app: ElectronApplication | undefined;
const results: any = {
  executable,
  semantic,
  utc: new Date().toISOString(),
  fixture: '127.0.0.1, ssh2 immediate echo, isolated test data',
  measurement:
    'keydown to xterm DOM update and following animation frame; no artificial network delay',
  sourceVersion: manifest.version,
};
try {
  results.directSshEchoMs = await direct();
  console.log('DIRECT_SSH', JSON.stringify(results.directSshEchoMs));
  app = await electron.launch({
    executablePath: executable,
    ...(launchArgs ? { args: launchArgs as string[] } : {}),
    env: { ...process.env, CSHELL_TEST_DATA: data, CSHELL_TEST_START_GATE: '1' },
    timeout: 60000,
  });
  await app.evaluate(() => {
    (globalThis as any).__cshellPackagedTestAttached = true;
  });
  results.packageVersion = await app.evaluate(({ app }) => app.getVersion());
  let page = app.context().pages()[0];
  if (!page && process.env.APP_ARGS) {
    const port = (await readFile(join(data, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0];
    const attached = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    page = attached.contexts()[0].pages()[0];
  }
  page ??= await app.context().waitForEvent('page');
  page.setDefaultTimeout(25000);
  await page.waitForFunction(() => !!window.cshell);
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate(async (semantic) => {
    const c = await window.cshell.config();
    await window.cshell.preferences({
      ...c.preferences,
      defaultConnectionView: 'original',
      terminalSemanticColors: semantic,
    });
  }, semantic);
  await page.reload();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  const form = page.locator('.connection-editor:visible');
  await form.getByLabel('保存到服务器列表').check();
  await form.getByLabel('名称', { exact: true }).fill('Latency fixture');
  await form.getByLabel('主机地址').fill('127.0.0.1');
  await form.getByLabel('端口', { exact: true }).fill(String(server.port));
  await form.getByLabel('用户名', { exact: true }).fill('tester');
  await form.locator('.connection-secret input').fill(server.password);
  await form.getByLabel('使用系统加密保存凭据').check();
  await form.getByRole('button', { name: '仅保存', exact: true }).click();
  await page.locator('.server-open').filter({ hasText: 'Latency fixture' }).dblclick();
  const auth = page.locator('.saved-connection:visible');
  if (await auth.count()) {
    await auth.locator('input[type=password]').fill(server.password);
    await auth.getByRole('button', { name: '连接', exact: true }).click();
  }
  await page.locator('.terminals:visible .xterm-helper-textarea:visible').waitFor();
  await page.evaluate(() => {
    (window as any).__latencyOriginalTextarea = document.querySelector('.xterm-helper-textarea');
  });
  const requestsBefore = server.shellRequests();
  await page.evaluate('window.__name = (fn) => fn');
  const measure = async (name: string) => {
    const input = page.locator('.xterm-helper-textarea:visible').first();
    await input.waitFor();
    await input.focus();
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const w = window as any;
      w.__latencyLongTasks = [];
      w.__latencyLongObserver?.disconnect();
      w.__latencyLongObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          w.__latencyLongTasks.push({ start: entry.startTime, duration: entry.duration });
      });
      w.__latencyLongObserver.observe({ type: 'longtask', buffered: false });
    });
    const measureStarted = performance.now();
    const dom: number[] = [],
      frame: number[] = [],
      raw: any[] = [];
    for (let chunk = 0; chunk < 3; chunk++) {
      const prefix = `${name.toUpperCase()}${chunk}:`;
      server.writeOutput('\r\n' + prefix);
      await page.waitForFunction(
        (p) =>
          [...document.querySelectorAll('.xterm-rows')].some((e) => e.textContent?.includes(p)),
        prefix,
      );
      let expected = prefix;
      for (let i = 0; i < 25; i++) {
        const ch = String.fromCharCode(97 + (i % 26));
        expected += ch;
        await page.evaluate(
          ({ ch, expected }) => {
            const w = window as any;
            w.__latencyDone = null;
            const rows = [...document.querySelectorAll('.xterm-rows')].find(
              (e) => e.getBoundingClientRect().width > 0,
            )!;
            let start = 0;
            const key = (e: KeyboardEvent) => {
              if (e.key === ch) {
                start = performance.now();
                window.removeEventListener('keydown', key, true);
              }
            };
            window.addEventListener('keydown', key, true);
            const observer = new MutationObserver(() => {
              if (!start || !rows.textContent?.includes(expected)) return;
              const dom = performance.now() - start;
              observer.disconnect();
              requestAnimationFrame(() => {
                w.__latencyDone = { dom, frame: performance.now() - start };
              });
            });
            observer.observe(rows, { childList: true, subtree: true, characterData: true });
          },
          { ch, expected },
        );
        await page.keyboard.type(ch);
        await page.waitForFunction(() => (window as any).__latencyDone !== null, undefined, {
          timeout: 5000,
          polling: 5,
        });
        const value = await page.evaluate(() => (window as any).__latencyDone);
        if (i >= 5) {
          dom.push(value.dom);
          frame.push(value.frame);
          raw.push({ chunk, i, ...value });
        }
      }
    }
    const longTasks = await page.evaluate(() => {
      const w = window as any;
      w.__latencyLongObserver.disconnect();
      return w.__latencyLongTasks;
    });
    const out = {
      domMs: stats(dom),
      visibleFrameMs: stats(frame),
      longTasks,
      durationMs: performance.now() - measureStarted,
      raw,
    };
    await writeFile(join(output, name + '.json'), JSON.stringify(out, null, 2));
    console.log(
      name,
      JSON.stringify({
        domMs: out.domMs,
        visibleFrameMs: out.visibleFrameMs,
        longTaskCount: out.longTasks.length,
        longTaskMaxMs: Math.max(0, ...out.longTasks.map((t: any) => t.duration)),
      }),
    );
    return out;
  };
  results.actualSemanticSetting = (
    await page.evaluate(() => window.cshell.config())
  ).preferences.terminalSemanticColors;
  assert.equal(results.actualSemanticSetting, semantic);
  results.original = await measure('original');
  await page.getByRole('button', { name: '打开可视化桌面', exact: true }).click();
  await page.locator('.linux-desktop:visible').waitFor();
  await page.locator('.linux-desktop:visible [data-desktop-icon="terminal"]').dblclick();
  await page.locator('.linux-desktop:visible .xterm-helper-textarea:visible').waitFor();
  results.sameTextareaAfterVisual = await page.evaluate(
    () =>
      (window as any).__latencyOriginalTextarea ===
      document.querySelector('.xterm-helper-textarea'),
  );
  assert.equal(server.shellRequests(), requestsBefore);
  assert.equal(results.sameTextareaAfterVisual, true);
  results.visual = await measure('visual');
  await page.getByRole('button', { name: '切换到 SSH 终端', exact: true }).focus();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '切换到 SSH 终端', exact: true }).click();
  await page.locator('.terminals:visible .xterm-helper-textarea:visible').waitFor();
  results.originalAfter = await measure('restored');
  results.historyPreserved = await page.evaluate(() =>
    [...document.querySelectorAll('.xterm-rows')].some(
      (el) =>
        el.textContent?.includes('ORIGINAL0:abcdefghijklmnopqrstuvwxy') &&
        el.textContent?.includes('VISUAL0:abcdefghijklmnopqrstuvwxy'),
    ),
  );
  assert.ok(
    results.historyPreserved,
    'Original and visual output history must remain after switching back.',
  );
  results.sameTextareaAfterReturn = await page.evaluate(
    () =>
      (window as any).__latencyOriginalTextarea ===
      document.querySelector('.xterm-helper-textarea'),
  );
  assert.ok(results.sameTextareaAfterReturn);
  if (process.env.PRESSURE !== 'false') {
    background = await fixture();
    await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
    await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
    const bgform = page.locator('.connection-editor:visible');
    await bgform.getByLabel('保存到服务器列表').check();
    await bgform.getByLabel('名称', { exact: true }).fill('Background fixture');
    await bgform.getByLabel('主机地址').fill('127.0.0.1');
    await bgform.getByLabel('端口', { exact: true }).fill(String(background.port));
    await bgform.getByLabel('用户名', { exact: true }).fill('tester');
    await bgform.locator('.connection-secret input').fill(background.password);
    await bgform.getByLabel('使用系统加密保存凭据').check();
    await bgform.getByRole('button', { name: '仅保存', exact: true }).click();
    await page.locator('.server-open').filter({ hasText: 'Background fixture' }).dblclick();
    const bgauth = page.locator('.saved-connection:visible');
    if (await bgauth.count()) {
      await bgauth.locator('input[type=password]').fill(background.password);
      await bgauth.getByRole('button', { name: '连接', exact: true }).click();
    }
    await page.locator('.terminals:visible .xterm-helper-textarea:visible').waitFor();
    const foreground = page
      .locator('.session-tab')
      .filter({ hasText: 'Latency fixture' })
      .getByRole('button')
      .first();
    await foreground.focus();
    await foreground.click();
    await page.locator('.terminals:visible .xterm-helper-textarea:visible').waitFor();
    let line = 0;
    const pressureStarted = performance.now();
    outputTimer = setInterval(
      () =>
        background!.writeOutput(
          Array.from(
            { length: 20 },
            () =>
              `tester@fixture:~$ https://latency.example.invalid/build/${line++} output: building modules 1234567890\r\n`,
          ).join(''),
        ),
      20,
    );
    await page.waitForTimeout(500);
    results.pressureOriginal = await measure('pressureoriginal');
    await page.getByRole('button', { name: '打开可视化桌面', exact: true }).click();
    await page.locator('.linux-desktop:visible').waitFor();
    await page.locator('.linux-desktop:visible [data-desktop-icon="terminal"]').dblclick();
    await page.locator('.linux-desktop:visible .xterm-helper-textarea:visible').waitFor();
    results.pressureVisual = await measure('pressurevisual');
    clearInterval(outputTimer);
    outputTimer = undefined;
    results.backgroundLines = line;
    results.backgroundNominalLinesPerSecond = 1000;
    results.backgroundActualLinesPerSecond = +(
      (line * 1000) /
      (performance.now() - pressureStarted)
    ).toFixed(1);
  }
  results.shellRequestsBefore = requestsBefore;
  results.shellRequestsAfter = server.shellRequests();
  results.sameSshSession = requestsBefore === server.shellRequests();
  results.sameTextareaAtEnd = await page.evaluate(
    () =>
      (window as any).__latencyOriginalTextarea ===
      document.querySelector('.xterm-helper-textarea'),
  );
  assert.ok(results.sameSshSession);
  assert.ok(results.sameTextareaAtEnd);
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(
    'RESULT_FILE',
    label,
    JSON.stringify({
      historyPreserved: results.historyPreserved,
      sameSshSession: results.sameSshSession,
      sameTextareaAfterVisual: results.sameTextareaAfterVisual,
      sameTextareaAfterReturn: results.sameTextareaAfterReturn,
      backgroundLines: results.backgroundLines,
    }),
  );
} catch (error) {
  results.error = String(error);
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  const page = app?.context().pages()[0];
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') });
    console.log((await page.locator('body').innerText()).slice(-3500));
  }
  throw error;
} finally {
  if (outputTimer) clearInterval(outputTimer);
  if (background) {
    background.disconnectAll();
    await background.close();
  }
  await app?.close();
  server.disconnectAll();
  await server.close();
  const abs = resolve(data),
    base = resolve(tmpdir()) + sep;
  assert.ok(abs.startsWith(base) && abs.includes('cshell-latency-'));
  await rm(abs, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
