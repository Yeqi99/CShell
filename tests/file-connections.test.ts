import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture';
import {SshService} from '../src/core/ssh';
import {createSshManager} from '../src/core/connections/ssh-provider';
import {profileSchema} from '../src/shared/contracts';
import {profileProvider} from '../src/shared/file-connections';

test('SFTP opens its real subsystem without requesting a PTY, shell, metrics or extensions',async()=>{
  const remote=await fixture({stallShell:true});
  const profile=profileSchema.parse({id:randomUUID(),name:'File only',protocol:'sftp',host:'127.0.0.1',port:remote.port,username:'tester',group:'Files',favorite:false,auth:'password'});
  let verified=0,extensionRequests=0;
  const ssh=new SshService(()=>{},async()=>{verified++;return true;},{connectTimeoutMs:5000});
  const manager=createSshManager(ssh,()=>[profile],()=>{extensionRequests++;return [];});
  try{
    const id=await manager.connect(profileProvider(profile),profile,{password:remote.password});
    assert.equal(verified,1);
    assert.equal(remote.shellRequests(),0);
    assert.equal(ssh.get(id).shell,undefined);
    assert.ok((await manager.tools.files(id).list('.')).entries.some(e=>e.name==='hello.txt'));
    const names=manager.tools.tools(id).map(t=>t.name);
    assert.ok(names.includes('read_file_chunk'));
    assert.ok(names.includes('create_directory'));
    assert.ok(!names.includes('execute_command')&&!names.includes('read_metrics'));
    assert.equal(extensionRequests,0);
    assert.equal(manager.tools.supportsHttp(id),false);
    assert.throws(()=>manager.tools.terminal(id));
    await assert.rejects(ssh.monitor(id),/SFTP/);
    await assert.rejects(ssh.openEnvironment(id,'sh'),/SFTP/);
    await ssh.action(id,'mkdir','/files');
    await ssh.action(id,'rename','/hello.txt','/files/hello.txt');
    assert.ok((await ssh.list(id,'/files')).entries.some(e=>e.name==='hello.txt'));
    await ssh.action(id,'delete','/files/hello.txt');
    await ssh.action(id,'delete','/files');
    await manager.disconnect(id);
    assert.throws(()=>manager.tools.files(id));
  }finally{ssh.dispose();await remote.close();}
});

test('SFTP preserves host verification and cancellation; FTP does not accept SSH keys',async()=>{
  const remote=await fixture({stallShell:true});
  const profile=profileSchema.parse({id:randomUUID(),name:'File only',protocol:'sftp',host:'127.0.0.1',port:remote.port,username:'tester',group:'',favorite:false,auth:'password'});
  const ssh=new SshService(()=>{},async()=>false,{connectTimeoutMs:5000});
  try{
    await assert.rejects(ssh.connect(profile,{password:remote.password}));
    assert.equal(ssh.size,0);
    assert.equal(remote.shellRequests(),0);
    const abort=new AbortController();abort.abort();
    await assert.rejects(ssh.connect(profile,{password:remote.password},abort.signal));
    assert.throws(()=>profileSchema.parse({...profile,protocol:'ftp',auth:'key'}));
    assert.throws(()=>profileSchema.parse({...profile,protocol:'smtp'}));
  }finally{ssh.dispose();await remote.close();}
});
