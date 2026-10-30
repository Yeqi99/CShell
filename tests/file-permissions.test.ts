import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SFTPWrapper,Stats} from 'ssh2';
import {filePermissions} from '../src/core/file-permissions';
function fixture(){
 let mode=0o10644,closed=0,writes=0;let failure=false,link=false;
 const stat=()=>({mode,uid:1000,gid:1000,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>link}) as Stats;
 const channel={lstat:(_p:string,cb:Function)=>cb(null,stat()),open:(_p:string,_f:string,cb:Function)=>cb(null,Buffer.from('fixed-handle')),fstat:(_h:Buffer,cb:Function)=>cb(null,stat()),fchmod:(h:Buffer,value:number,cb:Function)=>{assert.equal(h.toString(),'fixed-handle');writes++;if(failure)cb(Error('Permission denied'));else{mode=value;cb();}},close:(_h:Buffer,cb:Function)=>{closed++;cb();}} as unknown as SFTPWrapper;
 return {channel,get writes(){return writes;},get closed(){return closed;},deny:()=>failure=true,link:()=>link=true,setMode:(v:number)=>mode=v};
}
test('SFTP permission edits use bound handles and preserve special bits',async()=>{
 const f=fixture();f.setMode(0o104644);const before=await filePermissions(f.channel,'/target');assert.equal(before.mode,0o4644);const after=await filePermissions(f.channel,'/target',{mode:0o640,expectedMode:before.mode});assert.equal(after.mode,0o4640);assert.equal(f.closed,1);assert.equal(f.writes,1);
});
test('symlinks, stale permissions and invalid modes never mutate',async()=>{
 const f=fixture();await assert.rejects(filePermissions(f.channel,'/target',{mode:0o777,expectedMode:0o600}),/改变/);assert.equal(f.writes,0);assert.equal(f.closed,1);await assert.rejects(filePermissions(f.channel,'/target',{mode:0o1777,expectedMode:0o644}),/000/);f.link();await assert.rejects(filePermissions(f.channel,'/target'),/符号链接/);assert.equal(f.writes,0);
});
test('server permission denial is surfaced and handle closes without retry',async()=>{
 const f=fixture();f.deny();await assert.rejects(filePermissions(f.channel,'/target',{mode:0o600,expectedMode:0o644}),/Permission denied/);assert.equal(f.writes,1);assert.equal(f.closed,1);
});
