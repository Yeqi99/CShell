import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SshService} from '../src/core/ssh';
import {PythonFiles} from '../src/core/python-files';
import {fixture} from './fixture';

for(const supported of [false,true])test(`SFTP atomic save ${supported?'uses a real advertised extension':'refuses unsupported replacement without writing'}`,async()=>{
 const remote=await fixture({opensshRename:supported}),ssh=new SshService(()=>{},async()=>true);
 try{
  const result=await ssh.connect({id:randomUUID(),name:'Isolated SFTP',host:'127.0.0.1',port:remote.port,username:'tester',group:'',favorite:false,auth:'password',protocol:'sftp'},{password:remote.password});
  assert.equal(remote.shellRequests(),0);
  const files=new PythonFiles(ssh,true),before=await files.read(result.sessionId,'/hello.txt'),names=await readdir(remote.root);
  if(supported){
   await files.save(result.sessionId,'/hello.txt','updated through SFTP',before.revision);
   assert.equal(await readFile(join(remote.root,'hello.txt'),'utf8'),'updated through SFTP');
   const fresh=await files.read(result.sessionId,'/hello.txt');await writeFile(join(remote.root,'hello.txt'),'concurrent edit');
   await assert.rejects(files.save(result.sessionId,'/hello.txt','must not replace',fresh.revision),/changed on the server/);
   assert.equal(await readFile(join(remote.root,'hello.txt'),'utf8'),'concurrent edit');
  }else{
   await assert.rejects(files.save(result.sessionId,'/hello.txt','must not replace',before.revision),/原文件未修改/);
   assert.equal(await readFile(join(remote.root,'hello.txt'),'utf8'),before.code);
   assert.deepEqual(await readdir(remote.root),names,'unsupported save does not leave temporary files');
  }
 }finally{ssh.dispose();await remote.close();}
});
