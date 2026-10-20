"""Observe one user-performed transfer receipt; no money operations are invoked."""
import argparse
import json
import time
from pathlib import Path
from cshell_wechat.windows import Memory
from cshell_wechat.runtime import Instrument, bounded, profile
from cshell_wechat.state import exclusive, state_dir


SOURCE = r'''
const base=Process.getModuleByName('Weixin.dll').base,site=base.add(0x5392cc0);
if(!config.guard.every((b,i)=>site.add(i).readU8()===b))throw Error('CODE_CHANGED');
const storage=Memory.alloc(128);storage.writeByteArray(new Uint8Array(128));
const cm=new CModule(config.code,{storage,rpm:Process.getModuleByName('kernel32.dll').getExportByName('ReadProcessMemory')});
let hook=null,stopped=false;
rpc.exports={status(){return {stage:storage.add(8).readInt(),active:storage.add(4).readInt()+storage.add(12).readInt()};},
result(){return {stage:storage.add(8).readInt(),modelTransferIdLength:storage.add(16).readInt(),
modelTransactionIdLength:storage.add(20).readInt(),
modelTimeField:storage.add(24).readInt()?storage.add(32).readU32():null,
transportCode:storage.add(36).readInt()?storage.add(44).readInt():null,
returnCode:storage.add(40).readInt()>0?storage.add(80).readUtf8String(storage.add(40).readInt()):null,
settlementConfirmed:false};},
stop(){storage.writeInt(0);const state=this.status();if(!state.active&&!stopped){if(hook)hook.detach();stopped=true;}return state;}};
hook=Interceptor.attach(site,{onEnter:cm.on_enter,onLeave:cm.on_leave});storage.writeInt(1);
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--seconds', type=int, choices=range(1, 301), default=180)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    stop = args.output.with_suffix('.stop')
    if stop.exists():
        raise RuntimeError('Use a fresh output path')
    memory = Memory(args.pid)
    try:
        with exclusive(state_dir() / 'operation.lock'):
            binding, path, base = memory.inspect()
            profile(binding)
            adapter = Instrument(memory, binding, path, base)
            config = dict(guard=adapter.guard(0x5392cc0), code=Path(__file__).with_suffix('.c').read_text())
            result = {'binding': binding, 'scope': 'passive native transfer result layout; no automatic receipt'}
            try:
                rpc = adapter.start('const config=' + json.dumps(config) + ';' + SOURCE)
                print('READY: passive transfer result observer; manual operation only', flush=True)
                end = time.monotonic() + args.seconds
                while time.monotonic() < end and not stop.exists():
                    if bounded(rpc.status)['stage'] == 2:
                        break
                    time.sleep(.25)
                result['observation'] = bounded(rpc.result)
            finally:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                while True:
                    result['cleanup'] = adapter.close()
                    args.output.write_text(json.dumps(result, indent=2), encoding='utf8')
                    if not result['cleanup'].get('retained'):
                        break
                    time.sleep(1)
            print(json.dumps(result), flush=True)
    finally:
        memory.close()


if __name__ == '__main__':
    main()
