import { copyFile, chmod, access, rm, readdir, mkdtemp } from 'node:fs/promises';
import { renameSync, existsSync } from 'node:fs';
import { constants } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** Stage beside the running AppImage so the final swap is on one filesystem. */
export async function prepareAppImageUpdate(source: string, target: string) {
  if (!target || !target.endsWith('.AppImage')) throw Error('请使用 AppImage 启动 CShell 后更新；当前运行方式无法原位替换');
  await access(target, constants.R_OK);
  await access(dirname(target), constants.W_OK);
  const stage = join(dirname(target), '.' + basename(target) + '.' + randomUUID() + '.next');
  const backup = target + '.previous-' + randomUUID();
  await copyFile(source, stage);
  await chmod(stage, 0o755);
  return {
    cancel: () => rm(stage, { force: true }),
    commit() {
      renameSync(target, backup);
      try { renameSync(stage, target); }
      catch (error) { if (!existsSync(target)) renameSync(backup, target); throw error; }
      return backup;
    },
  };
}

const execute = promisify(execFile);
/** Mount the verified DMG privately, validate bundle identity, then stage a copy. */
export async function prepareMacUpdate(source: string, executable: string, version: string) {
  const marker = executable.lastIndexOf('.app/Contents/');
  if (marker < 0) throw Error('当前程序不是可更新的 macOS 应用');
  const target = executable.slice(0, marker + 4);
  await access(dirname(target), constants.W_OK);
  const stage = join(dirname(target), '.' + basename(target) + '.' + randomUUID() + '.app');
  const backup = target + '.previous-' + randomUUID();
  const mount = await mkdtemp(join(tmpdir(), 'cshell-update-'));
  let mounted = false;
  try {
    await execute('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, source]); mounted = true;
    const apps = (await readdir(mount)).filter(name => name.endsWith('.app'));
    if (apps.length !== 1) throw Error('安装包中应用数量异常');
    const incoming = join(mount, apps[0]);
    const property = async (bundle: string, key: string) => (await execute('/usr/libexec/PlistBuddy', ['-c', 'Print :' + key, join(bundle, 'Contents/Info.plist')])).stdout.trim();
    if (await property(incoming, 'CFBundleIdentifier') !== await property(target, 'CFBundleIdentifier')) throw Error('安装包应用身份不符');
    if (await property(incoming, 'CFBundleShortVersionString') !== version) throw Error('安装包版本不符');
    await execute('/usr/bin/ditto', [incoming, stage]);
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  finally {
    if (mounted) await execute('/usr/bin/hdiutil', ['detach', mount]);
    await rm(mount, { recursive: true, force: true });
  }
  return {
    target,
    cancel: () => rm(stage, { recursive: true, force: true }),
    commit() {
      renameSync(target, backup);
      try { renameSync(stage, target); }
      catch (error) { if (!existsSync(target)) renameSync(backup, target); throw error; }
      return backup;
    },
  };
}
