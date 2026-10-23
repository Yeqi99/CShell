import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planAccountImport} from '../src/core/account-import';
const sample=()=>({format:1,store:{profiles:[{id:'p',name:'Machine'}],secrets:{p:{password:'old'}},hosts:{},groups:[],presets:[],monitorViews:[],preferences:{theme:'light'}},ai:{providers:[],habits:[],extractionProviderId:null,textProviderIds:{translate:null,compose:null}},opencode:{accounts:[]},devices:[],http:[],browser:{},assets:{},future:{preserved:true}});

test('imported permission policy requires an explicit source choice',()=>{
 const a:any=sample(),s:any=sample();a.ai.policy={application:[]};s.ai.policy={application:['connections.read']};
 const pending=planAccountImport(a,s,{settings:true,choices:{}});
 assert.deepEqual(pending.value.ai.policy,a.ai.policy);assert(pending.unresolved.some(c=>c.id==='ai-policy'));
 assert.deepEqual(planAccountImport(a,s,{settings:false,choices:{'ai-policy':'source'}}).value.ai.policy,s.ai.policy);
});
test('connection credentials require the same explicit decision as their connection',()=>{
 const a=sample(),s=sample();s.store.secrets.p.password='new';
 const preview=planAccountImport(a,s,{settings:false,choices:{}});
 assert.equal(preview.unresolved.length,1);assert.equal(preview.conflicts[0].id,'连接/p');
 assert(!JSON.stringify(preview.conflicts).includes('password'));
 assert.deepEqual(preview.value.store.secrets,a.store.secrets);
 const selected=planAccountImport(a,s,{settings:false,choices:{'连接/p':'source'}});
 assert.equal(selected.unresolved.length,0);assert.deepEqual(selected.value.store.secrets,s.store.secrets);
 assert.equal(a.store.secrets.p.password,'old');assert.deepEqual(selected.value.future,a.future);
});
test('host and device identity conflicts cannot be overridden by import choices',()=>{
 const a:any=sample(),s:any=sample();a.store.hosts.h='a';s.store.hosts.h='b';
 assert.throws(()=>planAccountImport(a,s,{settings:true,choices:{}}),/主机身份/);
 a.store.hosts={};s.store.hosts={};a.devices=[{deviceId:'d',certificate:'a'}];s.devices=[{deviceId:'d',certificate:'b'}];
 assert.throws(()=>planAccountImport(a,s,{settings:true,choices:{}}),/CAgent 身份/);
});
test('imports preserve model/account IDs, do not import settings by default, reject duplicate IDs',()=>{
 const a:any=sample(),s:any=sample();s.ai.providers=[{id:'model',name:'Model',extensionAccountId:'account'}];s.opencode.accounts=[{id:'account',name:'Code',key:'secret',providerId:'model'}];s.store.preferences.theme='dark';
 const result=planAccountImport(a,s,{settings:false,choices:{}});
 assert.deepEqual(result.value.ai.providers,s.ai.providers);assert.deepEqual(result.value.opencode?.accounts,s.opencode.accounts);assert.deepEqual(result.value.store.preferences,a.store.preferences);
 s.opencode.accounts.push({...s.opencode.accounts[0]});assert.throws(()=>planAccountImport(a,s,{settings:false,choices:{}}),/重复/);
});
test('browser histories merge by URL and date without replacing current tabs',()=>{
 const a:any=sample(),s:any=sample();a.browser.machine={tabs:[{url:'https://current.invalid'}],selected:0,history:[{url:'https://one.invalid',at:'2026-01-01'}],bookmarks:[]};s.browser.machine={tabs:[{url:'https://source.invalid'}],selected:0,history:[{url:'https://one.invalid',at:'2026-01-02'},{url:'https://two.invalid',at:'2026-01-03'}],bookmarks:[]};
 const result=planAccountImport(a,s,{settings:false,choices:{}}).value.browser!.machine;
 assert.deepEqual(result.tabs,a.browser.machine.tabs);assert.equal((result.history as any[]).length,2);assert.equal((result.history as any[])[1].at,'2026-01-02');
});
