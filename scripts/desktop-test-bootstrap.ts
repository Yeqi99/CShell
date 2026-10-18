import {testHostSchema,testPortSchema} from './desktop-test-target';
/** Explicit, isolated server acceptance deployment. Never used by normal app startup. */
import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {createAgentRuntime} from '../src/agent/runtime';
import {agentCodec} from '../src/agent/storage';
import {ClientVault} from '../src/core/client/identity';
import {networkInterfaces} from 'node:os';
import {createSocket} from 'node:dgram';

async function selectInterface(host:string,port:number){
 const addresses=Object.values(networkInterfaces()).flatMap(rows=>rows??[]).filter(row=>row.family==='IPv4'&&!row.internal).map(row=>row.address);
 if(addresses.length===1)return addresses[0];
 const route=createSocket('udp4');
 try{
  await new Promise<void>((ok,fail)=>{const timer=setTimeout(()=>fail(Error('Cannot determine server network route')),5000);route.once('error',error=>{clearTimeout(timer);fail(error);});route.connect(port,host,()=>{clearTimeout(timer);ok();});});
  const address=route.address().address;if(addresses.includes(address))return address;
  throw Error('Cannot select a real network interface; no listener was opened');
 }finally{route.close();}
}

async function main(){
const root=dirname(resolve(process.argv[1]));
const config=z.object({controllerFingerprint:z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/),host:testHostSchema,managementPort:testPortSchema,publicManagementPort:testPortSchema,desktopPort:testPortSchema,publicDesktopPort:testPortSchema}).strict().parse(JSON.parse(await readFile(join(root,'test-config.json'),'utf8')));
const bind=await selectInterface(config.host,config.publicManagementPort);
console.log('Selected server interface: '+bind);
if(process.argv.includes('--check-interface'))return;
const directory=join(process.env.LOCALAPPDATA!,'CAgent Desktop Acceptance');
if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('Windows interactive account required');
const runtime=await createAgentRuntime({directory,desktopExecutable:join(root,'cagent-desktop.exe')});
try{
 // This isolated test installation intentionally authorizes only the supplied controller.
 await runtime.server.setAccess({password:randomBytes(32).toString('hex'),shells:['powershell'],allowManage:true,allowHttp:false,allowHosting:false,allowRelay:false});
 const vault=new ClientVault(directory,await agentCodec(directory));
 await vault.write('peers',[{fingerprint:config.controllerFingerprint,name:'CShell remote desktop acceptance',shells:['powershell'],allowManage:true,allowHttp:false,allowHosting:false,allowRelay:false}]);
 await runtime.server.load();
 await runtime.dispatch('packages.install',{id:'cagent.desktop',confirm:true});
 await runtime.dispatch('packages.grant',{id:'cagent.desktop',permissions:['desktop.view','desktop.control']});
 await runtime.dispatch('desktop.configure',{enabled:true,bindAddress:bind,tcpPort:config.desktopPort,udpPort:config.desktopPort,publicTcpPort:config.publicDesktopPort,publicUdpPort:config.publicDesktopPort,local:{view:false,control:false},ownerGrants:{[config.controllerFingerprint]:{view:true,control:true}}});
 await runtime.startControl();
 await runtime.server.start({bind,port:config.managementPort,advertisedHost:config.host});
 const identity=await vault.identity();
 const receipt={protocol:1,deviceId:identity.id,name:'Remote Windows desktop test',host:config.host,port:config.publicManagementPort,certificate:identity.certificate,fingerprint:runtime.server.status().fingerprint,startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+4*60*60*1000).toISOString(),firewallChanged:false};
 await writeFile(join(root,'server-receipt.json'),JSON.stringify(receipt,null,2));
 console.log(`Desktop acceptance server ready. Management TCP ${config.managementPort}; desktop TCP/UDP ${config.desktopPort}.`);
 console.log('Only the prepared controller is authorized. No firewall or startup changes.');
 console.log('Closes after 4 hours, or press Ctrl+C. Receipt: server-receipt.json');
 const stop=async()=>{await runtime.close();process.exitCode=0;};
 const timer=setTimeout(()=>void stop(),4*60*60*1000);timer.unref();
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
}catch(error){await runtime.close();throw error;}
}
main().catch(async error=>{const message=error instanceof Error?error.message:'Deployment failed';console.error(message);await writeFile(join(dirname(resolve(process.argv[1])),'deployment-error.txt'),new Date().toISOString()+'\n'+message+'\n').catch(()=>{});process.exitCode=1;});
