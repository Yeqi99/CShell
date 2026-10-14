import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile, chmod, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { preparePty } from './prepare-pty.mjs';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const output = resolve(
  process.argv[2] || join(root, 'release', version, `agent-${process.platform}-${process.arch}`),
);
await mkdir(output, { recursive: true });
const result = await build({
  entryPoints: [join(root, 'src/agent/cli.ts')],
  outfile: join(output, 'agent.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  target: 'node22',
  external: ['node-pty'],
  metafile: true,
});
if (
  Object.keys(result.metafile.inputs).some((file) =>
    /(^|\/)electron(\/|$)|src\/desktop\//.test(file.replaceAll('\\', '/')),
  )
)
  throw new Error('Agent bundle must not contain Electron or desktop modules');
const pty = dirname(require.resolve('node-pty/package.json'));
await cp(pty, join(output, 'node_modules', 'node-pty'), { recursive: true, dereference: true });
const ptyRequire = createRequire(join(pty, 'package.json'));
await cp(
  dirname(ptyRequire.resolve('node-addon-api/package.json')),
  join(output, 'node_modules', 'node-addon-api'),
  { recursive: true, dereference: true },
);
await writeFile(
  join(output, 'package.json'),
  JSON.stringify(
    {
      name: 'cshell-agent-runtime',
      version,
      private: true,
      dependencies: {
        'node-pty': JSON.parse(await readFile(join(pty, 'package.json'), 'utf8')).version,
      },
    },
    null,
    2,
  ),
);
const checkNative = () =>
  new Promise((resolveCheck) => {
    const child = spawn(process.execPath, ['-e', "require('node-pty')"], {
      cwd: output,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => resolveCheck(false));
    child.once('exit', (code) => resolveCheck(code === 0));
  });
// N-API prebuilds may already match Node. Compile only in this stage when needed.
if (process.env.CSHELL_AGENT_REBUILD_NATIVE === '1' || !(await checkNative())) {
  preparePty(
    join(output, 'node_modules', 'node-pty'),
    process.env.CSHELL_AGENT_REBUILD_NATIVE === '1',
  );
}
if (!(await checkNative())) throw new Error('Staged Agent native PTY cannot load in Node');
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
await cp(process.execPath, join(output, nodeName));
const launcher = process.platform === 'win32' ? 'cshell-agent.cmd' : 'cshell-agent';
await writeFile(
  join(output, launcher),
  process.platform === 'win32'
    ? '@echo off\r\n"%~dp0node.exe" "%~dp0agent.cjs" %*\r\n'
    : '#!/bin/sh\nexec "$(dirname "$0")/node" "$(dirname "$0")/agent.cjs" "$@"\n',
  { mode: 0o755 },
);
if (process.platform !== 'win32') {
  await chmod(join(output, launcher), 0o755);
  await chmod(join(output, nodeName), 0o755);
}
await cp(join(root, 'LICENSE'), join(output, 'LICENSE'));
const packages = new Map();
for (const file of [
  ...Object.keys(result.metafile.inputs).filter((file) => file.includes('node_modules')),
  join(pty, 'package.json'),
]) {
  let directory = dirname(resolve(root, file));
  while (directory !== dirname(directory)) {
    try {
      const data = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (data.name && data.version) {
        packages.set(`${data.name}@${data.version}`, { directory, data });
        break;
      }
    } catch {}
    directory = dirname(directory);
  }
}
let notices = 'CShell Agent — bundled third-party licenses\n\n';
for (const [name, { directory, data }] of [...packages.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const files = (await readdir(directory)).filter((file) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(file),
  );
  if (!files.length) throw new Error(`Missing third-party license for ${name}`);
  notices += `${name}\nDeclared license: ${typeof data.license === 'string' ? data.license : JSON.stringify(data.license)}\n`;
  for (const file of files)
    notices += `${file}\n${await readFile(join(directory, file), 'utf8')}\n`;
  notices += '\n========================================\n\n';
}
await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), notices);
await cp(join(pty, 'deps', 'winpty', 'LICENSE'), join(output, 'LICENSE.winpty.txt'));
let nodeLicense;
const previousBuild = await readFile(join(output, 'build-info.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => undefined);
for (const candidate of [
  process.env.CSHELL_AGENT_NODE_LICENSE,
  join(dirname(process.execPath), 'LICENSE'),
  join(dirname(dirname(process.execPath)), 'LICENSE'),
  previousBuild?.node === process.versions.node ? join(output, 'LICENSE.node.txt') : undefined,
].filter(Boolean)) {
  try {
    const value = await readFile(candidate, 'utf8');
    if (value.includes('Node.js') && value.includes('Permission')) {
      nodeLicense = value;
      break;
    }
  } catch {}
}
if (!nodeLicense) {
  const response = await fetch(
    `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw new Error(
      `Cannot fetch exact Node ${process.versions.node} license (${response.status}); provide CSHELL_AGENT_NODE_LICENSE`,
    );
  nodeLicense = await response.text();
  if (!nodeLicense.includes('Node.js') || !nodeLicense.includes('Permission'))
    throw new Error('Invalid Node license response');
}
await writeFile(join(output, 'LICENSE.node.txt'), nodeLicense);
const removeStaged = async (relative) => {
  const target = resolve(output, relative);
  if (!target.startsWith(output + sep)) throw new Error('Unsafe stage cleanup path');
  await rm(target, { recursive: true, force: true });
};
const stagedPty = join(output, 'node_modules', 'node-pty');
for (const name of await readdir(join(stagedPty, 'prebuilds')).catch(() => []))
  if (name !== `${process.platform}-${process.arch}`)
    await removeStaged(join('node_modules', 'node-pty', 'prebuilds', name));
for (const name of ['src', 'deps', 'scripts', 'typings', 'third_party'])
  await removeStaged(join('node_modules', 'node-pty', name));
await removeStaged(join('node_modules', 'node-addon-api'));
async function trimDebug(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await trimDebug(full);
    else if (/\.pdb$|\.test\.js(?:\.map)?$|\.js\.map$/i.test(entry.name)) {
      if (!full.startsWith(output + sep)) throw new Error('Unsafe debug cleanup path');
      await rm(full);
    }
  }
}
await trimDebug(stagedPty);
if (process.platform === 'win32') {
  for (const [filename, command] of [
    ['Start Agent.cmd', 'run'],
    ['Agent Status.cmd', 'status'],
    ['Configure Agent.cmd', 'init'],
  ])
    await writeFile(
      join(output, filename),
      `@echo off\r\n"%~dp0node.exe" "%~dp0agent.cjs" ${command}\r\npause\r\n`,
    );
}
await writeFile(
  join(output, 'README.txt'),
  `CShell Agent ${version}\n\nRun cshell-agent init to choose shells and create credentials.\nRun cshell-agent run (Windows: Start Agent.cmd) to start the user process.\nIt does not install a Windows service and does not open remote access automatically.\nConfigure and explicitly start the listener from the CShell Agent extension.\nNo Electron or Chromium is bundled.\nKeep the complete Agent data directory, including vault-key, for recovery.\n`,
);
await writeFile(
  join(output, 'build-info.json'),
  JSON.stringify(
    {
      version,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: false,
    },
    null,
    2,
  ),
);
console.log(`Agent runtime staged: ${output}`);
