import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WechatService } from '../src/core/wechat';
import { emptyWechatConfig, localWechatPaymentTools, wechatConfigSchema, remoteWechatConfig } from '../src/shared/wechat';
import { emptyAiPolicy, aiPolicySchema } from '../src/shared/ai';
import { permissionNodes } from '../src/shared/permission-links';
import { remoteWechatTools } from '../src/core/remote-wechat-tools';

test('payment grants default closed and have independent navigable permission nodes', () => {
  const config=wechatConfigSchema.parse({...emptyWechatConfig(),receiveTransfers:undefined,receiveRedPackets:undefined});
  assert.equal(config.receiveTransfers,false);assert.equal(config.receiveRedPackets,false);
  assert(!emptyAiPolicy().application.includes('wechat.payments.receive'));
  assert(aiPolicySchema.parse({...emptyAiPolicy(),application:['wechat.payments.receive']}));
  for(const id of ['wechat/receiveTransfers','wechat/receiveRedPackets','application/wechat.payments.receive'])assert(permissionNodes.some(node=>node.id===id));
  const remote=remoteWechatConfig({...config,receiveTransfers:true,receiveRedPackets:true});
  assert(!('receiveTransfers' in remote));assert(!('receiveRedPackets' in remote));
  assert.equal(wechatConfigSchema.parse(remote).receiveTransfers,false);
  assert.equal(wechatConfigSchema.parse(remote).receiveRedPackets,false);
});

test('local payment atomics validate identity, enforce separate grants, and pass only bound config directory', {skip:process.platform!=='win32'},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'wechat-atomic-contract-'));
  const service=new WechatService(directory,{plugins:()=>[]},{enabled:()=>true});
  const requests:any[]=[];
  (service as any).run=async(request:any)=>{requests.push(request);return request.method==='discover'?{processes:[{pid:42,binding:{pid:42,account:'fixture'}}]}:{state:'fixture-only'};};
  const config={...emptyWechatConfig(),enabled:true,experimental:true,pid:42,history:['wxid_sender']};
  const identity={account:'a'.repeat(64),peer:'wxid_sender',ref:'b'.repeat(64),serverId:'18446744073709551615'};
  const get=(name:string)=>service.tools().find(tool=>tool.name===name)!;
  const invoke=(name:string,args:unknown)=>get(name).invoke(args,new AbortController().signal);
  try{
    await service.save(config);
    const savedBinding=(service as any).binding;
    (service as any).binding=null;
    await invoke('wechat_payment_parse',{xml:'<msg/>'});
    assert.equal(requests.at(-1).method,'payment_parse');
    assert.equal(requests.at(-1).binding,null);
    (service as any).binding=savedBinding;
    assert(localWechatPaymentTools.every(name=>get(name)));
    for(const name of ['wechat_transfer_receive','wechat_red_packet_receive']){
      assert.equal(get(name).capability,'wechat.payments.receive');assert.equal(get(name).needsReview({}),true);
    }
    const before=requests.length;
    await assert.rejects(invoke('wechat_transfer_receive',{...identity,amountMinor:10}),/receiveTransfers/);
    await assert.rejects(invoke('wechat_red_packet_receive',identity),/receiveRedPackets/);
    assert.equal(requests.length,before);
    await service.save({...config,receiveTransfers:true});
    await invoke('wechat_transfer_receive',{...identity,amountMinor:10});
    assert.equal(requests.at(-1).method,'transfer_receive');assert.equal(requests.at(-1).configDirectory,directory);
    assert.deepEqual(requests.at(-1).binding,{pid:42,account:'fixture'});
    await assert.rejects(invoke('wechat_red_packet_receive',identity),/receiveRedPackets/);
    await service.save({...config,receiveRedPackets:true});
    await invoke('wechat_red_packet_receive',identity);
    assert.equal(requests.at(-1).method,'red_packet_receive');
    await assert.rejects(invoke('wechat_transfer_receive',{...identity,amountMinor:10}),/receiveTransfers/);
    await service.save({...config,receiveTransfers:true,history:[]});
    await assert.rejects(invoke('wechat_transfer_receive',{...identity,amountMinor:10}),/历史读取/);
    const count=requests.length;
    for(const params of [{...identity,serverId:'0',amountMinor:10},{...identity,serverId:'18446744073709551616',amountMinor:10},{...identity,amountMinor:Number.MAX_SAFE_INTEGER+1},{...identity,amountMinor:0},{...identity,peer:'nickname',amountMinor:10},{...identity,amountMinor:10,configDirectory:'other'}])await assert.rejects(invoke('wechat_transfer_receive',params));
    await assert.rejects(invoke('wechat_payment_parse',{xml:'中'.repeat(30000)}));
    await assert.rejects(invoke('wechat_transfer_receive',{...identity,peer:'qq123456',amountMinor:10}));
    assert.equal(requests.length,count);
    await invoke('wechat_payment_parse',{xml:'<msg/>'});
    assert.equal(requests.at(-1).method,'payment_parse');
    await invoke('wechat_payment_result',{id:'c'.repeat(64)});
    assert.equal(requests.at(-1).method,'payment_result');
    assert.equal(get('wechat_payment_result').needsReview({}),false);
    assert.equal(get('wechat_payment_parse').capability,'wechat.read');
  }finally{await service.subscriptions.stopAll();await rm(directory,{recursive:true,force:true});}
});

test('CAgent and remote metadata cannot advertise desktop-local payment adapters', {skip:process.platform!=='win32'},async()=>{
  const agent=new WechatService('',{plugins:()=>[]},{enabled:()=>true,python:'isolated-agent-python'});
  assert(agent.tools().every(tool=>!(localWechatPaymentTools as readonly string[]).includes(tool.name)));
  const tools=await remoteWechatTools(async()=>localWechatPaymentTools.map(id=>({packageId:'cagent.wechat',id,permissions:['wechat.read','wechat.payments.receive'],sideEffect:false})),new AbortController().signal);
  assert.deepEqual(tools,[]);
});
