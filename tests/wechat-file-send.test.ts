import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WechatService} from '../src/core/wechat';
import {emptyWechatConfig,wechatConfigSchema} from '../src/shared/wechat';

test('file sending requires its grant, recipient permission and compatible runtime',async()=>{
  if(process.platform!=='win32')return;
  const directory=await mkdtemp(join(tmpdir(),'wechat-files-'));
  const service=new WechatService(directory,{plugins:()=>[]},{enabled:()=>true});
  let version:number|undefined;const calls:any[]=[];
  (service as any).run=async(request:any)=>{calls.push(request);return {processes:[{pid:42,binding:{pid:42}}],fileSendProtocolVersion:version};};
  const config={...emptyWechatConfig(),enabled:true,experimental:true,pid:42,send:['*']};
  const tool=service.tools().find(t=>t.name==='wechat_send_file')!;
  const args={recipient:'filehelper',path:'C:\\test.txt',idempotencyKey:'file-test-01'};
  const invoke=()=>tool.invoke(args,new AbortController().signal);
  try{
    assert.equal(wechatConfigSchema.parse({...config,sendFiles:undefined}).sendFiles,false);
    await service.save(config);let count=calls.length;
    await assert.rejects(invoke(),/wechat\/sendFiles/);assert.equal(calls.length,count);
    await service.save({...config,sendFiles:true,sendBlocked:['filehelper']});count=calls.length;
    await assert.rejects(invoke(),/黑名单/);assert.equal(calls.length,count);
    await service.save({...config,sendFiles:true});
    await assert.rejects(invoke(),/工具包/);assert(!calls.some(r=>r.method==='send_file'));
    version=1;await invoke();assert.equal(calls.at(-1).method,'send_file');assert.equal(calls.at(-1).params.path,args.path);
    await service.save({...config,sendFiles:true,send:[]});count=calls.length;
    await assert.rejects(invoke(),/授权列表/);assert.equal(calls.length,count);
  }finally{await rm(directory,{recursive:true,force:true});}
});
