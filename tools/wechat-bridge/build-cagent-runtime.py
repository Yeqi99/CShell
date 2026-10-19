"""Build a private-data-free Windows runtime from a pinned build environment."""
import hashlib, importlib.metadata, json, pathlib, shutil, sys, zipfile

assert sys.platform == 'win32' and sys.version_info[:2] == (3, 12)
out = pathlib.Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
for cache in out.rglob('*.pyc'):
    cache.resolve().relative_to(out)
    cache.unlink()
base = pathlib.Path(sys.base_prefix)
source = pathlib.Path(__file__).parent
for name in ('python.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt'):
    shutil.copy2(base/name,out/name)
shutil.copytree(base/'DLLs',out/'DLLs',dirs_exist_ok=True)
with zipfile.ZipFile(out/'python312.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for file in (base/'Lib').rglob('*.py'):
        rel=file.relative_to(base/'Lib')
        if any(part in ('site-packages','__pycache__','test','tests','idlelib','tkinter','turtledemo','ensurepip') for part in rel.parts): continue
        archive.write(file,rel.as_posix())
for name,version in [('frida','17.24.0'),('pefile','2024.8.26'),('zstandard','0.23.0')]:
    dist=importlib.metadata.distribution(name)
    assert dist.version==version,(name,dist.version)
    for entry in dist.files:
        if '..' in entry.parts or '__pycache__' in entry.parts or entry.suffix=='.pyc': continue
        target=out/str(entry);target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(dist.locate_file(entry),target)
shutil.copytree(source/'cshell_wechat',out/'cshell_wechat',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
shutil.copy2(source/'THIRD_PARTY_NOTICES.md',out/'THIRD_PARTY_NOTICES.md')
(out/'python312._pth').write_text('python312.zip\nDLLs\n.\n',encoding='utf8')
files={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file() and p.name!='files.json'}
(out/'files.json').write_text(json.dumps(files),encoding='utf8')
print(json.dumps({'files':len(files),'bytes':sum(p.stat().st_size for p in out.rglob('*') if p.is_file()),'runtime':str(out)}))
