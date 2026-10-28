import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {NativeDesktopService,nativeDesktopEndpoint} from '../src/desktop/native-desktop';
test('native desktop endpoints cannot forward arbitrary hosts or traverse paths',()=>{
  assert.equal(nativeDesktopEndpoint.safeParse({port:22}).success,false);
  assert.equal(nativeDesktopEndpoint.safeParse({port:5901,host:'other'}).success,false);
  assert.equal(nativeDesktopEndpoint.safeParse({socket:'/tmp/../etc/socket'}).success,false);
  assert.equal(nativeDesktopEndpoint.safeParse({socket:'/home/user/.vnc/sock'}).success,true);
});
test('native desktop streams only through bound SSH; close settles pending read',async()=>{
  const channel=new PassThrough();let connected=true;let destination:unknown;
  const service=new NativeDesktopService({get:()=>{if(!connected)throw Error('closed');return {profile:{protocol:'ssh'},client:{forwardOut:(_a:unknown,_b:unknown,host:string,port:number,done:Function)=>{destination={host,port};done(undefined,channel);}}};}} as any);
  const id=await service.open('session',{port:5901});
  assert.deepEqual(destination,{host:'127.0.0.1',port:5901});
  channel.write(Buffer.from('RFB 003.008\n'));assert.equal(Buffer.from((await service.read(id))!).toString(),'RFB 003.008\n');
  const pending=service.read(id);service.close(id);assert.equal(await pending,null);
  connected=false;await assert.rejects(service.open('session',{port:5901}));
});
test('SFTP cannot open graphical channels',async()=>{
  const service=new NativeDesktopService({get:()=>({profile:{protocol:'sftp'}})} as any);
  await assert.rejects(service.open('sftp',{port:5901}));
});
