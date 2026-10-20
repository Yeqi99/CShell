"""Synthetic native callback ownership check. Never submits a payment.

Only context copy/move/destruction and a locally fabricated result are invoked.
No transfer tickets, account arguments or network entry points are accepted.
"""
import argparse
import json
import time
from pathlib import Path
from cshell_wechat.windows import Memory
from cshell_wechat.runtime import Instrument, bounded, profile
from cshell_wechat.state import exclusive, state_dir

OFFSETS = {'copy': 0x5f2b0, 'move': 0x1d2c00, 'destroyPayload': 0x539e290}
SOURCE = r'''
const base=Process.getModuleByName('Weixin.dll').base;
for(const [name,rva] of Object.entries(config.offsets)){
 const p=base.add(rva);
 if(!config.guards[name].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');
}
const state=Memory.alloc(24),return_code=Memory.alloc(16),cancelled=Memory.alloc(1);
state.writeByteArray(new Uint8Array(24));return_code.writeByteArray(new Uint8Array(16));cancelled.writeU8(0);
const methods=Memory.alloc(48);methods.writeByteArray(new Uint8Array(48));
const cm=new CModule(config.code,{state,return_code,methods,
 rpm:Process.getModuleByName('kernel32.dll').getExportByName('ReadProcessMemory')});
const init=new NativeFunction(cm.init_context,'void',['pointer','pointer']);
const invoke=new NativeFunction(cm.test_invoke,'void',['pointer','pointer']);
const fn=(name)=>new NativeFunction(base.add(config.offsets[name]),'void',['pointer','pointer']);
const copy=fn('copy'),move=fn('move');
const destroy=new NativeFunction(base.add(config.offsets.destroyPayload),'void',['pointer']);
let active=0,ran=false;
const counts=()=>Array.from({length:6},(_,i)=>state.add(i*4).readInt());
rpc.exports={
 stop(){return {active:active+state.readInt()+state.add(4).readInt()};},
 run(){
  if(ran)throw Error('ALREADY_RUN');ran=true;active=1;
  const payloads=[];
  const make=()=>{const p=Memory.alloc(0x120);p.writeByteArray(new Uint8Array(0x120));
   p.add(0x28).writeU64(15);payloads.push(p);return p.add(0x38);};
  const out={scope:'synthetic_callback_only',paymentSubmitted:false};
  try{
   const a=make(),b=make(),c=make();init(a,cancelled);
   out.afterInit=counts();copy(b,a);out.afterCopy=counts();
   move(c,b);out.afterMove=counts();
   const result=Memory.alloc(0x80),shared=Memory.alloc(16);
   result.writeByteArray(new Uint8Array(0x80));shared.writeByteArray(new Uint8Array(16));
   shared.writePointer(result);result.add(0x28).writeInt(17);
   result.add(0x50).writeUtf8String('-7');result.add(0x60).writeU64(2);result.add(0x68).writeU64(15);
   invoke(c,shared);out.callback=counts();out.returnCode=return_code.readUtf8String();
  }finally{
   for(const p of payloads.reverse())destroy(p);
   active=0;out.afterDestroy=counts();
  }
  return out;
 }
};
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    memory = Memory(args.pid)
    try:
        with exclusive(state_dir() / 'operation.lock'):
            binding, path, base = memory.inspect()
            profile(binding)
            adapter = Instrument(memory, binding, path, base)
            config = {'offsets': OFFSETS,
                      'guards': {k: adapter.guard(v) for k, v in OFFSETS.items()},
                      'code': (Path(__file__).parents[1] / 'cshell_wechat/native/transfer-context.c').read_text()}
            result = {'binding': binding}
            try:
                rpc = adapter.start('const config=' + json.dumps(config) + ';' + SOURCE)
                result['result'] = bounded(rpc.run)
                observed = result['result']
                if not (observed['afterInit'] == [0, 1, 0, 0, 0, 0]
                        and observed['afterCopy'] == [0, 2, 0, 0, 0, 0]
                        and observed['afterMove'] == [0, 2, 0, 0, 0, 0]
                        and observed['callback'] == [0, 2, 1, 1, 17, 2]
                        and observed['returnCode'] == '-7'
                        and observed['afterDestroy'] == [0, 0, 1, 1, 17, 2]):
                    raise RuntimeError('Synthetic callback ownership/result mismatch')
            finally:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                while True:
                    result['cleanup'] = adapter.close()
                    args.output.write_text(json.dumps(result, indent=2), encoding='utf8')
                    if not result['cleanup'].get('retained'):
                        break
                    time.sleep(1)
            if (not result['cleanup'].get('codeRestored')
                    or not result['cleanup'].get('unloaded')
                    or result['cleanup'].get('errors')):
                raise RuntimeError('Synthetic callback cleanup failed')
            print(json.dumps(result))
    finally:
        memory.close()


if __name__ == '__main__':
    main()
