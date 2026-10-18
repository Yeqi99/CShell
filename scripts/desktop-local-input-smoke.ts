import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, createConnection, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { DesktopService } from '../src/agent/desktop-service';
import {
  connectDesktop,
  type DesktopClient,
  type DesktopClientInput,
} from '../src/core/desktop-client';
const directory = await mkdtemp(join(tmpdir(), 'cagent-own-input-')),
  receiptPath = join(directory, 'desktop-input-receipt.json');
const executable = join(directory, 'DesktopAcceptance.exe');
const native = resolve(process.env.DESKTOP_TEST_NATIVE ?? 'test-results/cagent-desktop-rdp-v2.exe');
const evidence = 'test-results/desktop-local-input.json';
const started = Date.now();
let child: ReturnType<typeof spawn> | undefined,
  viewer: DesktopClient | undefined,
  socket: Socket | undefined,
  focusLost = false,
  monitor: ReturnType<typeof setInterval> | undefined;
const diagnostics: unknown[] = [];
let inputCount = 0,
  frames = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const receipt = () => {
  const valid = [0, 1]
    .flatMap((i) => {
      try {
        return [JSON.parse(readFileSync(receiptPath + '.' + i, 'utf8'))];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!valid.length) throw Error('No fixture receipt');
  return valid[0];
};
const focused = () => {
  try {
    const r = receipt();
    return (
      !focusLost &&
      r.pid === child?.pid &&
      r.foreground &&
      r.foregroundPid === child?.pid &&
      !r.events.some((event: {kind:string}) => event.kind === 'deactivated') &&
      Date.now() - Date.parse(r.at) < 200
    );
  } catch {
    return false;
  }
};
const service = new DesktopService({
  identity: 'local-input-acceptance',
  nativeExecutable: native,
  authorize: () => {
    const ok = focused();
    if (!ok)
      diagnostics.push({
        stage: 'fixture.authorize-denied',
        at: Date.now(),
        receipt: (() => {
          try {
            return receipt();
          } catch (e) {
            return String(e);
          }
        })(),
      });
    return ok;
  },
  diagnostic: (e) => diagnostics.push(e),
});
const server = createServer((s) => {
  void service.acceptAuthenticated(s, 'local');
});
const deadline = setTimeout(() => {
  focusLost = true;
  socket?.destroy();
  void service.shutdown();
}, 80000);
async function until(check: () => boolean, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(25);
  }
  throw Error('Fixture condition timed out');
}
async function send(event: DesktopClientInput) {
  if (!focused()) throw Error('Test window lost foreground; input stopped');
  viewer!.input(event);
  inputCount++;
  await sleep(60);
}
async function press(code: number) {
  await send({ kind: 'key', code, down: true });
  await send({ kind: 'key', code, down: false });
}
async function click(which: 'input' | 'button') {
  const r = receipt(),
    rect = r[which],
    screen = r.screen;
  assert.ok(rect.width > 0 && rect.height > 0);
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  assert.ok(
    x >= screen.X && x < screen.X + screen.Width && y >= screen.Y && y < screen.Y + screen.Height,
    'fixture coordinates must belong to captured screen',
  );
  await send({
    kind: 'move',
    x: (x - screen.X) / (screen.Width - 1),
    y: (y - screen.Y) / (screen.Height - 1),
  });
  await send({ kind: 'button', button: 0, down: true });
  await send({ kind: 'button', button: 0, down: false });
}
async function open() {
  const ticket = service.open('local', {
    control: true,
    transport: 'management',
    quality: { fps: 30, bitrate: 4000000, display: 0, adaptive: false },
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  socket = createConnection({ host: '127.0.0.1', port: address.port });
  viewer = await connectDesktop(ticket, {
    host: '127.0.0.1',
    expectedHostIdentity: 'local-input-acceptance',
    stream: socket,
  });
  viewer.on('frame', (f) => {
    frames++;
    viewer?.ack(f.id);
  });
  await until(() => !!viewer?.videoInfo);
  const r = receipt();
  assert.equal(viewer.videoInfo!.sourceWidth, r.screen.Width);
  assert.equal(viewer.videoInfo!.sourceHeight, r.screen.Height);
  return ticket;
}
try {
  await promisify(execFile)(
    'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    [
      '/nologo',
      '/target:winexe',
      '/out:' + executable,
      '/r:System.Windows.Forms.dll',
      '/r:System.Drawing.dll',
      '/r:System.Web.Extensions.dll',
      resolve('tools/cagent-desktop/DesktopAcceptance.cs'),
    ],
    { windowsHide: true },
  );
  if (process.argv.includes('--prepare-only'))
    console.log('Local input fixture compiled; no window or input started.');
  else {
    child = spawn(executable, [], {
      windowsHide: false,
      stdio: 'ignore',
      env: {
        ...process.env,
        CSHELL_ACCEPTANCE_DIR: directory,
        CSHELL_ACCEPTANCE_PARENT: String(process.pid),
      },
    });
    await until(() => focused());
    assert.equal(receipt().shiftDown, false, 'do not start while physical Shift is down');
    monitor = setInterval(() => {
      if (!focused()) {
        focusLost = true;
        socket?.destroy();
        void service.shutdown();
      }
    }, 25);
    await service.configure({
      enabled: true,
      directListener: false,
      bindAddress: '127.0.0.1',
      local: { view: true, control: true },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const first = await open();
    await click('input');
    for (const code of [0x1e, 0x02, 0x30, 0x03]) await press(code);
    await until(() => receipt().text === 'a1b2');
    await click('button');
    await until(() => receipt().events.some((e: any) => e.kind === 'click'));
    await click('input');
    await send({ kind: 'key', code: 0x2a, down: true });
    await until(() => receipt().shiftDown);
    const disconnectedAt = Date.now();
    socket!.destroy();
    await until(() => !receipt().shiftDown, 6000);
    const releaseMs = Date.now() - disconnectedAt;
    await until(() => !service.status('local').busy);
    await service.configure({
      enabled: true,
      directListener: false,
      bindAddress: '127.0.0.1',
      local: { view: true, control: false },
    });
    assert.throws(
      () =>
        service.open('local', {
          control: true,
          transport: 'management',
          quality: { fps: 30, bitrate: 4000000, display: 0, adaptive: false },
        }),
      /CONTROL_DENIED/,
    );
    await service.configure({
      enabled: true,
      directListener: false,
      bindAddress: '127.0.0.1',
      local: { view: true, control: true },
    });
    const second = await open();
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.generation, first.generation);
    await click('input');
    for (const code of [0x2e, 0x04]) await press(code);
    await until(() => receipt().text === 'a1b2c3');
    const final = receipt();
    assert.ok(
      final.events.some((e: any) => e.kind === 'keyUp' && e.value === 16),
      'Shift key-up delivered after disconnect',
    );
    assert.ok(final.events.some((e: any) => e.kind === 'mouseDown' && e.value === 'Left'));
    assert.ok(final.events.some((e: any) => e.kind === 'mouseUp' && e.value === 'Left'));
    assert.equal(focusLost, false);
    const result = {
      ok: true,
      time: new Date().toISOString(),
      durationMs: Date.now() - started,
      nativeSha256: createHash('sha256')
        .update(await readFile(native))
        .digest('hex'),
      frames,
      inputCount,
      releaseMs,
      receipt: final,
      diagnostics,
      checks: [
        'foreground-pid-and-fresh-receipt-each-input',
        'letter-digit-text',
        'mouse-button-click',
        'socket-loss-releases-shift',
        'control-denied-before-reauthorization',
        'new-ticket-new-generation',
        'input-after-explicit-reauthorization',
      ],
      scope: 'own local acceptance window only',
      publicNetworkTested: false,
      pixelsPersisted: false,
    };
    await writeFile(evidence, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
} catch (error) {
  await writeFile(
    evidence,
    JSON.stringify(
      {
        ok: false,
        error: String(error),
        durationMs: Date.now() - started,
        inputCount,
        frames,
        focusLost,
        receipt: (() => {
          try {
            return receipt();
          } catch {
            return undefined;
          }
        })(),
        diagnostics,
        publicNetworkTested: false,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  clearTimeout(deadline);
  clearInterval(monitor);
  socket?.destroy();
  await viewer?.close().catch(() => {});
  await service.shutdown();
  server.close();
  if (child) {
    await writeFile(join(directory, 'stop'), 'stop');
    await Promise.race([new Promise<void>((r) => child!.once('exit', () => r())), sleep(1500)]);
    if (child.exitCode === null) child.kill();
  }
  await rm(directory, { recursive: true, force: true });
}
