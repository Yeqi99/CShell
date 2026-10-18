const { readFile, readdir, stat, cp } = require('node:fs/promises');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

async function verify(directory, version) {
  const info = JSON.parse(await readFile(join(directory, 'build-info.json'), 'utf8'));
  if (info.version !== version || info.platform !== 'win32' || info.arch !== 'x64' || info.electron !== false)
    throw new Error('Bundled CAgent must match the Windows x64 CShell version');
  for (const name of ['node.exe', 'agent.cjs', 'Cagent.exe', 'cagent-desktop.exe', 'LICENSE.node.txt', 'node_modules/node-pty/package.json'])
    if (!(await stat(join(directory, name))).isFile()) throw new Error(`Missing CAgent resource: ${name}`);
  const digest = createHash('sha256').update(await readFile(join(directory, 'cagent-desktop.exe'))).digest('hex');
  if (info.desktopNative?.sha256 !== digest) throw new Error('Bundled desktop helper digest differs');
}
async function inventory(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Bundled CAgent cannot contain symlinks');
    if (entry.isDirectory()) Object.assign(result, await inventory(join(directory, entry.name), name + '/'));
    else result[name] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex');
  }
  return result;
}
exports.verify = verify;
exports.beforePack = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  if (context.arch !== 1 || process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Bundled CAgent requires a native Windows x64 build host');
  const root = context.packager.projectDir;
  const version = context.packager.appInfo.version;
  const destination = join(root, 'release', version, 'agent-win32-x64');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts/agent-build.mjs'), destination], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`CAgent build failed: ${code}`)));
  });
  await verify(destination, version);
};
exports.afterPack = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const version = context.packager.appInfo.version;
  const source = join(context.packager.projectDir, 'release', version, 'agent-win32-x64');
  const destination = join(context.appOutDir, 'resources', 'cagent');
  await verify(source, version);
  const expected = await inventory(source);
  // electron-builder's extraResources matcher omits node_modules. These are the
  // standalone Node ABI dependencies, not Electron's dependency tree: copy them
  // verbatim and retain the complete post-copy digest check.
  await cp(join(source, 'node_modules'), join(destination, 'node_modules'), { recursive: true });
  await verify(destination, version);
  const actual = await inventory(destination);
  if (Object.keys(expected).length !== Object.keys(actual).length || Object.entries(expected).some(([name, hash]) => actual[name] !== hash))
    throw new Error('Packaged CAgent resources do not match the standalone build');
};
