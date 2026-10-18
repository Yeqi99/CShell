import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function bundledAgentExecutable(directory: string, version: string): Promise<string> {
  const info = JSON.parse(await readFile(join(directory, 'build-info.json'), 'utf8'));
  if (info.version !== version || info.platform !== 'win32' || info.arch !== 'x64' || info.electron !== false)
    throw new Error('内置 cagent 版本或平台不匹配，请重新安装 CShell');
  for (const name of ['Cagent.exe', 'node.exe', 'agent.cjs'])
    if (!(await stat(join(directory, name))).isFile()) throw new Error('内置 cagent 文件缺失');
  return join(directory, 'Cagent.exe');
}
