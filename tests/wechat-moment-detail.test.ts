import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WechatService} from '../src/core/wechat';
import {emptyWechatConfig} from '../src/shared/wechat';

test('Moment detail requires read grant and a compatible target runtime',async()=>{
  if(process.platform!=='win32')return;
  const directory=await mkdtemp(join(tmpdir(),'wechat-detail-'));
  const service=new WechatService(directory,{plugins:()=>[]},{enabled:()=>true});
  let version:number|undefined;const calls:any[]=[];
  (service as any).run=async(request:any)=>{calls.push(request);return {processes:[{pid:42,binding:{pid:42}}],readProtocolVersion:2,momentsDetailProtocolVersion:version};};
  const config={...emptyWechatConfig(),enabled:true,experimental:true,pid:42};
  const tool=service.tools().find(t=>t.name==='wechat_moment_detail')!;
  const invoke=()=>tool.invoke({postId:'18446744073709551615',limit:20},new AbortController().signal);
  try{
    await service.save(config);let count=calls.length;
    await assert.rejects(invoke(),/wechat\/readMoments/);assert.equal(calls.length,count);
    await service.save({...config,readMoments:true});
    await assert.rejects(invoke(),/工具包/);assert(!calls.some(r=>r.method==='moment_detail'));
    version=1;await invoke();assert.equal(calls.at(-1).method,'moment_detail');
    assert.equal(calls.at(-1).params.postId,'18446744073709551615');
    assert.deepEqual(calls.at(-1).binding,{pid:42});
  }finally{await rm(directory,{recursive:true,force:true});}
});
