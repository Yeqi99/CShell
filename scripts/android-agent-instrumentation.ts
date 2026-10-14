import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'cshell-android-instrumentation-'));
const configPath = join(directory, 'fixture.json');
const fixture = spawn(
  process.execPath,
  ['--import', 'tsx', 'scripts/android-agent-fixture.ts', configPath],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let diagnostic = '';
for (const stream of [fixture.stdout, fixture.stderr])
  stream.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-8000);
  });
async function adb(args: string[], timeout = 180_000) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('adb', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output = (output + chunk).slice(-100_000);
      });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Android verification timed out'));
    }, timeout);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(output) : reject(new Error(`adb failed (${code}): ${output}`));
    });
  });
}
try {
  let settings: { host: string; port: number; password: string; fingerprint: string } | undefined;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (fixture.exitCode !== null) throw new Error(`Agent fixture exited: ${diagnostic}`);
    try {
      settings = JSON.parse(await readFile(configPath, 'utf8'));
      break;
    } catch {
      await delay(250);
    }
  }
  if (!settings) throw new Error(`Agent fixture did not start: ${diagnostic}`);
  await adb(['install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk']);
  await adb([
    'install',
    '-r',
    'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
  ]);
  const report = await adb([
    'shell',
    'am',
    'instrument',
    '-w',
    '-e',
    'agentHost',
    settings.host,
    '-e',
    'agentPort',
    String(settings.port),
    '-e',
    'agentPassword',
    settings.password,
    '-e',
    'agentFingerprint',
    settings.fingerprint,
    'org.canpshell.mobile.test/org.canpshell.mobile.AgentProtocolTest',
  ]);
  // Never persist fixture credentials, including in an unexpected instrumentation error.
  const safeReport = (report + '\nAgent TLS diagnostics:\n' + diagnostic).replaceAll(
    settings.password,
    '[redacted]',
  );
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/android-agent-instrumentation.txt', safeReport);
  if (
    !report.includes('OK (3 tests)') ||
    /FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed/.test(report)
  )
    throw new Error(safeReport);
  console.log(safeReport);
  if (process.env.CSHELL_ANDROID_RELEASE_DIR) {
    const releases = (await readdir(process.env.CSHELL_ANDROID_RELEASE_DIR)).filter((name) =>
      name.endsWith('.apk'),
    );
    if (releases.length !== 1)
      throw new Error('Exactly one verified signed Android APK is required');
    // Only the disposable CI emulator: remove debug signing identity before installing release.
    await adb(['uninstall', 'org.canpshell.mobile']);
    await adb(['install', join(process.env.CSHELL_ANDROID_RELEASE_DIR, releases[0])]);
    const launch = await adb([
      'shell',
      'am',
      'start',
      '-W',
      '-n',
      'org.canpshell.mobile/.MainActivity',
    ]);
    if (!launch.includes('Status: ok')) throw new Error(`Signed APK did not launch: ${launch}`);
    await delay(3000);
    const pid = (await adb(['shell', 'pidof', 'org.canpshell.mobile'])).trim();
    if (!/^\d+(?: \d+)*$/.test(pid)) throw new Error('Signed APK exited after launch');
    await writeFile('test-results/android-release-launch.txt', launch + '\nRunning PID: ' + pid);
    console.log('PASS: signed release APK installs and remains running on the emulator');
  }
} finally {
  fixture.kill('SIGTERM');
  for (let attempt = 0; attempt < 20 && fixture.exitCode === null; attempt++) await delay(100);
  if (fixture.exitCode === null) fixture.kill('SIGKILL');
  await rm(directory, { recursive: true, force: true });
}
