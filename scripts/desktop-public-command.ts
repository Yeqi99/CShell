import {desktopTestTarget} from './desktop-test-target';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ClientVault,fingerprint} from '../src/core/client/identity';
import {ClientProvider} from '../src/core/client/provider';
import {agentCodec} from '../src/agent/storage';
const receipt=JSON.parse(await readFile('test-results/desktop-server-receipt.json','utf8'));
const expected=desktopTestTarget();
if(receipt.host!==expected.host||receipt.port!==expected.port||fingerprint(receipt.certificate)!==receipt.fingerprint)throw Error('Receipt invalid');
const directory=resolve('test-results/desktop-test-controller');
const vault=new ClientVault(directory,await agentCodec(directory));
const provider=new ClientProvider(vault,event=>{if(event.type==='data')try{provider.resolve(event.sessionId).terminal?.acknowledge(Buffer.byteLength(event.data));}catch{}});
await provider.load();
try{
 const id=await provider.connect({deviceId:receipt.deviceId,shell:'powershell'},undefined,AbortSignal.timeout(90000));
 const tool=provider.resolve(id).tools.find(t=>t.name==='execute_command');if(!tool)throw Error('Command capability unavailable');
 console.log(await tool.invoke({command:await readFile(process.argv[2],'utf8'),timeoutMs:60000},AbortSignal.timeout(70000)));
}finally{provider.dispose();}
