"""Offline exact-build serializer audit. Never attaches to or calls WeChat."""
import argparse
import hashlib
import json
import pathlib
import sys


def extract(instructions, helpers):
    number = offset = None
    found = []
    for ins in instructions:
        # Match only the compiler's explicit object-relative loads and literal
        # field tags. Do not infer semantic field names from older clients.
        import re
        load = re.fullmatch(r'(?:rdx|edx), (?:qword|dword) ptr \[rdi \+ (0x[0-9a-f]+|[0-9]+)\]', ins.op_str)
        if ins.mnemonic == 'mov' and load:
            offset = int(load.group(1), 0)
        tag = re.fullmatch(r'ecx, (0x[0-9a-f]+|[0-9]+)', ins.op_str)
        if ins.mnemonic == 'mov' and tag:
            number = int(tag.group(1), 0)
        if ins.mnemonic in ('call', 'jmp') and ins.op_str in helpers:
            if number is None or offset is None:
                raise ValueError('Incomplete serializer field pattern')
            found.append({'number': number, 'kind': helpers[ins.op_str], 'objectOffset': hex(offset)})
            number = offset = None
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module', required=True, type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    parser.add_argument('--library-dir')
    args = parser.parse_args()
    if args.library_dir:
        sys.path.insert(0, args.library_dir)
    import pefile
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    expected = '0cf6379405432385a1c442766443450f26a7689f45e53c1b4ad2822061f3113b'
    with args.module.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != expected:
        raise SystemExit('UNSUPPORTED_VERSION: do not reuse this layout on a different build')
    helpers = {'0x1614570': 'bytes', '0x1614410': 'uint32', '0x1614730': 'nested-message'}
    with pefile.PE(str(args.module), fast_load=True) as pe:
        instructions = Cs(CS_ARCH_X86, CS_MODE_64).disasm(pe.get_data(0x3b621e0, 0x2f5), 0x3b621e0)
        fields = extract(instructions, helpers)
    offsets = [8,16,24,48,32,40,56,52,64,80,72,88,84,96,120,104,112]
    kinds = ['bytes','bytes','bytes','uint32','bytes','bytes','bytes','uint32','bytes','uint32',
             'nested-message','bytes','uint32','nested-message','uint32','bytes','bytes']
    expected_fields = [{'number': i+1, 'kind': kinds[i], 'objectOffset': hex(off)} for i,off in enumerate(offsets)]
    if fields != expected_fields:
        raise SystemExit('LAYOUT_MISMATCH: manual review required')
    report = {'moduleSha256': actual, 'executableProfile': False, 'mode': 'offline-static-audit',
              'parentField': 4, 'objectSize': '0x88', 'vtable': '0x96f22f8',
              'parser': '0x3b61720', 'serializer': '0x3b621e0', 'hasBitsOffset': '0x80',
              'fields': fields, 'semanticNamesVerified': False, 'nativeCalls': 0}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'verifiedFields': len(fields), 'nativeCalls': 0, 'output': str(args.output)}))


if __name__ == '__main__':
    main()
