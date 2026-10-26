import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpath, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/classroom/Install-AI-Lab.ps1');
const windows = process.platform === 'win32';
function run(args: string[]) {
  const env={...process.env};delete env.PSModulePath;
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', timeout: 20000, env });
}
function checkPreview(result: ReturnType<typeof run>, requiredGiB: number) {
  const json = result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1);
  assert.ok(json, `Preview plan missing: status=${result.status}; error=${result.error}; stderr=${result.stderr}`);
  const plan = JSON.parse(json);
  assert.equal(plan.requiredGiB, requiredGiB);
  assert.equal(typeof plan.availableGiB, 'number');
  if (plan.spaceReady) {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Preview only/);
  } else {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Insufficient free space/);
    assert.doesNotMatch(result.stdout, /Preview only/);
  }
}
test('AI lab task fits batch limit and pins distributions before execution', async () => {
  const source = await readFile(script, 'utf8');
  assert.ok(Buffer.byteLength(source) < 16384);
  assert.match(source, /NoRegistry=1 \/NoShortcuts=1/);
  assert.match(source, /AddToPath=0 \/RegisterPython=0/);
  assert.ok(source.indexOf('Get-FileHash') < source.indexOf('Run $installer'));
  assert.match(source, /SignerCertificate.Subject -notmatch 'Microsoft Corporation'/);
  assert.match(source, /PIP_EXTRA_INDEX_URL/);
  assert.match(source, /sys.version_info\[:2\] == \(3,13\)/);
  assert.match(source, /no CPU fallback/);
});
test('preview emits CPU plan without creating its directory; explicit CUDA and proxy remain preview', { skip: !windows }, async () => {
  const temp = await mkdtemp(join(await realpath(tmpdir()), 'cshell-lab-preview-'));
  try {
  // Hidden ancestors (including AppData on Windows runners) are valid paths.
  assert.equal(spawnSync('attrib.exe',['+h',temp],{encoding:'utf8'}).status,0);
    const root = join(temp, 'new lab');
    const result = run(['-Root', root]);
    checkPreview(result, 20);
    assert.match(result.stdout, /"compute":\s*"CPU"/);
    await assert.rejects(access(root));
    const cuda = run(['-Root', root, '-Compute', 'CUDA', '-CudaIndex', 'cu126', '-Proxy', 'http://127.0.0.1:7890']);
    checkPreview(cuda, 30);
    assert.match(cuda.stdout, /whl\/cu126/);
    await assert.rejects(access(root));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('existing unowned or incomplete conda is not overwritten, credentials in proxy rejected', { skip: !windows }, async () => {
  const temp = await mkdtemp(join(await realpath(tmpdir()), 'cshell-lab-existing-'));
  try {
    const sentinel = join(temp, 'python.exe'); await writeFile(sentinel, 'existing-python');
    assert.notEqual(run(['-Root', temp, '-Apply']).status, 0);
    assert.equal(await readFile(sentinel, 'utf8'), 'existing-python');
    await writeFile(join(temp, 'lab-deployment.json'), JSON.stringify({ format: 'cshell-ai-lab-1', root: temp, compute: 'CPU', torchIndex: 'https://download.pytorch.org/whl/cpu', state: 'installing' }));
    assert.notEqual(run(['-Root', temp, '-Apply']).status, 0);
    assert.notEqual(run(['-Root', join(temp, 'new'), '-Proxy', 'https://user:secret@example.com']).status, 0);
    assert.notEqual(run(['-Root', 'relative-path']).status, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
