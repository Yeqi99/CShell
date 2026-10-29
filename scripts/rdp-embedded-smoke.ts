import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EmbeddedRdpService} from '../src/desktop/embedded-rdp';
import type {Profile} from '../src/shared/contracts';
if(process.platform!=='win32'){console.log('SKIP Windows ActiveX host');process.exit(0);}
const directory=await mkdtemp(join(tmpdir(),'cshell-rdp-test-'));
const service=new EmbeddedRdpService(directory);
const profile={id:'00000000-0000-4000-8000-000000000001',group:'',favorite:false,name:'Isolated RDP test',protocol:'rdp',host:'127.0.0.1',port:1,username:'cshell-test',auth:'password'} as Profile;
try {
 const blocked=join(directory,'blocked');await writeFile(blocked,'fixture');const retry=new EmbeddedRdpService(blocked);await assert.rejects(retry.open(profile,'',Buffer.alloc(8)));await rm(blocked);await retry.open(profile,'',Buffer.alloc(8));retry.dispose();console.log('PASS failed build cache retries');
 const canceled=service.open(profile,'',Buffer.alloc(8));service.close(profile.id);await assert.rejects(canceled,/取消/);
 const [first,second]=await Promise.all([service.open(profile,'',Buffer.alloc(8)),service.open(profile,'',Buffer.alloc(8))]);assert.deepEqual(first,second);
 const deadline=Date.now()+35000;while(service.status(profile.id).state==='connecting'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));assert.equal(service.status(profile.id).state,'failed');assert.match(service.status(profile.id).message,/RDP \d+, extended \d+/);console.log('PASS native disconnect event:',service.status(profile.id).message);
 service.close(profile.id);assert.equal(service.status(profile.id).state,'closed');
 await service.open(profile,'',Buffer.alloc(8));assert.throws(()=>service.send(profile.id,{op:'bounds',padding:'x'.repeat(131073)}),/超出限制/);
 const child=(service as any).sessions.get(profile.id).child;child.stdin.write('x'.repeat(131074)+'\n');const inputDeadline=Date.now()+10000;while(service.status(profile.id).state==='connecting'&&Date.now()<inputDeadline)await new Promise(r=>setTimeout(r,50));assert.equal(service.status(profile.id).state,'failed');assert.match(service.status(profile.id).message,/输入超出限制/);
 service.close(profile.id);
 console.log('PASS real ActiveX creation, concurrent open reuse, pending cancellation, close');
} finally {service.dispose();await new Promise(r=>setTimeout(r,2000));await rm(directory,{recursive:true,force:true});}

