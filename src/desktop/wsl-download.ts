import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { z } from 'zod';
const imageSchema = z.object({
  Url: z.string().url(),
  Sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});
export function ubuntuImage(manifest: unknown, arch: string) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('此设备架构暂不支持自动安装 Ubuntu');
  const data = z
    .object({
      ModernDistributions: z.object({
        Ubuntu: z.array(
          z.object({
            Name: z.string(),
            Amd64Url: imageSchema.optional(),
            Arm64Url: imageSchema.optional(),
          }),
        ),
      }),
    })
    .parse(manifest);
  const entry = data.ModernDistributions.Ubuntu.find((d) => d.Name === 'Ubuntu');
  const image = arch === 'arm64' ? entry?.Arm64Url : entry?.Amd64Url;
  if (!image) throw new Error('官方目录中没有此架构的 Ubuntu');
  const url = new URL(image.Url);
  if (
    url.protocol !== 'https:' ||
    !['releases.ubuntu.com', 'cdimages.ubuntu.com', 'cdimage.ubuntu.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    !url.pathname.endsWith('.wsl')
  )
    throw new Error('Ubuntu 下载地址不受信任');
  return image;
}
export async function downloadUbuntu(path: string, fetcher: typeof fetch, arch = process.arch) {
  let manifest: unknown;
  // Both endpoints are Microsoft-controlled metadata, fetched through Electron's
  // system proxy rather than the WSL installer's separate WinINet network path.
  for (const url of [
    'https://raw.githubusercontent.com/microsoft/WSL/master/distributions/DistributionInfo.json',
    'https://api.github.com/repos/microsoft/WSL/contents/distributions/DistributionInfo.json?ref=master',
  ]) {
    try {
      const response = await fetcher(url, {
        headers: { Accept: 'application/vnd.github.raw+json' },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error('目录下载失败');
      const text = await response.text();
      if (text.length > 500000) throw new Error('目录过大');
      manifest = JSON.parse(text);
      break;
    } catch {
      /* Try the official alternative endpoint, never an arbitrary mirror. */
    }
  }
  const image = ubuntuImage(manifest, arch);
  const response = await fetcher(image.Url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error('无法下载 Ubuntu，请检查系统代理与网络');
  const file = await open(path, 'wx'),
    reader = response.body.getReader(),
    hash = createHash('sha256');
  let size = 0,
    valid = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 4 * 1024 ** 3) throw new Error('Ubuntu 镜像大小超出限制');
      hash.update(next.value);
      await file.writeFile(next.value);
    }
    if (hash.digest('hex').toLowerCase() !== image.Sha256.toLowerCase())
      throw new Error('Ubuntu 镜像校验失败，未执行安装');
    valid = true;
  } finally {
    await file.close();
    await reader.cancel().catch(() => {});
    if (!valid) await rm(path, { force: true });
  }
}
