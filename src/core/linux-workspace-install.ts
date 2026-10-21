import { quote } from './remote-jobs';

// Official Node release archives. Pins are verified against nodejs.org SHASUMS256.txt.
export const linuxNodeRuntime = {
  version: '22.23.3',
  x86_64: {
    arch: 'x64',
    sha256: 'df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de',
  },
  aarch64: {
    arch: 'arm64',
    sha256: 'a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f',
  },
} as const;
export const linuxInstallTools = [
  'curl',
  'tar',
  'xz',
  'sha256sum',
  'python3',
  'make',
  'g++',
] as const;
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
  const runtime = linuxNodeRuntime[arch];
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
for tool in ${linuxInstallTools.join(' ')}; do command -v "$tool" >/dev/null 2>&1 || { echo "缺少构建工具 $tool；未修改系统，请先准备依赖后重试" >&2; exit 1; }; done
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
mkdir "$stage/runtime"
echo '下载 cagent 私有 Node.js ${linuxNodeRuntime.version}；不修改系统 Node/npm'
curl --fail --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 300 --retry 2 'https://nodejs.org/dist/v${linuxNodeRuntime.version}/node-v${linuxNodeRuntime.version}-linux-${runtime.arch}.tar.xz' -o "$stage/runtime.tar.xz"
printf '%s  %s\\n' ${quote(runtime.sha256)} "$stage/runtime.tar.xz" | sha256sum -c -
tar -xJf "$stage/runtime.tar.xz" --strip-components=1 -C "$stage/runtime"
rm "$stage/runtime.tar.xz"
"$stage/runtime/bin/node" -e 'if(process.versions.node!=="${linuxNodeRuntime.version}")throw Error("Private runtime verification failed")'
cp "$payload" "$stage/agent.cjs"
mkdir -p "$base/cache/npm" "$base/cache/node-gyp"
(
  cd "$stage"
  export PATH="$stage/runtime/bin:$PATH"
  export npm_config_cache="$base/cache/npm" npm_config_devdir="$base/cache/node-gyp" npm_config_nodedir="$stage/runtime"
  export npm_config_userconfig="$stage/npmrc" npm_config_globalconfig="$stage/global-npmrc" npm_config_registry='https://registry.npmjs.org'
  export npm_config_prefix="$stage/runtime" npm_config_update_notifier=false
  : > "$stage/npmrc"
  : > "$stage/global-npmrc"
  printf '{"name":"cagent-private-runtime","private":true}\\n' > package.json
  npm install --ignore-scripts --save-exact --omit=dev --no-audit --no-fund node-pty@1.1.0 node-addon-api@7.1.1
  node -e 'const p=require("./package-lock.json").packages["node_modules/node-pty"];if(p?.integrity!=="sha512-20JqtutY6JPXTUnL0ij1uad7Qe1baT46lyolh2sSENDd4sTzKZ4nmAFkeAARDKwmlLjPx6XKRlwRUxwjOy+lUg==")throw Error("node-pty integrity mismatch")'
  node -e 'const p=require("./package-lock.json").packages["node_modules/node-addon-api"];if(p?.integrity!=="sha512-5m3bsyrjFWE1xf7nz7YXdN4udnVtXK6/Yfgn5qnahL6bCkf2yKt4k3nuTKAtT4r3IG8JNR2ncsIMdZuAzJjHQQ==")throw Error("node-addon-api integrity mismatch")'
  npm rebuild node-pty
  node -e 'require("node-pty")'
)
cat > "$stage/cagent" <<'CAGENT_LAUNCHER'
#!/bin/sh
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
CSHELL_AGENT_DATA=$(CDPATH= cd -- "$directory/../../data" && pwd -P)
export CSHELL_AGENT_DATA
exec "$directory/runtime/bin/node" "$directory/agent.cjs" "$@"
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
