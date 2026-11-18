import { _electron } from 'playwright';
import {Client} from 'ssh2';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {fixture} from '../tests/fixture';
const exe=process.argv[2],out=process.argv[3],id=randomUUID(), remote=await fixture();
const value=randomUUID(), receipt=join(out,'服务器验收-'+value.slice(0,8)+'.txt');
await writeFile(join(remote.root,'challenge.txt'),value,'utf8');
let fingerprint='';
await new Promise<void>((ok,fail)=>{const c=new Client();c.on('ready',()=>{c.end();ok()}).on('error',fail).connect({host:'127.0.0.1',port:remote.port,username:'tester',password:remote.password,hostVerifier:key=>{fingerprint='SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'');return true;}})});
const env={...process.env,CSHELL_TEST_DATA:join(process.env.APPDATA!,'CShell Pro'),CSHELL_TEST_START_GATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:exe,env,timeout:60000});
let page,sessionId,threadId,finalStatus;
try{
 page=await app.firstWindow();await page.waitForFunction(()=>window.cshell?.aiSnapshot);
 await app.evaluate(({dialog},expected)=>{const original=dialog.showMessageBox.bind(dialog);dialog.showMessageBox=(...args)=>{const options=args.at(-1);if(options.detail===expected)return Promise.resolve({response:1,checkboxChecked:false});return original(...args);};},'tester@127.0.0.1:'+remote.port+'\n'+fingerprint);
 sessionId=await page.evaluate(async v=>{const a=window.cshell;if(!(await a.cloudStatus()).membership?.active)throw Error('会员未生效');await a.saveProfile({id:v.id,name:'Pro 交付验收 SSH',host:'127.0.0.1',port:v.port,username:'tester',auth:'password',group:'',favorite:false});return (await a.connect(v.id,{password:v.pw,remember:false})).sessionId;},{id,pw:remote.password,port:remote.port});
 threadId=await page.evaluate(async v=>{const a=window.cshell,s=await a.aiSnapshot(),p=s.providers.find(p=>p.model==='pool-'+p.id&&p.name.startsWith('deepseek-v4-flash'));if(!p)throw Error('找不到会员基座');await a.aiPolicySave({...s.policy,profiles:[...s.policy.profiles,v.id],overrides:[...s.policy.overrides,{profileId:v.id,capabilities:['files.read','files.create']}]});return (await a.aiThreadCreate('workspace',p.id,'allow',v.sessionId)).id},{id,sessionId});
 const prompt='请只做文件往返验证。使用 local_desktop_download 把绑定 SSH 服务器 /challenge.txt 下载到本机 '+receipt+'；然后使用 local_desktop_upload 把此本机文件发回同一服务器 /returned.txt 。无需桌面截图或其他命令，成功后简短报告。';
 await page.evaluate(({id,prompt})=>window.cshell.aiSend(id,prompt),{id:threadId,prompt});
 console.log('MEMBER SSH START',threadId);
 let seen='';for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,3000));finalStatus=await page.evaluate(async id=>{const s=await window.cshell.aiSnapshot(),t=s.threads.find(t=>t.id===id);return {id,model:s.providers.find(p=>p.id===t.providerId)?.name,state:t.state,error:t.error,tools:t.messages.filter(m=>m.tool).map(m=>m.tool.name)}},threadId);const key=JSON.stringify(finalStatus);if(key!==seen){console.log(key);seen=key}if(['idle','error'].includes(finalStatus.state))break;}
 const same=(await readFile(receipt,'utf8'))===value&&(await readFile(join(remote.root,'returned.txt'),'utf8'))===value;
 if(!same)throw Error('文件内容不一致');
 await writeFile(join(out,'会员模型SSH往返.json'),JSON.stringify({...finalStatus,matched:true,sha256:createHash('sha256').update(value).digest('hex'),host:'隔离的本机 SSH 服务'},null,2));
}finally{
 if(page&&threadId){await page.evaluate(async({threadId,id})=>{const a=window.cshell;await a.aiStop(threadId);const s=await a.aiSnapshot();await a.aiPolicySave({...s.policy,profiles:s.policy.profiles.filter(k=>k!==id),overrides:s.policy.overrides.filter(o=>o.profileId!==id)});},{threadId,id}).catch(()=>{});}
 if(page&&sessionId)await page.evaluate(sid=>window.cshell.disconnect(sid),sessionId).catch(()=>{});
 if(page)await page.evaluate(id=>window.cshell.deleteProfile(id),id).catch(()=>{});
 await remote.close();await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
}
