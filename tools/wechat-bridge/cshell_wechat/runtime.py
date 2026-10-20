import json
import pathlib
import threading
import time
from .contracts import require, normalize, EventWindow, BridgeError
from .protocol import decode

ROOT = pathlib.Path(__file__).parent
SEND_RVAS = {'get_coro':0x47220,'get_svc':0x381870,'get_ctx':0x707420,
             'make_text':0x707300,'do_send':0x17b3d70,'chat_alloc':0x7524b2c}

def profile(binding):
    for path in (ROOT/'profiles').glob('*.json'):
        result = json.loads(path.read_text(encoding='utf8'))
        if result['moduleSha256'] == binding['moduleSha256']:
            return result
    raise BridgeError('UNSUPPORTED_VERSION', 'No validated adapter for the loaded module hash')

def bounded(fn):
    import frida
    cancel = frida.Cancellable(); timer = threading.Timer(5, cancel.cancel); timer.start()
    try:
        with cancel:
            return fn()
    finally:
        timer.cancel()

class Instrument:
    # Keep uncertain sessions alive rather than releasing native code underneath
    # a callback. This is a diagnostic containment measure, not safe hot-unload.
    retained = []
    def __init__(self, memory, binding, path, base):
        self.memory, self.binding, self.path, self.base = memory, binding, path, base
        self.session = self.script = None
        self.guards = {}
        self.stopped_state = None

    def guard(self, rva):
        import pefile
        with pefile.PE(self.path, fast_load=True) as pe:
            expected = pe.get_data(rva, 16)
        require(self.memory.read(self.base+rva,16) == expected, 'CODE_CHANGED', 'Another hook or code change exists at the adapter site')
        self.guards[rva] = expected
        return list(expected)

    def start(self, source):
        import frida
        errors=[]
        self.session=bounded(lambda:frida.attach(self.binding['pid']))
        self.script=self.session.create_script(source)
        self.script.on('message',lambda m,d:errors.append(m) if m.get('type')=='error' else None)
        bounded(self.script.load)
        require(not errors,'SCRIPT_ERROR', str(errors[0]) if errors else '')
        return self.script.exports_sync

    def close(self):
        failures=[]
        if self.script:
            try:
                deadline=time.monotonic()+5
                while True:
                    state=bounded(self.script.exports_sync.stop)
                    self.stopped_state=state
                    if not isinstance(state,dict) or not state.get('active',0):break
                    if time.monotonic()>=deadline:
                        raise BridgeError('CALLBACK_ACTIVE','Native callback did not drain; session retained')
                    time.sleep(.05)
            except Exception as error:
                failures.append(str(error))
                if self not in self.retained:self.retained.append(self)
                return {'codeRestored':False,'unloaded':False,'retained':True,'errors':failures}
            try: bounded(self.script.unload)
            except Exception as error:
                failures.append(str(error))
                if self not in self.retained:self.retained.append(self)
                return {'codeRestored':False,'unloaded':False,'retained':True,'errors':failures}
        if self.session:
            try: bounded(self.session.detach)
            except Exception as error: failures.append(str(error))
        restored=all(self.memory.read(self.base+rva,16)==expected for rva,expected in self.guards.items())
        if self in self.retained:self.retained.remove(self)
        return {'codeRestored':restored,'unloaded':True,'retained':False,'errors':failures}

