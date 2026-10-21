/** Actual TypeScript ClientProvider/DesktopSession -> Android TLS host, through emulator ADB forwarding.
 * Requires debug + androidTest APKs already installed. Never targets a physical phone. */
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {ClientProvider} from '../src/core/client/provider';
import {ClientVault,createIdentity} from '../src/core/client/identity';
import {connectDesktop,type DesktopClient} from '../src/core/desktop-client';
import type {DesktopTicket} from '../src/shared/agent-desktop';
const exec=promisify(execFile),serial=process.env.ANDROID_SERIAL??'emulator-5554';
assert.match(serial,/^emulator-\d+$/,'Only an isolated Android emulator is allowed');
const adb=resolve(process.env.ANDROID_HOME??'.local/android-sdk','platform-tools',process.platform==='win32'?'adb.exe':'adb');
const adbCall=async(...args:string[])=>String((await exec(adb,['-s',serial,...args],{timeout:15000,maxBuffer:2*1024*1024})).stdout).trim();
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const directory=await mkdtemp(join(tmpdir(),'cshell-android-host-interop-')),key=randomBytes(32);
const codec={async encrypt(text:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]).toString('base64');},async decrypt(text:string){const b=Buffer.from(text,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString();}};
let port=0,desktop:DesktopClient|undefined,log='';
const fixture=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','hostFixture','true','org.canpshell.mobile.test/org.canpshell.mobile.AgentProtocolTest'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
fixture.stdout.on('data',c=>log+=String(c));fixture.stderr.on('data',c=>log+=String(c));
try {
  let config:any;
  const start=Date.now();while(Date.now()-start<30000){try{config=JSON.parse(await adbCall('shell','run-as','org.canpshell.mobile','cat','files/host-fixture.json'));if(log.includes('HOST_FIXTURE_READY'))break;}catch{}if(fixture.exitCode!==null)throw new Error('Host fixture exited: '+log);await wait(250);}
  assert(config&&log.includes('HOST_FIXTURE_READY'),'Android host fixture did not start: '+log);
  port=Number(await adbCall('forward','tcp:0','tcp:47841'));assert(port>0);
  const provider=new ClientProvider(new ClientVault(directory,codec),()=>{});await provider.load();
  const info=await provider.probe({host:'127.0.0.1',port});assert.equal(info.deviceId,config.deviceId);assert.equal(info.certificate.replace(/\s/g,''),config.certificate.replace(/\s/g,''));
  const other=await createIdentity();await assert.rejects(()=>provider.pairPassword({...info,certificate:other.certificate},config.password),/identity changed/);
  await assert.rejects(()=>provider.pairPassword(info,'incorrect-fixture-password'),/authentication failed/);
  await provider.pairPassword(info,config.password);
  assert.deepEqual(await provider.shells(info.deviceId),[]);
  const status=await provider.call(info.deviceId,{method:'client.status'}) as any;assert.equal(status.platform,'android');assert.equal(status.allowManage,true);assert.equal(status.allowHttp,false);
  const quality={fps:30,bitrate:2000000,display:0,adaptive:false};let total=0;
  for(let attempt=0;attempt<2;attempt++){
    await assert.rejects(()=>provider.call(info.deviceId,{method:'desktop.open',params:{quality,control:true,transport:'management',mediaTransport:'udp'}}),/Unsupported mediaTransport/);
    const ticket=await provider.call(info.deviceId,{method:'desktop.open',params:{quality,control:true,transport:'management'}}) as DesktopTicket;assert.equal(ticket.mediaTransport,'tcp');
    const stream=await provider.openDesktopStream(info.deviceId);desktop=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:info.deviceId,stream});
    const client=desktop;let frames=0,held:string|undefined,allowAck=false;let failure:Error|undefined,unsupportedNotice=false;client.on('notice',message=>{if(String(message).includes('不支持此输入'))unsupportedNotice=true;});
    const closed=(reason:string)=>{failure=new Error('Desktop unexpectedly closed: '+reason);};client.on('closed',closed);
    client.on('frame',frame=>{try{assert.equal(frame.data.length,100000);assert(frame.data.every((v:number)=>v===73));frames++;total++;if(allowAck)client.ack(frame.id);else held=String(frame.id);}catch(e){failure=e as Error;}});
    const until=Date.now()+10000;while(!frames&&Date.now()<until&&!failure)await wait(25);if(failure)throw failure;assert.equal(frames,1);
    await wait(400);assert.equal(frames,1,'Host queued video ahead of renderer receipts');
    allowAck=true;client.ack(held!);client.input({kind:'move',x:.5,y:.5});client.input({kind:'text',text:'host interop'});client.input({kind:'key',code:59,down:true});
    const rest=Date.now()+10000;while(frames<5&&Date.now()<rest&&!failure)await wait(25);if(failure)throw failure;assert(frames>=5);assert(unsupportedNotice,'Unsupported input disconnected or failed to explain the limitation');
    client.off('closed',closed);await client.close();desktop=undefined;await wait(250);
  }
  const receipt=JSON.parse(await adbCall('shell','run-as','org.canpshell.mobile','cat','files/host-fixture-result.json'));assert(receipt.inputs>=4);assert(receipt.releases>=2);
  const result={passed:true,transport:'actual ClientProvider + DesktopClient + DesktopSession TLS 1.3 / AEAD TCP',frames:total,inputs:receipt.inputs,releases:receipt.releases,checks:['pinned identity before password','wrong password rejected','honest Android capabilities','fragmented frames','ACK backpressure','input forwarding','fresh desktop reconnect','desktop UDP preference falls back to TCP','unsupported input preserves video']};
  await mkdir('test-results',{recursive:true});await writeFile('test-results/android-host-node-interop.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch(error) {
  try{console.error('Android host receipt:',await adbCall('shell','run-as','org.canpshell.mobile','cat','files/host-fixture-result.json'));}catch{}
  throw error;
} finally {
  await desktop?.close();
  try{await adbCall('shell','run-as','org.canpshell.mobile','touch','files/host-fixture-stop');}catch{}
  await Promise.race([new Promise<void>(r=>fixture.once('exit',()=>r())),wait(3000)]);if(fixture.exitCode===null)fixture.kill();
  if(port)await adbCall('forward','--remove',`tcp:${port}`).catch(()=>{});
  await mkdir('test-results',{recursive:true});await writeFile('test-results/android-host-node-interop-instrumentation.log',log);await rm(directory,{recursive:true,force:true});
}
