import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { builtinPlugins, pluginId, type InstalledPlugin } from '../shared/plugins';
import { clientShellSchema } from '../shared/client';
import { readCustomExtension } from './custom-extensions';
import { lanRegistrationSchema } from '../shared/agent-lan';

const packages = z.array(z.object({ file: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(30).default([]);
export const deploymentSchema = z.discriminatedUnion('target', [
  z.object({ format: z.literal('cshell-deployment-1'), target: z.literal('cshell'),
    extensions: z.array(z.object({ id: pluginId, enabled: z.boolean() }).strict()).max(100), packages }).strict(),
  z.object({ format: z.literal('cshell-deployment-1'), target: z.literal('cagent'),
    preset: z.literal('classroom-student').optional(),
    lanDiscovery: lanRegistrationSchema.optional(),
    passwordFile: z.string().min(1).max(4096), bind: z.string().min(1).max(253).default('127.0.0.1'),
    port: z.number().int().min(1024).max(65535).default(24443), listenOnLaunch: z.boolean().default(false),
    shells: z.array(clientShellSchema).min(1).max(6),
    permissions: z.object({ manage: z.boolean(), http: z.boolean(), hosting: z.boolean(), relay: z.boolean() }).strict(), packages }).strict(),
]);
export async function deploymentFile(path: string) {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw Error('部署配置必须为不超过 64 KiB 的普通文件');
  let input: unknown;
  try { input = JSON.parse((await readFile(absolute, 'utf8')).replace(/^\uFEFF/, '')); } catch { throw Error('部署配置不是有效 JSON'); }
  const parsed = deploymentSchema.safeParse(input);
  if (!parsed.success) throw Error('部署配置字段无效；密码只能通过 passwordFile 提供');
  return { config: parsed.data, directory: dirname(absolute) };
}
/** Validate all package bytes before making any changes. Never executes extension code. */
export async function deploymentPackages(input: Awaited<ReturnType<typeof deploymentFile>>) {
  const seen = new Set<string>();
  const result = [];
  let total = 0;
  let decoded = 0;
  for (const entry of input.config.packages) {
    const path = resolve(input.directory, entry.file), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 * 1024) throw Error('部署扩展包文件无效');
    total += info.size;
    if (total > 256 * 1024 * 1024) throw Error('部署扩展包总量超过 256 MiB');
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== entry.sha256) throw Error('部署扩展包摘要不匹配');
    const pack = await readCustomExtension(path);
    decoded += pack.bytes;
    if (decoded > 192 * 1024 * 1024) throw Error('部署扩展解包总量超过 192 MiB');
    if (pack.value.manifest.provider === 'wechat' && (process.platform !== 'win32' || process.arch !== 'x64')) throw Error('此微信扩展仅适用于 Windows x64');
    if (seen.has(pack.value.manifest.id)) throw Error('部署配置包含重复扩展');
    seen.add(pack.value.manifest.id);
    if (input.config.target === 'cagent' && !['wechat', 'process'].includes(pack.value.manifest.provider)) throw Error('扩展不支持 CAgent');
    result.push(pack);
  }
  return result;
}
/** Root caller must establish a genuinely new local store BEFORE constructing Store.
 * Existing account/guest stores must never be passed here as a new installation. */
export function initialDesktopPlugins(config: unknown): InstalledPlugin[] {
  const parsed = deploymentSchema.safeParse(config);
  if (!parsed.success || parsed.data.target !== 'cshell') throw Error('CShell 部署配置无效');
  const seen = new Set<string>();
  return parsed.data.extensions.map(selection => {
    const manifest = builtinPlugins.find(item => item.id === selection.id);
    if (!manifest || seen.has(selection.id)) throw Error('部署配置包含未知或重复的内置扩展');
    seen.add(selection.id);
    return { manifest: structuredClone(manifest), enabled: selection.enabled, source: 'bundled' };
  });
}
