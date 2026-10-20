"""Exact-build, synthetic XML model roundtrip. No network/payment entry is used.

This development check calls only allocation, XML parsing, field getters and
destruction. It is not a receipt tool and accepts no payment tickets as input.
"""
import argparse
import json
import time
from pathlib import Path
from cshell_wechat.windows import Memory
from cshell_wechat.runtime import Instrument, bounded, profile
from cshell_wechat.state import exclusive, state_dir

OFFSETS = {'allocate': 0x7524b2c, 'docInit': 0x66a980,
           'docDestroy': 0x66a9f0, 'parse': 0xfbedb0, 'child': 0x665f40,
           'readModel': 0x22ff700, 'transfer': 0x2300ca0,
           'transaction': 0x14bd0e0, 'invalidTime': 0x1e72380}
CAPACITIES = [0x28, 0x48, 0x68, 0x88, 0xa8, 0xc8, 0xe8, 0x108,
              0x128, 0x148, 0x188, 0x1a8, 0x1d0, 0x1f8, 0x218,
              0x238, 0x260, 0x280, 0x2a0, 0x2c0, 0x2e0, 0x300,
              0x320, 0x340, 0x360, 0x380, 0x3a0, 0x3c0, 0x3e0, 0x400]

SOURCE = r'''
const base=Process.getModuleByName('Weixin.dll').base;
for(const [name,rva] of Object.entries(config.offsets)) {
  const p=base.add(rva);
  if(!config.guards[name].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');
}
const fn=(name,ret,args)=>new NativeFunction(base.add(config.offsets[name]),ret,args);
const alloc=fn('allocate','pointer',['uint64']);
const init=fn('docInit','void',['pointer']), destroy=fn('docDestroy','void',['pointer']);
const parse=fn('parse','bool',['pointer','pointer']);
const child=fn('child','pointer',['pointer','pointer','pointer']);
const read=fn('readModel','void',['pointer','pointer']);
const transfer=fn('transfer','pointer',['pointer']), transaction=fn('transaction','pointer',['pointer']);
const invalidTime=fn('invalidTime','uint32',['pointer']);
let active=0,ran=false;
rpc.exports={stop(){return {active};},run(){
  if(ran)throw Error('ALREADY_RUN');ran=true;active=1;
  const doc=Memory.alloc(0x200),node=Memory.alloc(8),input=Memory.alloc(32);
  const xml='<wcpayinfo><paysubtype>1</paysubtype><feedesc>￥0.10</feedesc><transferid>synthetic-transfer-not-valid</transferid><transcationid>synthetic-transaction-not-valid</transcationid><invalidtime>123456</invalidtime></wcpayinfo>';
  const bytes=Memory.allocUtf8String(xml),length=unescape(encodeURIComponent(xml)).length;
  input.writeByteArray(new Uint8Array(32));input.writePointer(bytes);
  input.add(16).writeU64(length);input.add(24).writeU64(length);
  let block=null,initialized=false;
  const out={scope:'synthetic_model_only',paymentSubmitted:false};
  const string=p=>{const n=p.add(16).readU64().toNumber();if(n>512)throw Error('INVALID_LENGTH');return (p.add(24).readU64().toNumber()<16?p:p.readPointer()).readUtf8String(n);};
  try {
    doc.writeByteArray(new Uint8Array(0x200));init(doc);initialized=true;
    if(!parse(input,doc))throw Error('XML_PARSE_FAILED');
    child(doc,node,Memory.allocUtf8String('wcpayinfo'));
    if(node.readPointer().isNull())throw Error('NODE_MISSING');
    block=alloc(0x418);if(block.isNull())throw Error('ALLOCATION_FAILED');
    block.writeByteArray(new Uint8Array(0x418));block.writePointer(base.add(0x90834f8));
    block.add(8).writeU32(1);block.add(12).writeU32(1);
    for(const offset of config.capacities)block.add(offset).writeU64(15);
    const model=block.add(16);read(model,node);
    out.transferMatches=string(transfer(model))==='synthetic-transfer-not-valid';
    out.transactionMatches=string(transaction(model))==='synthetic-transaction-not-valid';
    out.invalidTime=invalidTime(model);
  } finally {
    if(block!==null&&!block.isNull()){
      const v=block.readPointer();
      new NativeFunction(v.readPointer(),'void',['pointer'])(block);
      new NativeFunction(v.add(8).readPointer(),'void',['pointer'])(block);
      out.modelDestroyed=true;
    }
    if(initialized){destroy(doc);out.documentDestroyed=true;}
    active=0;
  }
  return out;
}};
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    memory = Memory(args.pid)
    try:
        with exclusive(state_dir() / 'operation.lock'):
            binding, path, base = memory.inspect()
            profile(binding)
            adapter = Instrument(memory, binding, path, base)
            config = dict(offsets=OFFSETS, capacities=CAPACITIES,
                          guards={key: adapter.guard(value) for key, value in OFFSETS.items()})
            result = {'binding': binding}
            try:
                rpc = adapter.start('const config=' + json.dumps(config) + ';' + SOURCE)
                result['result'] = bounded(rpc.run)
            finally:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                while True:
                    result['cleanup'] = adapter.close()
                    args.output.write_text(json.dumps(result, indent=2), encoding='utf8')
                    if not result['cleanup'].get('retained'):
                        break
                    time.sleep(1)
            print(json.dumps(result))
    finally:
        memory.close()


if __name__ == '__main__':
    main()
