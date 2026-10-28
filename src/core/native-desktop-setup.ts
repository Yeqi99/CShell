// Fixed remote program. No renderer-supplied shell fragments, sudo, firewall changes or TCP listener.
export const nativeDesktopSetup = String.raw`
import os,sys,json,glob,shutil,subprocess,time,stat,signal
from pathlib import Path
action=sys.argv[1]
home=Path.home()
root=home/'.local/share/cshell/native-desktop'
sock=root/'desktop.sock'
pidfile=root/'process.json'
sessions=[]
for p in glob.glob('/proc/[0-9]*'):
 try:
  if os.stat(p).st_uid!=os.getuid(): continue
  if Path(p+'/comm').read_text().strip() not in ['gnome-shell','xfce4-session','plasmashell','mate-session','lxsession']: continue
  env=dict(v.split('=',1) for v in Path(p+'/environ').read_bytes().decode().split('\0') if '=' in v)
  display=env.get('DISPLAY',''); auth=env.get('XAUTHORITY',str(home/'.Xauthority'))
  if env.get('XDG_SESSION_TYPE')=='wayland': continue
  if display.startswith(':') and os.access(auth,os.R_OK) and not any(s['display']==display for s in sessions): sessions.append({'display':display,'auth':auth})
 except (OSError,ValueError,UnicodeError): pass
binary=shutil.which('x11vnc')
private=root/'package/usr/bin/x11vnc'
if not binary and private.is_file(): binary=str(private)
managed=False
try:
 pid=json.loads(pidfile.read_text())['pid']
 args=Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(b'\0')
 managed=os.stat('/proc/'+str(pid)).st_uid==os.getuid() and str(sock).encode() in args and b'-unixsock' in args and any(a.endswith(b'/x11vnc') for a in args)
except (OSError,ValueError,KeyError): pass
if action=='inspect':
 print(json.dumps({'sessions':[{'display':s['display']} for s in sessions],'installed':bool(binary),'canInstall':bool(shutil.which('apt-get') and shutil.which('dpkg-deb')),'running':managed,'socket':str(sock),'message':'检测到可共享的 X11 桌面' if sessions else '未检测到当前 SSH 用户的 X11 桌面；Wayland 或其他用户的桌面需先在系统中启用兼容共享。'}));sys.exit(0)
if action=='stop':
 if managed:
  os.kill(pid,signal.SIGTERM)
  for i in range(30):
   try:
    if str(sock).encode() not in Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(b'\0'):break
   except OSError:break
   time.sleep(.1)
  else:raise RuntimeError('共享进程尚未停止，请稍后重试')
 print(json.dumps({'stopped':True}));sys.exit(0)
if action not in ['start','install-start']: raise RuntimeError('Unknown operation')
if len(sessions)!=1: raise RuntimeError('请保留一个当前用户的 X11 图形会话后重试；不会猜测或接管其他用户桌面')
if root.is_symlink(): raise RuntimeError('共享目录不能是符号链接')
root.mkdir(parents=True,exist_ok=True,mode=0o700)
if root.stat().st_uid!=os.getuid(): raise RuntimeError('共享目录归属不匹配')
os.chmod(root,0o700)
if not binary:
 if action!='install-start': raise RuntimeError('缺少共享组件，请选择安装并开启')
 if not shutil.which('apt-get') or not shutil.which('dpkg-deb'): raise RuntimeError('此系统请先安装 x11vnc 后重试')
 import tempfile
 with tempfile.TemporaryDirectory(prefix='download-',dir=root) as cache:
  subprocess.run(['apt-get','download','x11vnc','libvncclient1','libvncserver1'],cwd=cache,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=180)
  dest=root/'package';dest.mkdir(exist_ok=True)
  for deb in Path(cache).glob('*.deb'):subprocess.run(['dpkg-deb','-x',str(deb),str(dest)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
 binary=str(private)
env=os.environ.copy()
env['LD_LIBRARY_PATH']=':'.join(str(p) for p in (root/'package/usr/lib').glob('*-linux-gnu'))
check=subprocess.run([binary,'-version'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
if check.returncode: raise RuntimeError('共享组件依赖不完整，请先安装系统提供的 x11vnc')
if not managed:
 if sock.exists():
  if not stat.S_ISSOCK(sock.lstat().st_mode) or sock.stat().st_uid!=os.getuid():raise RuntimeError('共享套接字冲突')
  sock.unlink()
 s=sessions[0]
 with open(root/'share.log','wb') as log:
  child=subprocess.Popen([binary,'-display',s['display'],'-auth',s['auth'],'-unixsock',str(sock),'-rfbport','0','-rfbportv6','0','-no6','-noipv6','-forever','-shared','-noxdamage','-nosel','-noprimary','-noclipboard','-nopw'],env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,umask=0o077)
 pidfile.write_text(json.dumps({'pid':child.pid}));os.chmod(pidfile,0o600)
 for i in range(50):
  if child.poll() is not None:raise RuntimeError('桌面共享启动失败，请确认图形会话仍在运行')
  if sock.exists():break
  time.sleep(.1)
 if not sock.exists():
  child.terminate();raise RuntimeError('桌面共享启动超时')
 time.sleep(.2)
 inodes=set()
 for fd in Path('/proc/'+str(child.pid)+'/fd').glob('*'):
  try:
   link=os.readlink(fd)
   if link.startswith('socket:['):inodes.add(link[8:-1])
  except OSError:pass
 for table in ['/proc/net/tcp','/proc/net/tcp6']:
  if not Path(table).exists():continue
  for line in Path(table).read_text().splitlines()[1:]:
   fields=line.split()
   if len(fields)>9 and fields[3]=='0A' and fields[9] in inodes:
    child.terminate();raise RuntimeError('组件意外开放网络端口，已停止共享')
print(json.dumps({'socket':str(sock),'running':True}))
`;


