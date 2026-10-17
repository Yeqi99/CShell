# Dependencies

Dependencies are shipped as unmodified PyPI wheels; each retains its own distribution metadata and license files. No Weixin binary or third-party Hook DLL is distributed.

| Dependency | Version | Upstream source |
|---|---|---|
| Frida | 17.24.0 | https://github.com/frida/frida (LGPL-2.1); https://github.com/frida/frida-python |
| pefile | 2024.8.26 | https://github.com/erocarrera/pefile (MIT) |
| python-zstandard | 0.23.0 | https://github.com/indygreg/python-zstandard (BSD); bundled Zstandard retains its license |
| Capstone | 5.0.9 | https://github.com/capstone-engine/capstone (BSD) |

Frida is dynamically loaded through its Python distribution. Its upstream source, build instructions and license are available at the linked repository. Users may replace or rebuild these dependencies; doing so invalidates this package's runtime validation and requires fresh testing. The package hash manifest verifies the delivered files; it is not a publisher signature or a guarantee of client compatibility.
