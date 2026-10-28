"""Installer safety regression; never installs or executes a downloaded program."""
from pathlib import Path
import tempfile, tarfile, io, sys
source=Path('scripts/install-linux.sh').read_text(encoding='utf-8')
if Path('services/portal/install.sh').exists(): assert source == Path('services/portal/install.sh').read_text(encoding='utf-8')
code=source.split("<<'PY'\n",1)[1].rsplit('\nPY',1)[0]
ns={'__name__':'test'};exec(compile(code,'install.sh','exec'),ns)
with tempfile.TemporaryDirectory() as d:
 d=Path(d)
 for name,kind in [('../outside','file'),('/outside','file'),('link','link')]:
  with tarfile.open(d/'evil.tar.gz','w:gz') as t:
   m=tarfile.TarInfo(name)
   if kind=='link':m.type=tarfile.SYMTYPE;m.linkname='/etc'
   else:m.size=1
   t.addfile(m,io.BytesIO(b'x') if kind=='file' else None)
  try:ns['unpack'](d/'evil.tar.gz',d/'out');raise AssertionError('unsafe tar accepted')
  except ValueError:pass
 if len(sys.argv)>1:
  dest=d/'real';dest.mkdir();ns['unpack'](sys.argv[1],dest)
  assert all((dest/n).is_file() for n in ['cagent','node','agent.cjs'])
  print('PASS: supplied verified CAgent archive safely extracts with complete runtime')
a={'name':'CAgent-0.8.14-linux-x64.tar.gz','size':100,'digest':'sha256:'+'a'*64,'browser_download_url':'https://shell.canp.ai/downloads/opensource/v0.8.14/CAgent-0.8.14-linux-x64.tar.gz'}
r=[{'tag_name':'v0.8.14','assets':[a]}]
assert ns['select_asset'](r,'cagent','opensource','x64')[0]=='0.8.14'
for product,channel,arch in [('cagent','pro','x64'),('cagent','opensource','arm64'),('cshell','opensource','x64')]:
 try:ns['select_asset'](r,product,channel,arch);raise AssertionError('wrong channel/arch accepted')
 except ValueError:pass
for url in ['https://github.com/x','http://shell.canp.ai/downloads/opensource/x','https://shell.canp.ai/downloads/pro/x','https://shell.canp.ai/downloads/opensource/../x']:
 assert not ns['url_allowed'](url,'opensource')
a['digest']=''
try:ns['select_asset'](r,'cagent','opensource','x64');raise AssertionError('missing digest accepted')
except ValueError:pass
print('PASS: traversal, special files, channel/architecture/product isolation, origin and digest validation')
# Exercise the complete install path against bounded in-memory HTTP fixtures.
import contextlib
class Response(io.BytesIO): pass
with tempfile.TemporaryDirectory() as d:
 d=Path(d); archive=io.BytesIO()
 with tarfile.open(fileobj=archive,mode='w:gz') as t:
  for name in ['cagent','node','agent.cjs']:
   m=tarfile.TarInfo(name);m.size=4;m.mode=0o755;t.addfile(m,io.BytesIO(b'test'))
 blob=archive.getvalue(); import hashlib
 asset={**a,'digest':'sha256:'+hashlib.sha256(blob).hexdigest(),'size':len(blob)}
 class Opener:
  def open(self,url,timeout):
   import json
   return Response(json.dumps([{'tag_name':'v0.8.14','assets':[asset]}]).encode() if url.endswith('releases.json') else blob)
 old_system=ns['platform'].system;old_machine=ns['platform'].machine;old_builder=ns['urllib'].request.build_opener;old_argv=sys.argv
 try:
  ns['platform'].system=lambda:'Linux';ns['platform'].machine=lambda:'x86_64';ns['urllib'].request.build_opener=lambda *_:Opener()
  sys.argv=['install','cagent','--directory',str(d/'install')]
  good=asset['digest'];asset['digest']='sha256:'+'0'*64
  try:ns['main']();raise AssertionError('corrupt digest accepted')
  except ValueError as e:assert 'SHA256' in str(e)
  assert not (d/'install/cagent').exists()
  asset['digest']=good;ns['main']();launcher=(d/'install/cagent').read_bytes();mtime=(d/'install/cagent').stat().st_mtime_ns
  ns['main']();assert (d/'install/cagent').read_bytes()==launcher and (d/'install/cagent').stat().st_mtime_ns==mtime
  assert not (d/'install/.install-lock').exists()
  saved_data=(d/'install/.data-directory').read_text();assert saved_data in (d/'install/cagent').read_text()
  print('PASS: corrupt download refused before switching; successful staged install; repeat is idempotent; lock cleanup')
 finally:
  ns['platform'].system=old_system;ns['platform'].machine=old_machine;ns['urllib'].request.build_opener=old_builder;sys.argv=old_argv
