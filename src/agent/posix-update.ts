import { access, mkdir, readFile, readdir, realpath, rm, lstat } from 'node:fs/promises';
import { constants, renameSync, existsSync } from 'node:fs';
import { dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function prepareAgentReplacement(archive: string, version: string, dataDirectory: string) {
  if (process.platform === 'win32') throw Error('Windows 使用原生安装程序更新');
  const root = await realpath(dirname(process.argv[1]));
  if (await realpath(join(root, 'node')) !== await realpath(process.execPath)) throw Error('请通过 CAgent 独立运行包启动后更新，不修改系统 Node');
  const data = relative(root, resolve(dataDirectory));
  if (!data || (!data.startsWith('..') && !isAbsolute(data))) throw Error('数据目录位于程序内，请先将数据迁移到独立目录后更新');
  const old = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'));
  if (old.platform !== process.platform || old.arch !== process.arch || old.electron !== false) throw Error('当前安装身份无法验证');
  await access(dirname(root), constants.W_OK);
  const stage = root + '.update-' + randomUUID(), backup = root + '.previous-' + randomUUID();
  await mkdir(stage, { mode: 0o700 });
  try {
    const names = (await execute('tar', ['-tzf', archive], { maxBuffer: 8 * 1024 * 1024 })).stdout.split('\n').filter(Boolean);
    if (names.some(name => name.startsWith('/') || name.split('/').includes('..'))) throw Error('安装包包含无效路径');
    const details = (await execute('tar', ['-tvzf', archive], { maxBuffer: 16 * 1024 * 1024 })).stdout.split('\n').filter(Boolean);
    if (details.some(line => !['-', 'd'].includes(line[0]))) throw Error('安装包包含不支持的链接或设备文件');
    await execute('tar', ['-xzf', archive, '-C', stage]);
    const info = JSON.parse(await readFile(join(stage, 'build-info.json'), 'utf8'));
    if (info.version !== version || info.platform !== process.platform || info.arch !== process.arch || info.electron !== false) throw Error('更新包版本或平台不符');
    for (const name of ['node', 'agent.cjs', 'cagent']) if (!(await lstat(join(stage, name))).isFile()) throw Error('更新包不完整');
    if (!(await readdir(stage)).includes('node_modules')) throw Error('更新包缺少运行依赖');
    await access(join(stage, 'node'), constants.X_OK);
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  return {
    cancel: () => rm(stage, { recursive: true, force: true }),
    commit() {
      renameSync(root, backup);
      try { renameSync(stage, root); }
      catch (error) { if (!existsSync(root)) renameSync(backup, root); throw error; }
      const command = ['app', 'app-host', 'restart-app-host'].includes(process.argv[2]) ? 'app' : 'run';
      const child = spawn(join(root, 'node'), [join(root, 'agent.cjs'), command], {
        detached: true, stdio: 'ignore', env: { ...process.env, CSHELL_AGENT_DATA: dataDirectory },
      });
      child.on('error', error => console.error('CAgent restart failed; previous program retained at', backup, error));
      child.unref();
    },
  };
}
