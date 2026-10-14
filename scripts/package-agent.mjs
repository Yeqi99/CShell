import { readFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = resolve(
  process.argv[2] || `release/${version}/agent-${process.platform}-${process.arch}`,
);
const info = JSON.parse(await readFile(join(staged, 'build-info.json'), 'utf8'));
if (
  info.version !== version ||
  info.platform !== process.platform ||
  info.arch !== process.arch ||
  info.electron !== false
)
  throw new Error('Agent staged metadata does not match this release runner');
const os = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
if (!os || !['x64', 'arm64'].includes(process.arch))
  throw new Error('Unsupported Agent artifact target');
const destination = resolve('release', version);
await mkdir(destination, { recursive: true });
const file = join(
  destination,
  `CShell-Agent-${version}-${os}-${process.arch}.${os === 'win' ? 'zip' : 'tar.gz'}`,
);
const args =
  os === 'win' ? ['-a', '-cf', file, '-C', staged, '.'] : ['-czf', file, '-C', staged, '.'];
const result = spawnSync('tar', args, { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Agent archive failed');
console.log(`${file} (${(await stat(file)).size} bytes)`);
