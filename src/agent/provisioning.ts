import { lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { deploymentFile, deploymentPackages } from '../core/provisioning';
import { installCustomExtension } from '../core/custom-extensions';
import { ClientVault } from '../core/client/identity';
import { hashPassword } from '../core/client/password';
import { agentCodec } from './storage';

async function exists(path: string) { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
export async function provisionAgent(file: string, directory: string, apply = false) {
  // Do not include user input, password, hashes, or raw parser errors in diagnostics.
  const input = await deploymentFile(file), config = input.config;
  if (config.target !== 'cagent') throw Error('请选择 CAgent 部署配置');
  const destination = resolve(directory);
  if (await exists(destination)) return { applied: false, existingDataPreserved: true, reason: '已有数据目录；初始部署不会更改身份、密码、权限或扩展' };
  const addresses = ['127.0.0.1', '::1', '0.0.0.0', ...Object.values(networkInterfaces()).flatMap(items => items?.map(item => item.address) ?? [])];
  if (!addresses.includes(config.bind)) throw Error('部署监听地址不是本机接口');
  const passwordPath = resolve(input.directory, config.passwordFile), info = await lstat(passwordPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 512) throw Error('密码文件必须为不超过 512 字节的普通文件');
  if (process.platform !== 'win32' && (info.uid !== process.getuid?.() || (info.mode & 0o077))) throw Error('密码文件必须归当前用户所有且权限为 0600');
  const password = (await readFile(passwordPath, 'utf8')).replace(/\r?\n$/, '');
  if (!password.length || password.length > 128 || /[\r\n\0]/.test(password)) throw Error('密码文件内容无效');
  const packs = await deploymentPackages(input);
  const plan = { bind: config.bind, port: config.port, listenOnLaunch: config.listenOnLaunch, shells: config.shells, permissions: config.permissions, preset: config.preset, lanDiscovery: config.lanDiscovery,
    extensions: packs.map(pack => ({ id: pack.value.manifest.id, version: pack.value.manifest.version, executionGranted: false })), firewallChanged: false };
  if (!apply) return { applied: false, plan };
  // Adjacent staging + atomic directory rename means a failed encryption/write never
  // leaves a half-initialized destination. Existing installations are never merged.
  for (let ancestor = dirname(destination);; ancestor = dirname(ancestor)) {
    if (await exists(ancestor) && (await lstat(ancestor)).isSymbolicLink()) throw Error('部署数据目录不能经过链接');
    if (dirname(ancestor) === ancestor) break;
  }
  await mkdir(dirname(destination), { recursive: true });
  const stage = await mkdtemp(join(dirname(destination), '.cagent-provision-'));
  try {
    const vault = new ClientVault(stage, await agentCodec(stage));
    await vault.identity();
    await vault.write('access', { ...await hashPassword(password), shells: [...new Set(config.shells)], allowManage: config.permissions.manage, allowHttp: config.permissions.http, allowHosting: config.permissions.hosting, allowRelay: config.permissions.relay });
    await vault.write('connection-password', password);
    await vault.write('listener', { bind: config.bind, port: config.port });
    await vault.write('connection-resume-listener', config.listenOnLaunch);
    if (config.lanDiscovery) await vault.write('lan-registration', config.lanDiscovery);
    if (config.preset === 'classroom-student') await vault.write('desktop-config', {
      enabled: true, authenticatedPeers: true, directListener: false, bindAddress: '127.0.0.1', tcpPort: 9998, udpPort: 9999,
      local: { view: true, control: true }, ownerGrants: {},
    });
    await vault.flush();
    if (await exists(destination)) throw Error('数据目录已由其他进程创建；未覆盖');
    await rename(stage, destination);
  } finally { await rm(stage, { recursive: true, force: true }); }
  // Package imports grant no execution permissions. A failure is explicit; the
  // valid initialized identity is retained rather than rolled back or replaced.
  try { for (const pack of packs) await installCustomExtension(pack); }
  catch { throw Error('初始连接配置已保存，但扩展导入失败；身份已保留，请单独重试 extension-import'); }
  return { applied: true, plan, remoteListenerStarted: false };
}
