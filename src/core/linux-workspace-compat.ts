import { quote } from './remote-jobs';
import { linuxWorkspaceMethods } from '../shared/linux-workspace';

/** A client-versioned transport, not a second Agent runtime. It uses only the
 * authenticated SSH user's existing local control endpoint. No files, identity,
 * permissions, listener, installed runtime or active task are changed. */
export const linuxCompatibilityBridgeSource = String.raw`
const {readFile}=require('node:fs/promises');
const {join}=require('node:path');
const {request}=require('node:http');
const methods=new Set(${JSON.stringify([...linuxWorkspaceMethods])});
const directory=process.argv[1];
let buffer='',pending=0,closing=false;
const requests=new Set();
function write(value){if(closing)return;const line=JSON.stringify(value);if(Buffer.byteLength(line)>2097152){write({id:value.id,error:'CAgent 响应过大'});return;}process.stdout.write(line+'\n');}
async function invoke(call){
 const raw=await readFile(join(directory,'discovery.json'),'utf8');if(Buffer.byteLength(raw)>16384)throw Error('CAgent 本机控制信息无效');const discovery=JSON.parse(raw);
 if(discovery.version!==1||!Number.isInteger(discovery.port)||discovery.port<1||discovery.port>65535||!/^[a-f0-9]{64}$/.test(discovery.token)||!Number.isInteger(discovery.pid)||discovery.pid<1)throw Error('CAgent 本机控制信息无效');
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(call);
  const req=request({hostname:'127.0.0.1',port:discovery.port,path:'/control',method:'POST',headers:{Authorization:'Bearer '+discovery.token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{
   let output='';response.setEncoding('utf8');
   response.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>2097152)req.destroy(Error('CAgent 响应过大'));});
   response.on('error',reject);
   response.on('end',()=>{try{const value=JSON.parse(output);if(response.statusCode!==200||value.error)throw Error(value.error||'CAgent 请求失败');resolve(value.result);}catch(error){reject(error);}});
  });
  requests.add(req);req.once('close',()=>requests.delete(req));
  req.setTimeout(55000,()=>req.destroy(Error('CAgent 操作超时；未重放')));req.on('error',reject);req.end(body);
 });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 buffer+=chunk;if(Buffer.byteLength(buffer)>1048576){closing=true;process.stdin.destroy();for(const req of requests)req.destroy();process.exitCode=1;return;}
 let end;while((end=buffer.indexOf('\n'))>=0){
  const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let id='';
  try{
   const raw=JSON.parse(line);id=typeof raw.id==='string'?raw.id:'';
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||!raw.call||typeof raw.call!=='object'||Object.keys(raw.call).some(key=>!['method','params'].includes(key))||!methods.has(raw.call.method))throw Error('此操作未在 SSH 工作区开放');
   if(pending>=8)throw Error('CAgent 通道忙，请稍后重试');pending++;
   invoke(raw.call).then(result=>write({id,result}),error=>write({id,error:String(error.message).slice(0,500)})).finally(()=>pending--);
  }catch(error){write({id,error:String(error.message).slice(0,500)});}
 }
});
process.stdin.on('end',()=>{closing=true;for(const req of requests)req.destroy();});
`;

export const linuxCompatibilityBridgeCommand = `set -eu
base="$HOME/.local/share/cagent/cshell"
if test -x "$base/current/runtime/bin/node" && test -d "$base/data"; then
  exec "$base/current/runtime/bin/node" -e ${quote(linuxCompatibilityBridgeSource)} "$base/data"
elif test -x "$base/current/node" && test -d "$base/data"; then
  exec "$base/current/node" -e ${quote(linuxCompatibilityBridgeSource)} "$base/data"
else
  exec "$base/current/cagent" bridge
fi`;
