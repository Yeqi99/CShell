import pathlib,sys,json,subprocess,time
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--library-dir');args=parser.parse_args()
root=pathlib.Path(args.output).resolve();root.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
if args.library_dir:sys.path.insert(0,args.library_dir)
import frida
from cshell_wechat.runtime import bounded,ROOT
p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],creationflags=0x08000000);session=script=None
try:
 session=bounded(lambda:frida.attach(p.pid))
 code=(ROOT/'native/send.c').read_text()
 a=code.index('static int sending_context_ready(void){');b=code.index('\n}',a)+2
 code=code[:a]+'extern void *fixture_slots[];\nstatic int sending_context_ready(void){return context_ready(fixture_slots,*tls_index);}' +code[b:]
 code=code.replace('gum_invocation_context_get_thread_id(ic)','1234')
 source='const code='+json.dumps(code)+r""";
const state=Memory.alloc(64),slots=Memory.alloc(512),slot=Memory.alloc(512),sp=Memory.alloc(16),cb=Memory.alloc(16),index=Memory.alloc(4),calls=Memory.alloc(4);
for(const [p,n] of [[state,64],[slots,512],[slot,512],[sp,16],[cb,16],[index,4],[calls,4]])p.writeByteArray(new Uint8Array(n));
const stub=new CModule('extern int calls[]; void get_coro(void *out){calls[0]++;} void noop(void){}', {calls});
const cm=new CModule(code,{state,fixture_slots:slots,tls_index:index,recipient:Memory.allocUtf8String('filehelper'),content:Memory.allocUtf8String('fixture'),get_coro:stub.get_coro,get_svc:stub.noop,get_ctx:stub.noop,make_text:stub.noop,do_send:stub.noop,chat_alloc:stub.noop});
const enter=new NativeFunction(cm.on_enter,'void',['pointer']);
rpc.exports={run(){
 const cases=[];
 function attempt(name,expected){state.writeByteArray(new Uint8Array(64));calls.writeU32(0);state.writeU32(1);enter(ptr(0));const r={name,calls:calls.readU32(),armed:state.readU32(),active:state.add(56).readU32(),skipped:state.add(40).readU32(),stage:state.add(8).readU32()};if(r.calls!==expected||r.active!==0)throw Error(JSON.stringify(r));cases.push(r);}
 attempt('absent slot',0);slots.writePointer(slot);attempt('absent shared pointer',0);slot.add(0x1f0).writePointer(sp);attempt('empty shared pointer',0);sp.writePointer(slot);attempt('absent control block',0);sp.add(8).writePointer(cb);attempt('expired control block',0);cb.add(8).writeS32(1);attempt('ready context invokes getter once',1);index.writeU32(64);attempt('unsupported TLS index',0);
 return cases;
}};
"""
 script=session.create_script(source);bounded(script.load);result=bounded(script.exports_sync.run);bounded(script.unload);script=None;bounded(session.detach);session=None
 (root/'send-context-test-result.json').write_text(json.dumps({'cases':result,'scope':'Actual native gating code with synthetic TLS provider and native getter stub; no WeChat calls'},indent=2));print(json.dumps(result))
finally:
 if script:
  try:bounded(script.unload)
  except Exception:pass
 if session:
  try:bounded(session.detach)
  except Exception:pass
 p.terminate();p.wait(timeout=5)
