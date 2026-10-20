"""Passive, bounded flow observation while user operates their test payment."""
import argparse
import json
import time
from pathlib import Path
from cshell_wechat.windows import Memory
from cshell_wechat.runtime import Instrument, bounded, profile
from cshell_wechat.state import exclusive, state_dir

SITES = {'red_packet_link': 0x787d90, 'accept_transfer': 0x5392cc0,
         'check_transfer': 0x539e590, 'web_transfer': 0x457f600,
         'red_detail_cache_a': 0x32688f0, 'red_detail_cache_b': 0x326a450,
         'red_detail_cache_c': 0x326abe0, 'red_open_button': 0x3f152d0}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--seconds', type=int, default=180, choices=range(1, 301))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    stop_file = args.output.with_suffix('.stop')
    if stop_file.exists():
        raise RuntimeError('Choose a fresh output path; stop marker already exists')
    memory = Memory(args.pid)
    try:
        with exclusive(state_dir() / 'operation.lock'):
            binding, path, base = memory.inspect()
            if profile(binding)['version'] != '4.1.15.50':
                raise RuntimeError('UNSUPPORTED_VERSION')
            instrument = Instrument(memory, binding, path, base)
            config = {'sites': SITES, 'guards': {k: instrument.guard(v) for k, v in SITES.items()},
                      'code': Path(__file__).with_suffix('.c').read_text()}
            source = 'const config=' + json.dumps(config) + ';' + r'''
const base=Process.getModuleByName('Weixin.dll').base;
for(const [name,rva] of Object.entries(config.sites)){
 const p=base.add(rva);if(!config.guards[name].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');
}
const storage=Memory.alloc(64+128*16);storage.writeByteArray(new Uint8Array(64+128*16));
const cm=new CModule(config.code,{storage});const hooks=[];let stopped=false;
rpc.exports={stop(){storage.writeInt(0);if(!stopped){for(const h of hooks)h.detach();stopped=true;}return {active:storage.add(4).readInt()};},result(){
 const count=storage.add(8).readInt();return {total:count,truncated:count>128,events:Array.from({length:Math.min(count,128)},(_,i)=>{
 const p=storage.add(64+i*16);return {kind:p.readU32(),callerRva:ptr(p.add(8).readU64().toString()).sub(base).toString()};})};}};
for(const [name,rva] of Object.entries(config.sites))hooks.push(Interceptor.attach(base.add(rva),{onEnter:cm[name]}));
storage.writeInt(1);
'''
            result = {'binding': binding, 'scope': 'user-performed payment flow; callsite metadata only'}
            try:
                rpc = instrument.start(source)
                print('READY: passive payment flow; no automatic receipt', flush=True)
                deadline = time.monotonic() + args.seconds
                while time.monotonic() < deadline and not stop_file.exists():
                    time.sleep(.25)
                drain = time.monotonic() + 5
                while bounded(rpc.stop).get('active'):
                    if time.monotonic() > drain:
                        raise RuntimeError('CALLBACK_ACTIVE')
                    time.sleep(.05)
                result['observation'] = bounded(rpc.result)
            finally:
                result['cleanup'] = instrument.close()
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(result, indent=2), encoding='utf8')
                while result['cleanup'].get('retained'):
                    time.sleep(1)
                    result['cleanup'] = instrument.close()
                    args.output.write_text(json.dumps(result, indent=2), encoding='utf8')
            print(json.dumps(result), flush=True)
    finally:
        memory.close()

if __name__ == '__main__':
    main()
