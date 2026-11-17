import { quote } from './remote-jobs';

import { isPro } from '../shared/edition';

// SHA-256 values published for the last full Linux CAgent release in both channels.
const linuxRuntimeDigests = {
  pro: { x64: '4f54cda41b91e0e7571a1c224daa5a2c7eff3613bc17c80ff047ff231566e567', arm64: '1ad61aa92ef49d4b662627c781df952ea44bdee048f280e03abf89d035cb0954' },
  opensource: { x64: '3338a12818210393edb50be185db5770d4e2557042a4dd5f786334a8223d79af', arm64: '13135e42f9d94b88b1783f2cb537f9d915eb39448d5ea78f43cddcc70d7c6cdd' },
};
export const linuxInstallTools = ['curl', 'tar', 'gzip', 'sha256sum'] as const;
export const linuxInstallProbe = `uname -s
uname -m
id -un
if test -x "$HOME/.local/share/cagent/cshell/current/cagent"; then echo installed; else echo missing; fi
node --version 2>/dev/null || echo absent
npm --version 2>/dev/null || echo absent
for tool in ${linuxInstallTools.join(' ')}; do command -v "$tool" >/dev/null 2>&1 || printf 'missing:%s\\n' "$tool"; done`;

export function linuxWorkspaceInstallScript(
  arch: 'x86_64' | 'aarch64',
  hash: string,
  temporary: string,
  directory?: string,
) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid payload digest');
  const cpu = arch === 'x86_64' ? 'x64' : 'arm64';
  const edition = isPro ? 'pro' : 'opensource';
  const url = `https://shell.canp.ai/downloads/${edition}/v0.8.21/CAgent-0.8.21-linux-${cpu}.tar.gz`;
  return `set -eu
umask 077
payload=${quote(temporary)}
stage=''
lock=''
cleanup() { test -z "$stage" || rm -rf -- "$stage"; test -z "$lock" || rmdir "$lock"; rm -f -- "$payload"; }
trap cleanup EXIT
trap 'exit 130' INT TERM
test "$(uname -s)" = Linux
test "$(uname -m)" = ${quote(arch)}
for tool in ${linuxInstallTools.join(' ')}; do command -v "$tool" >/dev/null 2>&1 || { echo "缺少解包或下载工具 $tool；未修改系统，请先准备依赖后重试" >&2; exit 1; }; done
printf '%s  %s\\n' ${quote(hash)} "$payload" | sha256sum -c -
anchor="$HOME/.local/share/cagent/cshell"
base=${directory ? quote(directory) : '"$anchor"'}
if test "$base" != "$anchor"; then
  test ! -e "$anchor" && test ! -L "$anchor" || { echo '已有 cagent 目录，不能覆盖；请先迁移已有安装' >&2; exit 1; }
fi
if test -e "$base"; then
  test -d "$base" && test -z "$(ls -A "$base")" || { echo '安装目录必须为空，不能覆盖已有文件' >&2; exit 1; }
fi
mkdir -p "$base"
chmod 700 "$base"
mkdir "$base/.install-lock" || { echo '另一个 cagent 安装正在运行' >&2; exit 1; }
lock="$base/.install-lock"
test ! -e "$base/current" && test ! -L "$base/current" || { echo 'cagent 已存在，请重新检查安装状态' >&2; exit 1; }
stage=$(mktemp -d "$base/.install.XXXXXXXX")
echo '下载并校验 Linux ${cpu} CAgent 私有运行时与终端组件'
curl --fail --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 300 --retry 2 ${quote(url)} -o "$stage/runtime.tar.gz"
printf '%s  %s\\n' ${quote(linuxRuntimeDigests[edition][cpu])} "$stage/runtime.tar.gz" | sha256sum -c -
tar -xzf "$stage/runtime.tar.gz" --no-same-owner -C "$stage"
rm "$stage/runtime.tar.gz"
(cd "$stage" && ./node -e 'const b=require("./build-info.json");if(process.platform!=="linux"||process.arch!=="${cpu}"||b.arch!==process.arch||b.platform!==process.platform||b.version!=="0.8.21")throw Error("Unexpected CAgent runtime");require("node-pty")')
cp "$payload" "$stage/agent.cjs"
cat > "$stage/cagent" <<'CAGENT_LAUNCHER'
#!/bin/sh
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
CSHELL_AGENT_DATA=$(CDPATH= cd -- "$directory/../../data" && pwd -P)
export CSHELL_AGENT_DATA
exec "$directory/node" "$directory/agent.cjs" "$@"
CAGENT_LAUNCHER
chmod 700 "$stage/cagent"
mkdir -p "$base/releases"
dest="$base/releases/${hash.slice(0, 16)}-$(basename "$stage")"
mv "$stage" "$dest"
stage=''
ln -s "$dest" "$base/current"
legacy="\${XDG_STATE_HOME:-$HOME/.local/state}/cshell-agent"
if test -d "$legacy"; then ln -s "$legacy" "$base/data"; else mkdir "$base/data"; fi
if test "$base" != "$anchor"; then mkdir -p "$(dirname "$anchor")"; ln -s "$base" "$anchor"; fi
nohup "$dest/cagent" run </dev/null >"$base/runtime.log" 2>&1 &
attempt=0
until "$dest/cagent" status; do attempt=$((attempt+1)); test "$attempt" -lt 10 || { echo '启动失败，请查看 cagent runtime.log；未修改系统依赖' >&2; exit 1; }; sleep 1; done
echo 'cagent 已就绪；系统 Node/npm、软件源和全局 PATH 未更改'
`;
}
