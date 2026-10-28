#!/bin/sh
# CShell Linux user-directory installer. No sudo, package-manager or service changes.
set -eu
command -v python3 >/dev/null 2>&1 || { echo '需要 Python 3；也可在 https://shell.canp.ai/downloads.html 下载完整安装包。' >&2; exit 1; }
exec python3 - "$@" <<'PY'
import argparse, hashlib, json, os, pathlib, platform, re, shlex, shutil, sys, tarfile, tempfile, urllib.request
ORIGIN = 'https://shell.canp.ai'

def url_allowed(url, channel):
    from urllib.parse import urlsplit
    u = urlsplit(url)
    return u.scheme == 'https' and u.netloc == 'shell.canp.ai' and u.path.startswith('/downloads/' + channel + '/') and not u.query and not u.fragment and '..' not in u.path

class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not url_allowed(newurl, self.channel):
            raise ValueError('下载重定向离开所选香港渠道，已停止')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def select_asset(releases, product, channel, arch):
    for release in releases:
        if release.get('draft') or release.get('prerelease'): continue
        version = release.get('tag_name', '').removeprefix('pro-').removeprefix('v')
        if not re.fullmatch(r'\d+\.\d+\.\d+', version): continue
        name = ('CAgent-' + version + '-linux-' + arch + '.tar.gz') if product == 'cagent' else ('CShell-' + ('Pro-' if channel == 'pro' else '') + version + '-linux-' + ('x86_64' if arch == 'x64' else arch) + '.AppImage')
        for a in release.get('assets', []):
            if a.get('name') != name: continue
            if not url_allowed(a.get('browser_download_url', ''), channel) or not re.fullmatch(r'sha256:[a-f0-9]{64}', a.get('digest', '')) or not isinstance(a.get('size'), int) or not 0 < a['size'] < 2_000_000_000:
                raise ValueError('发行附件缺少有效来源、长度或 SHA256，已停止')
            return version, a
    raise ValueError('所选渠道尚无此架构的正式附件，请使用下载页核对支持范围')

def unpack(archive, dest):
    # Published bundles contain ordinary files/directories. Reject links/devices,
    # traversal and oversized archives rather than extracting untrusted paths.
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > 100000 or sum(m.size for m in members) > 2_000_000_000: raise ValueError('压缩包超过限制')
        for m in members:
            p = pathlib.PurePosixPath(m.name)
            if p.is_absolute() or '..' in p.parts or not (m.isfile() or m.isdir()): raise ValueError('压缩包包含不安全路径或特殊文件')
        for m in members:
            target = dest.joinpath(*pathlib.PurePosixPath(m.name).parts)
            if m.isdir(): target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(m) as source, open(target, 'xb') as output: shutil.copyfileobj(source, output)
                target.chmod(0o755 if m.mode & 0o111 else 0o644)

