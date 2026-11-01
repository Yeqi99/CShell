import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {LocalClipboard,decodeDropFiles,encodeDropFiles} from '../src/desktop/local-clipboard';
test('clipboard file tokens read only chosen files and downloads commit only complete files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clipboard-test-'));try{
 const file=join(dir,'选中文件.txt');await writeFile(file,'hello');let written:Buffer=Buffer.alloc(0);
 const service=new LocalClipboard({text:()=>'',png:()=>Buffer.alloc(0),files:()=>encodeDropFiles([file]),writeText:()=>{},writePng:()=>{},writeFiles:data=>{written=data;}},join(dir,'cache'),true);
 const snapshot=await service.read();assert.equal(snapshot.kind,'files');if(snapshot.kind!=='files')throw Error('files');
 assert.equal(Buffer.from(await service.fileRead(snapshot.files[0].token,0,5),'base64').toString(),'hello');
 await assert.rejects(service.fileRead(file,0,5));
 const id=await service.begin([{name:'received.txt',size:5}]);await assert.rejects(service.commit(id));
 await assert.rejects(service.chunk(id,0,1,Buffer.from('hello').toString('base64')));
 await service.chunk(id,0,0,Buffer.from('hello').toString('base64'));await service.commit(id);
 assert.equal(decodeDropFiles(written).length,1);assert.ok(decodeDropFiles(written)[0].startsWith(join(dir,'cache')));
 await assert.rejects(service.begin([{name:'../escape',size:0}]));await assert.rejects(service.begin([{name:'CON.txt',size:0}]));
 }finally{await rm(dir,{recursive:true,force:true});}
});
