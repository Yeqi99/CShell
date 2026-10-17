"""Read-only process metadata and bounded loaded-contact candidates."""
import ctypes
import hashlib
import pathlib
import re
import struct
import time
from .contracts import require

class Memory:
    def __init__(self, pid):
        require(__import__('sys').platform == 'win32', 'UNSUPPORTED_PLATFORM', 'Windows x64 is required')
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.p = ctypes.WinDLL('psapi', use_last_error=True)
        self.k.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        self.k.OpenProcess.restype = ctypes.c_void_p
        self.k.CloseHandle.argtypes = [ctypes.c_void_p]
        self.k.ReadProcessMemory.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
        self.k.GetProcessTimes.argtypes = [ctypes.c_void_p] + [ctypes.c_void_p] * 4
        self.p.EnumProcessModulesEx.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong]
        self.p.GetModuleFileNameExW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_ulong]
        self.handle = self.k.OpenProcess(0x410, False, pid)
        require(bool(self.handle), 'PROCESS_ACCESS', 'Cannot read the selected process')
        self.pid = pid

    def close(self):
        if self.handle:
            self.k.CloseHandle(self.handle); self.handle = None

    def read(self, address, size):
        require(0 <= size <= 2 * 1024 * 1024, 'READ_BOUND', 'Read exceeds limit')
        b = ctypes.create_string_buffer(size); n = ctypes.c_size_t()
        if not self.k.ReadProcessMemory(self.handle, address, b, size, ctypes.byref(n)):
            return b''
        return b.raw[:n.value]

    def inspect(self):
        times = [ctypes.c_ulonglong() for _ in range(4)]
        require(self.k.GetProcessTimes(self.handle, *[ctypes.byref(x) for x in times]), 'PROCESS_ACCESS', 'Cannot identify process creation time')
        modules = (ctypes.c_void_p * 2048)(); needed = ctypes.c_ulong()
        require(self.p.EnumProcessModulesEx(self.handle, modules, ctypes.sizeof(modules), ctypes.byref(needed), 3), 'PROCESS_ACCESS', 'Cannot enumerate modules')
        for module in modules[:min(needed.value // ctypes.sizeof(ctypes.c_void_p), 2048)]:
            path = ctypes.create_unicode_buffer(32768)
            if self.p.GetModuleFileNameExW(self.handle, module, path, len(path)) and pathlib.Path(path.value).name.lower() == 'weixin.dll':
                with open(path.value, 'rb') as binary:
                    digest = hashlib.file_digest(binary, 'sha256').hexdigest()
                return {'pid': self.pid, 'created': str(times[0].value), 'moduleSha256': digest}, path.value, module
        require(False, 'MODULE_NOT_FOUND', 'Selected process does not contain Weixin.dll')

    def string(self, address, allow_empty=False):
        b = self.read(address, 32)
        if len(b) != 32:
            return None
        n, cap = struct.unpack_from('<QQ', b, 16)
        if n == 0 and cap == 15:
            return '' if allow_empty else None
        if not 0 < n <= 256 or not n <= cap <= 4096:
            return None
        data = b[:n] if cap < 16 else self.read(struct.unpack_from('<Q', b)[0], n)
        try:
            value = data.decode('utf8')
            return value if len(data) == n and all(ord(c) >= 32 for c in value) else None
        except UnicodeError:
            return None

    def cached_contacts(self, check, budget_mb=256, seconds=30):
        class MBI(ctypes.Structure):
            _fields_ = [('base', ctypes.c_void_p), ('alloc', ctypes.c_void_p), ('ap', ctypes.c_ulong), ('partition', ctypes.c_ushort), ('size', ctypes.c_size_t), ('state', ctypes.c_ulong), ('protect', ctypes.c_ulong), ('type', ctypes.c_ulong)]
        self.k.VirtualQueryEx.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(MBI), ctypes.c_size_t]
        self.k.VirtualQueryEx.restype = ctypes.c_size_t
        started = time.monotonic(); chunks = []; buffers = {}; scanned = 0; address = 0
        while scanned < budget_mb * 1024 * 1024 and time.monotonic() - started < seconds / 2:
            check(); m = MBI()
            if not self.k.VirtualQueryEx(self.handle, address, ctypes.byref(m), ctypes.sizeof(m)):
                break
            base = m.base or 0; address = base + m.size
            if not m.size or address <= base:
                break
            if m.state != 0x1000 or m.type != 0x20000 or m.protect & 0x100 or m.protect & 255 not in (4, 8, 64, 128):
                continue
            for pos in range(base, address, 1024 * 1024):
                if scanned >= budget_mb * 1024 * 1024 or time.monotonic() - started >= seconds / 2:
                    break
                b = self.read(pos, min(1024 * 1024, address - pos)); chunks.append((pos, b)); scanned += len(b)
                for match in re.finditer(rb'(?:wxid_[A-Za-z0-9_]{3,64}|[0-9]{5,32}@chatroom)\x00', b):
                    buffers[pos + match.start()] = match.group()[:-1].decode()
        records = {}
        for pos, b in chunks:
            check()
            if time.monotonic() - started >= seconds:
                break
            for offset, (pointer,) in enumerate(struct.iter_unpack('<Q', b[:len(b)//8*8])):
                if pointer not in buffers:
                    continue
                a = pos + offset * 8; wxid = self.string(a)
                if wxid != buffers[pointer]:
                    continue
                alias, remark, name = self.string(a+32, True), self.string(a+112, True), self.string(a+208, True)
                if alias is None or remark is None or name is None:
                    continue
                key = (wxid, alias, remark, name)
                if key not in records:
                    records[key] = {'id': wxid, 'alias': alias, 'remark': remark, 'name': name, 'kind': 'group' if wxid.endswith('@chatroom') else 'contact', 'copies': 0, 'source': 'loaded-memory-candidate'}
                records[key]['copies'] += 1
                require(len(records) <= 10000, 'CONTACT_LIMIT', 'Loaded-contact candidate limit reached')
        check()
        return {'items': list(records.values()), 'complete': False, 'scope': 'loaded-memory-candidates',
                'scannedBytes': scanned, 'seconds': round(time.monotonic()-started, 3),
                'limitations': ['Not the complete address book', 'Fields are structural candidates', 'May contain stale or conflicting copies; not sufficient for sending authorization']}
