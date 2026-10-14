import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function preparePty(directory, force = false) {
  const check = () =>
    spawnSync(process.execPath, ['-e', "require('./')"], {
      cwd: directory,
      stdio: 'pipe',
      windowsHide: true,
    }).status === 0;
  if (!force && check()) return;
  // The npm package already ships compiled JS. Its prepare script targets old TypeScript;
  // only install/postinstall are needed to select or compile the native binding.
  const windows = process.platform === 'win32';
  const result = spawnSync(
    windows ? 'cmd.exe' : 'npm',
    windows ? ['/d', '/s', '/c', 'npm run install'] : ['run', 'install'],
    {
      cwd: directory,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, npm_config_runtime: 'node', npm_config_target: process.versions.node },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 || !check())
    throw new Error('Native PTY install failed on this platform');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  preparePty(dirname(createRequire(import.meta.url).resolve('node-pty/package.json')));
  console.log(`Native PTY ready: ${process.platform}/${process.arch}`);
}
