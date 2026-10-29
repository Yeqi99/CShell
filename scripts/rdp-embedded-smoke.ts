import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EmbeddedRdpService} from '../src/desktop/embedded-rdp';
import type {Profile} from '../src/shared/contracts';
if(process.platform!=='win32'){console.log('SKIP Windows ActiveX host');process.exit(0);}
const directory=await mkdtemp(join(tmpdir(),'cshell-rdp-test-'));
const service=new EmbeddedRdpService(directory);
const profile={id:'00000000-0000-4000-8000-000000000001',group:'',favorite:false,name:'Isolated RDP test',protocol:'rdp',host:'127.0.0.1',port:1,username:'cshell-test',auth:'password'} as Profile;
try {
 const canceled=service.open(profile,'',Buffer.alloc(8));service.close(profile.id);await assert.rejects(canceled,/取消/);
 const [first,second]=await Promise.all([service.open(profile,'',Buffer.alloc(8)),service.open(profile,'',Buffer.alloc(8))]);assert.deepEqual(first,second);
 await new Promise(r=>setTimeout(r,1500));assert.equal(service.status(profile.id).state,'connecting');
 service.close(profile.id);assert.equal(service.status(profile.id).state,'closed');
 console.log('PASS real ActiveX creation, concurrent open reuse, pending cancellation, close');
} finally {service.dispose();await new Promise(r=>setTimeout(r,2000));await rm(directory,{recursive:true,force:true});}

