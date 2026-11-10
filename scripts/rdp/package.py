"""Build a private Windows x64 CPython RDP helper, including dynamically loaded codecs."""
import platform
import shutil
import struct
import subprocess
import sys
from pathlib import Path

if sys.platform != 'win32' or platform.machine().upper() not in ('AMD64', 'X86_64') or struct.calcsize('P') != 8 or sys.version_info[:2] != (3, 12):
    raise SystemExit('Use Windows x64 CPython 3.12 to package RDP')
out = Path(sys.argv[1]).resolve()
root = Path(sys.base_prefix)
out.mkdir(parents=True, exist_ok=True)
for name in ('python.exe', 'python312.dll', 'python3.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt'):
    shutil.copy2(root / name, out / name)
shutil.copytree(root / 'DLLs', out / 'DLLs', dirs_exist_ok=True)
shutil.copytree(root / 'Lib', out / 'Lib', dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('site-packages', '__pycache__', 'idlelib', 'test', 'tkinter', 'ensurepip'))
vendor = out / 'vendor'
subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-compile', '--target', str(vendor),
                '-r', str(Path(__file__).with_name('requirements.txt'))], check=True)
(out / 'python312._pth').write_text('Lib\nDLLs\nvendor\n', encoding='ascii')
shutil.copy2(Path(__file__).with_name('session.py'), out / 'session.py')
subprocess.run([str(out / 'python.exe'), '-c',
                'import ssl; ssl.create_default_context(); from aardwolf.commons.factory import RDPConnectionFactory'],
               cwd=out, check=True)
