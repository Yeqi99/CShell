import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { z } from 'zod';
import { decodeWslOutput } from './wsl-setup';
const exec = promisify(execFile);
const executable = () => join(process.env.SystemRoot || 'C:/Windows', 'System32', 'wsl.exe');
const distroSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\0\r\n]+$/);
export const wslAccountSchema = z
  .object({
    distribution: distroSchema,
    username: z.string().regex(/^[a-z_][a-z0-9_-]{0,30}$/),
    password: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[^\0\r\n]+$/),
  })
  .strict();
export async function wslAccountStatus(distribution: unknown) {
  const name = distroSchema.parse(distribution);
  const { stdout } = await exec(executable(), ['-d', name, '--exec', 'id', '-u'], {
    windowsHide: true,
    timeout: 30000,
  });
  return { ready: /^\d+$/.test(stdout.trim()) && Number(stdout.trim()) !== 0 };
}
export const wslAccountScript = `set -eu
u="$1"
marker="/var/lib/cshell/setup-$u"
if id "$u" >/dev/null 2>&1; then
  test -f "$marker" || { echo 'Account already exists; choose a different username.' >&2; exit 1; }
else
  mkdir -p /var/lib/cshell
  useradd -m -s /bin/bash "$u"
  touch "$marker"
fi
IFS= read -r password
printf '%s:%s\\n' "$u" "$password" | chpasswd
unset password
if getent group sudo >/dev/null; then usermod -aG sudo "$u"; fi
`;
const running = new Set<string>();
export async function initializeWslAccount(input: unknown) {
  const { distribution, username, password } = wslAccountSchema.parse(input);
  if (running.has(distribution)) throw new Error('正在初始化，请稍候');
  running.add(distribution);
  try {
    if ((await wslAccountStatus(distribution)).ready)
      throw new Error('发行版已配置用户，无需再次初始化');
    const help = await exec(executable(), ['--help'], {
      encoding: 'buffer',
      windowsHide: true,
      timeout: 15000,
    });
    if (!decodeWslOutput(help.stdout).includes('--set-default-user'))
      throw new Error('请先更新 WSL 后再初始化用户（wsl --update）');
    // Only a fresh account created by this workflow may be retried; existing users are untouched.
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        executable(),
        [
          '-d',
          distribution,
          '-u',
          'root',
          '--exec',
          'sh',
          '-c',
          wslAccountScript,
          'cshell',
          username,
        ],
        { windowsHide: true, timeout: 60000 },
        (error) =>
          error ? reject(new Error('Linux 用户初始化失败，请检查用户名或重试。')) : resolve(),
      );
      child.stdin!.on('error', () => {});
      child.stdin!.end(password + '\n');
    });
    await exec(executable(), ['--manage', distribution, '--set-default-user', username], {
      windowsHide: true,
      timeout: 30000,
    });
    await exec(
      executable(),
      ['-d', distribution, '-u', 'root', '--exec', 'rm', '-f', `/var/lib/cshell/setup-${username}`],
      { windowsHide: true, timeout: 15000 },
    );
  } finally {
    running.delete(distribution);
  }
}
