import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parent
manifest=json.loads((root/'SHA256SUMS.json').read_text(encoding='utf8'))
for name,expected in manifest.items():
 path=(root/name).resolve()
 if not path.is_relative_to(root):raise SystemExit('Unsafe manifest path')
 if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise SystemExit('Checksum mismatch: '+name)
actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name!='SHA256SUMS.json'}
if actual!=set(manifest):raise SystemExit('Unexpected or missing package files')
print('Package verified:',len(manifest),'files')