def main():
    p = argparse.ArgumentParser(description='从香港源校验并安装 CShell / CAgent，不修改系统环境')
    p.add_argument('product', choices=['cshell', 'cagent'])
    p.add_argument('--channel', choices=['opensource', 'pro'], default='opensource')
    p.add_argument('--directory', help='专用安装目录；默认 ~/.local/opt/产品-渠道')
    p.add_argument('--dry-run', action='store_true', help='仅检查最新附件并显示计划')
    args = p.parse_args()
    if platform.system() != 'Linux': raise ValueError('此指令只用于 Linux')
    arch = {'x86_64':'x64', 'amd64':'x64', 'aarch64':'arm64', 'arm64':'arm64'}.get(platform.machine().lower())
    if not arch: raise ValueError('仅支持 x64 / ARM64；不会安装其他架构附件')
    redirect = Redirects(); redirect.channel = args.channel
    opener = urllib.request.build_opener(redirect)
    opener.addheaders = [('User-Agent', 'CShell-Installer/1.0')]
    with opener.open(ORIGIN + '/downloads/' + args.channel + '/releases.json', timeout=30) as response:
        releases = json.loads(response.read(8_000_001))
    version, asset = select_asset(releases, args.product, args.channel, arch)
    root = pathlib.Path(args.directory or '~/.local/opt/' + args.product + '-' + args.channel).expanduser().absolute()
    if any(c in str(root) for c in '\n\r\x00') or root == pathlib.Path('/'): raise ValueError('请选择有效的专用安装目录')
    print('产品：%s · %s · %s · %s\n目录：%s\n附件：%s\n%s' % (args.product, args.channel, version, arch, root, asset['name'], asset['digest']))
    if args.dry_run: return
    marker = root / '.cshell-install.json'
    identity = {'product':args.product,'channel':args.channel,'arch':arch}
    if root.is_symlink(): raise ValueError('安装目录不能是符号链接')
    if root.exists() and any(root.iterdir()):
        if not marker.is_file() or json.loads(marker.read_text()) != identity: raise ValueError('目录已有其他文件或渠道不一致，请选择新的专用目录；原配置未改动')
    root.mkdir(parents=True, exist_ok=True)
    lock = root / '.install-lock'
    try: lock.mkdir()
    except FileExistsError: raise ValueError('安装正在进行或上次中断，请确认没有安装任务后再移除 .install-lock')
    try:
        expected_digest = asset['digest'].split(':')[1]
        target = root / ('version-' + version + '-' + expected_digest[:12])
        launcher = root / args.product
        receipt = target / '.source.json'
        if target.exists():
            if receipt.is_file() and json.loads(receipt.read_text()) == {'digest':asset['digest'],'size':asset['size']} and launcher.is_file() and str(target) in launcher.read_text():
                print('此版本已安装，保留现有程序与配置。启动：' + shlex.quote(str(launcher)) + (' app' if args.product == 'cagent' else ''))
                return
            raise ValueError('版本目录已有文件但安装记录不完整，未覆盖；请检查上次安装结果')
        with tempfile.TemporaryDirectory(prefix='.download-', dir=root) as temporary:
            stage = pathlib.Path(temporary); download = stage / 'artifact'; digest = hashlib.sha256(); size = 0
            print('正在下载并校验附件…', flush=True)
            with opener.open(asset['browser_download_url'], timeout=60) as response, open(download, 'wb') as output:
                while True:
                    block = response.read(1024 * 1024)
                    if not block: break
                    size += len(block)
                    if size > asset['size']: raise ValueError('下载长度超过发行记录')
                    digest.update(block); output.write(block)
                    if size % (16 * 1024 * 1024) == 0: print('已下载 %d / %d MiB' % (size // 1048576, (asset['size'] + 1048575) // 1048576), flush=True)
            if size != asset['size'] or 'sha256:' + digest.hexdigest() != asset['digest']: raise ValueError('附件长度或 SHA256 校验失败；未切换版本')
            payload = stage / 'payload'; payload.mkdir()
            executable = 'cagent' if args.product == 'cagent' else 'CShell.AppImage'
            if args.product == 'cagent':
                unpack(download, payload)
                if not all((payload / n).is_file() for n in ['cagent','node','agent.cjs']): raise ValueError('CAgent 包结构不完整')
            else: shutil.move(download, payload / executable)
            (payload / executable).chmod(0o755)
            target = root / ('version-' + version + '-' + digest.hexdigest()[:12])
            if target.exists(): raise ValueError('此版本已安装，未覆盖；可直接使用现有启动命令')
            (payload / '.source.json').write_text(json.dumps({'digest':asset['digest'],'size':asset['size']}))
            payload.rename(target)
            launcher = root / args.product
            next_launcher = root / (args.product + '.new')
            environment = ''
            if args.product == 'cagent':
                legacy = pathlib.Path(os.environ.get('CSHELL_AGENT_DATA', str(pathlib.Path(os.environ.get('XDG_STATE_HOME', str(pathlib.Path.home() / '.local/state'))) / 'cshell-agent')))
                saved_data = root / '.data-directory'
                data = pathlib.Path(saved_data.read_text()) if saved_data.exists() else (root / 'data' if (root / 'data').exists() else legacy if legacy.exists() else root / 'data')
                if not data.is_absolute() or any(c in str(data) for c in '\n\r\x00'): raise ValueError('原数据目录记录无效，未切换启动命令')
                saved_data.write_text(str(data))
                environment = 'export CSHELL_AGENT_DATA=' + shlex.quote(str(data)) + '\n'
            next_launcher.write_text('#!/bin/sh\n' + environment + 'exec ' + shlex.quote(str(target / executable)) + ' "$@"\n')
            next_launcher.chmod(0o755)
            marker.write_text(json.dumps(identity))
            next_launcher.replace(launcher)
        print('安装完成。旧版本与现有账号、连接、凭据保留。\n启动：' + shlex.quote(str(launcher)) + (' app' if args.product == 'cagent' else ''))
        print('未更改 PATH、软件源、防火墙或开机启动，未开放远程监听。')
    finally: lock.rmdir()

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('安装未完成：' + str(error), file=sys.stderr); sys.exit(1)
PY
