import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectWechatMarket,requireWechatVersion} from '../src/agent/wechat-market';
const entries=['cagent.system','cagent.wechat.v411556','cagent.wechat.v42012'].map(id=>({id,name:id,description:'',grants:['retained']}));
test('market presents one exact-version WeChat application preserving underlying identity and grants',()=>{
 const result=selectWechatMarket(entries,['4.2.0.12']);assert.equal(result.length,2);assert.equal(result[1].name,'微信工具');assert.equal(result[1].id,'cagent.wechat.v42012');assert.deepEqual(result[1].grants,['retained']);
 requireWechatVersion(result[1].id,['4.2.0.12']);
 for(const versions of [[],['4.3.0.0'],['4.1.15.56','4.2.0.12']])assert.throws(()=>requireWechatVersion(result[1].id,versions));
 assert.match(selectWechatMarket(entries,[])[1].description,/先打开/);
});
test('legacy and version-pinned packages still render one WeChat app without changing stored grants',()=>{
 const all=[...entries,{id:'cagent.wechat',name:'微信掌控',description:'legacy',grants:['legacy-only']}];
 for(const versions of [[],['4.2.0.12'],['4.1.15.50'],['4.1.15.56','4.2.0.12']]){
  const result=selectWechatMarket(all,versions);
  assert.equal(result.filter(x=>x.id.startsWith('cagent.wechat')).length,1);
  assert.equal(all.length,4);
 }
 const legacy=selectWechatMarket(all,['4.1.15.50']).find(x=>x.id==='cagent.wechat')!;
 assert.deepEqual(legacy.grants,['legacy-only']);assert.match(legacy.description,/4\.1\.15\.50/);
 assert.equal(selectWechatMarket(all,['4.2.0.12']).at(-1)?.id,'cagent.wechat.v42012');
});
