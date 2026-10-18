"""Assemble an offline Windows x64 research package; never includes private evidence."""
import hashlib,json,pathlib,shutil,sys,zipfile
root=pathlib.Path(__file__).resolve().parent
out=pathlib.Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
stage=out/'cshell-wechat-bridge-0.1.4'
if stage.exists():raise SystemExit('Use a fresh output directory')
stage.mkdir()
for name in ('README.md','install.ps1','verify-package.py','THIRD_PARTY_NOTICES.md'):
 shutil.copy2(root/name,stage/name)
shutil.copy2(root.parents[1]/'docs/WECHAT-ADAPTER.md',stage/'UPGRADE.md')
shutil.copy2(root.parents[1]/'LICENSE',stage/'LICENSE')
shutil.copytree(out/'wheels',stage/'wheels')
shutil.copytree(root/'maintenance',stage/'maintenance',ignore=shutil.ignore_patterns('__pycache__'))
manifest={p.relative_to(stage).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.rglob('*')) if p.is_file()}
(stage/'SHA256SUMS.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
archive=out/'cshell-wechat-bridge-0.1.4-win-x64-research.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(stage.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(stage))
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(out/'package-result.json').write_text(json.dumps({'path':str(archive),'sha256':digest,'published':False,'liveEnabled':False},indent=2))
print(json.dumps({'path':str(archive),'sha256':digest}))
