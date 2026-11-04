import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capabilityDownloadSources,openCapabilityDownload} from '../src/agent/capability-download-source';
import {managedWechatCatalog} from '../src/agent/managed-wechat-catalog';
test('only exact public pinned WeChat packages use the Hong Kong mirror',()=>{
 const e=managedWechatCatalog[0];assert.match(capabilityDownloadSources(e)[0],/^https:\/\/shell.canp.ai\//);
 assert.deepEqual(capabilityDownloadSources({...e,bundleSha256:'0'.repeat(64)}),[e.url]);
 assert.deepEqual(capabilityDownloadSources({...e,url:e.url!.replace('Yeqi99','other')}),[e.url!.replace('Yeqi99','other')]);
});
test('mirror transport failure uses original without changing credentials or digest',async()=>{
 const urls:string[]=[];const e=managedWechatCatalog[0];
 const response=await openCapabilityDownload(e,async(url)=>{urls.push(String(url));if(urls.length===1)throw Error('timeout');return new Response('bundle');},new AbortController().signal);
 assert.equal(await response.text(),'bundle');assert.equal(urls[1],e.url);
});
test('mirror redirect cannot escape and caller cancellation never retries',async()=>{
 await assert.rejects(openCapabilityDownload(managedWechatCatalog[0],async()=>new Response(null,{status:302,headers:{location:'https://attacker.invalid'}}),new AbortController().signal),/redirect/);
 const c=new AbortController();let calls=0;
 await assert.rejects(openCapabilityDownload(managedWechatCatalog[0],async()=>{calls++;c.abort();throw Error('abort');},c.signal));assert.equal(calls,1);
});

test('1.0 compatible 0.1.3 bundles use their exact immutable mirror',()=>{
 for(const [version,digest] of [['4.1.15.56','a73b1767e46f2737021d4815b672d7f7b023b1cf6cdb381b3b391cb09e912e09'],['4.2.0.12','a044a1f1826613c775465a02cf16ec116f08a2df63791bd4d6e74a93de35a7ba']]){
  const name=`Weixin-${version}-0.1.3.cagent-package.json`,url=`https://github.com/Yeqi99/CShell/releases/download/wechat-toolkit-v0.1.3/${name}`;
  const entry={...managedWechatCatalog[0],url,bundleSha256:digest};
  assert.deepEqual(capabilityDownloadSources(entry),[`https://shell.canp.ai/downloads/toolkit/v0.1.3/${name}`,url]);
  assert.equal(capabilityDownloadSources({...entry,url:url.replace('v0.1.3/','v0.1.2/')}).length,1);
 }
});