def send(memory,binding,path,base,recipient,text,check,attachment=None):
    adapter=Instrument(memory,binding,path,base); result={'status':'unknown','deliveryConfirmed':False}
    try:
        offsets=dict(SEND_RVAS)
        if attachment is not None:offsets['make_text']=0x2c18c40
        guards={key:adapter.guard(rva) for key,rva in offsets.items()}
        # Pin the TLS layout to the faulting getter's actual code bytes.
        context_guard=adapter.guard(0x4a09e0)
        tls_bytes=memory.read(base+0xbb63820,4)
        require(len(tls_bytes)==4 and int.from_bytes(tls_bytes,'little')<64,
                'CONTEXT_LAYOUT', 'Unsupported static TLS index')
        source='const config='+json.dumps({'offsets':offsets,'guards':guards,'contextGuard':context_guard,'recipient':recipient,'text':text,'attachment':attachment,'code':(ROOT/'native/send.c').read_text()})+';'+'''
const base=Process.getModuleByName('Weixin.dll').base,symbols={};
for(const [name,rva] of Object.entries(config.offsets)){
 const p=base.add(rva);
 if(!config.guards[name].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');
 symbols[name]=p;
}
const contextGetter=base.add(0x4a09e0);
if(!config.contextGuard.every((b,i)=>contextGetter.add(i).readU8()===b))throw Error('CONTEXT_CODE_CHANGED');
symbols.tls_index=base.add(0xbb63820);
if(symbols.tls_index.readU32()>=64)throw Error('CONTEXT_LAYOUT');
const state=Memory.alloc(64);state.writeByteArray(new Uint8Array(64));
const recipient=Memory.allocUtf8String(config.recipient),content=Memory.allocUtf8String(config.text);
symbols.state=state;symbols.recipient=recipient;symbols.content=content;
symbols.attachment_path=Memory.allocUtf16String(config.attachment?.path||'');
symbols.attachment_size=Memory.alloc(8);symbols.attachment_size.writeU64(config.attachment?.size||0);
symbols.attachment_mode=Memory.alloc(4);symbols.attachment_mode.writeInt(config.attachment?1:0);
const cm=new CModule(config.code,symbols);
const hook=Interceptor.attach(symbols.get_coro,{onEnter:cm.on_enter});
rpc.exports={arm(){state.writeU32(1)},status(){return Array.from({length:8},(_,i)=>state.add(i*8).readU64().toNumber())},stop(){state.writeU32(0);hook.detach();return {active:state.add(56).readU32(),nativeState:this.status()};}};
'''
        check(); rpc=adapter.start(source);check();bounded(rpc.arm)
        for _ in range(60):
            time.sleep(.5);check();state=bounded(rpc.status);result['nativeState']=state
            if state[1]==2:
                result['status']='native_returned' if state[4]==1 else 'not_submitted'
                break
        # Unknown outcomes are never retried automatically.
    except Exception as error:
        result['error']=str(error)
    finally:
        result['cleanup']=adapter.close()
        stopped=adapter.stopped_state
        if result['cleanup']['unloaded'] and isinstance(stopped,dict):
            final=stopped.get('nativeState')
            if isinstance(final,list) and len(final)==8 and not stopped.get('active'):
                result['nativeState']=final
                if final[1]==0:
                    result['status']='not_submitted'
                    result['reason']='No eligible sending context observed'
                elif final[1]==2:
                    result['status']='native_returned' if final[4]==1 else 'not_submitted'
    return result

def receive(memory,binding,path,base,allowed,seconds,check):
    adapter=Instrument(memory,binding,path,base);window=EventWindow();result={}
    try:
        config={'rva':0x17c8eb0,'guard':adapter.guard(0x17c8eb0),'allowed':allowed,'nativeCode':(ROOT/'native/receive.c').read_text()}
        check();rpc=adapter.start('const config='+json.dumps(config)+';'+(ROOT/'native/receive-native.js').read_text())
        deadline=time.monotonic()+seconds
        while time.monotonic()<deadline:
            time.sleep(.25);check();batch=bounded(rpc.drain)
            for event in batch['events']:window.push(decode({'message':event}))
            result['nativeCounts']={k:v for k,v in batch.items() if k!='events'}
        check()
        final_batch=bounded(rpc.drain)
        for event in final_batch['events']:window.push(decode({'message':event}))
        result['nativeCounts']={k:v for k,v in final_batch.items() if k!='events'}
        result.update(window.result())
        result['gap']=result['gap'] or result.get('nativeCounts',{}).get('dropped',0)>0
    finally:
        result['cleanup']=adapter.close()
    return result
