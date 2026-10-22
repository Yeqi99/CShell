import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
/** Installation tooling stays inside the explicitly selected application directory. */
export async function privateNpm(directory: string, signal?: AbortSignal): Promise<string> {
  const root = join(directory, 'runtime', 'npm-10.9.4'),
    entry = join(root, 'package', 'bin', 'npm-cli.js');
  try {
    await stat(entry);
    if (
      (
        await exec(process.execPath, [entry, '--version'], {
          signal,
          windowsHide: true,
          timeout: 15000,
        })
      ).stdout.trim() === '10.9.4'
    )
      return entry;
  } catch {}
  const response = await fetch('https://registry.npmjs.org/npm/10.9.4', { signal });
  if (!response.ok) throw Error('无法获取私有安装工具');
  const meta = (await response.json()) as { dist: { tarball: string; integrity: string } };
  const url = new URL(meta.dist.tarball);
  if (url.origin !== 'https://registry.npmjs.org' || !url.pathname.startsWith('/npm/-/'))
    throw Error('安装工具来源无效');
  const download = await fetch(url, { signal });
  if (!download.ok || !download.body) throw Error('私有安装工具下载失败');
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of download.body as any) {
    size += part.length;
    if (size > 30 * 1024 * 1024) throw Error('安装工具超过大小限制');
    parts.push(Buffer.from(part));
  }
  const data = Buffer.concat(parts);
  if (meta.dist.integrity !== 'sha512-' + createHash('sha512').update(data).digest('base64'))
    throw Error('安装工具摘要校验失败');
  await mkdir(root, { recursive: true });
  const archive = join(root, 'npm.tgz');
  await writeFile(archive, data, { mode: 0o600 });
  const list = (
    await exec('tar', ['-tzf', archive], { signal, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  ).stdout
    .trim()
    .split(/\r?\n/);
  if (
    list.some((p) => !p.startsWith('package/') || p.includes('\\') || p.split('/').includes('..'))
  )
    throw Error('安装工具包含无效路径');
  await exec('tar', ['-xzf', archive, '-C', root], { signal, windowsHide: true, maxBuffer: 65536 });
  const version = (
    await exec(process.execPath, [entry, '--version'], { signal, windowsHide: true })
  ).stdout.trim();
  if (version !== '10.9.4') throw Error('私有安装工具版本校验失败');
  return entry;
}
