import { readFile, mkdir, stat, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
const staged = resolve(
  process.argv[2] || join(root, `release/${version}/agent-${process.platform}-${process.arch}`),
);
const info = JSON.parse(await readFile(join(staged, 'build-info.json'), 'utf8'));
if (
  info.version !== version ||
  info.platform !== process.platform ||
  info.arch !== process.arch ||
  info.electron !== false
)
  throw new Error('CAgent staged metadata does not match this release runner');
const os = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
if (!os || !['x64', 'arm64'].includes(process.arch) || (os === 'win' && process.arch !== 'x64'))
  throw new Error('Unsupported CAgent artifact target');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result;
}
const nodeName = os === 'win' ? 'node.exe' : 'node';
const runtime = run(
  join(staged, nodeName),
  [
    '-p',
    'JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node})',
  ],
  { encoding: 'utf8', stdio: 'pipe' },
);
const actual = JSON.parse(runtime.stdout);
if (actual.platform !== info.platform || actual.arch !== info.arch || actual.node !== info.node)
  throw new Error('Bundled Node does not match build metadata');
for (const filename of [
  'agent.cjs',
  os === 'win' ? 'cagent.cmd' : 'cagent',
  'LICENSE',
  'LICENSE.node.txt',
  'THIRD_PARTY_NOTICES.txt',
  ...(os === 'win' ? ['Cagent.exe'] : []),
])
  if (!(await stat(join(staged, filename))).isFile())
    throw new Error(`Missing runtime file ${filename}`);
const destination = join(root, 'release', version);
await mkdir(destination, { recursive: true });
const name =
  os === 'win'
    ? `CAgent-Setup-${version}-win-x64.zip`
    : `CAgent-${version}-${os}-${process.arch}.tar.gz`;
const file = join(destination, name),
  temporary = await mkdtemp(join(tmpdir(), 'cagent-release-'));
try {
  const archive = join(temporary, name);
  if (os === 'win') {
    const installer = join(temporary, 'setup');
    run(process.execPath, [
      join(root, 'scripts/package-agent-windows-deployment.mjs'),
      staged,
      installer,
    ]);
    await cp(installer + '.zip', archive);
  } else run('tar', ['-czf', archive, '-C', staged, '.']);
  const extracted = join(temporary, 'extracted');
  await mkdir(extracted);
  run('tar', ['-xf', archive, '-C', extracted]);
  let verified = extracted;
  if (os === 'win') {
    const install = join(temporary, 'installed'),
      data = join(temporary, 'isolated-data');
    run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(extracted, 'Install-CAgent.ps1'),
        '-Destination',
        install,
        '-NoLaunch',
        '-NoShortcuts',
      ],
      { env: { ...process.env, CSHELL_AGENT_DATA: data } },
    );
    const manifest = JSON.parse(await readFile(join(extracted, 'deployment.json'), 'utf8'));
    verified = join(install, 'versions', manifest.installId);
  }
  // This executes the runtime extracted from the exact archive, not a host Node substitute.
  run(process.execPath, [
    require.resolve('tsx/cli'),
    join(root, 'scripts/agent-package-smoke.ts'),
    verified,
  ]);
  await cp(archive, file);
  const sha256 = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  await mkdir(join(root, 'test-results'), { recursive: true });
  await writeFile(
    join(root, `test-results/cagent-package-${os}-${process.arch}.json`),
    JSON.stringify(
      {
        version,
        platform: info.platform,
        arch: info.arch,
        node: actual.node,
        archive: name,
        bytes: (await stat(file)).size,
        sha256,
        extractedRuntimeVerified: true,
        installerVerified: os === 'win',
        signed: false,
      },
      null,
      2,
    ),
  );
  console.log(`${file} (${(await stat(file)).size} bytes, SHA256 ${sha256})`);
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
