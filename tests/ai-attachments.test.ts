import assert from 'node:assert/strict';
import {test} from 'node:test';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/core/store';
import {ConnectionRegistry} from '../src/core/connections/registry';
import {AiService} from '../src/core/ai';

test('uploaded image and file reach the model as content and survive reload', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cshell-attachments-'));
  const store=new Store(directory,{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()});
  const requests:any[]=[];
  const service=()=>{
    const ai=new AiService(directory,store,new ConnectionRegistry(()=>undefined));
    ai.requestTransport=async(_url,init)=>{
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({choices:[{message:{content:'received'}}]});
    };
    return ai;
  };
  let ai=service();
  const wait=async()=>{const until=Date.now()+5000;while(ai.hasActiveWork && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,15));assert.equal(ai.snapshot().threads[0].state,'idle',ai.snapshot().threads[0].error ?? 'expected idle');};
  try{
    const id=randomUUID();
    await ai.saveProvider({id,name:'test',model:'mock',url:'https://example.org/v1'},'test');
    const thread=await ai.create('workspace',id,'restricted');
    const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aSwAAAAASUVORK5CYII=';
    await ai.send(thread.id,'',undefined,[{name:'pixel.png',mime:'image/png',data},{name:'log.txt',mime:'text/plain',data:Buffer.from('文件正文').toString('base64')}]);
    await wait();await ai.flush();
    assert.ok(!JSON.stringify(ai.snapshot()).includes(data));
    ai.dispose();
    ai=service();await ai.load();
    await ai.send(thread.id,'继续',undefined,[{name:'second.txt',mime:'text/plain',data:Buffer.from('second file').toString('base64')}]);await wait();
    assert.equal(requests.length,2);
    for(const req of requests){
      const content=req.messages.find((m:any)=>Array.isArray(m.content)).content;
      assert.ok(content.some((p:any)=>p.image_url?.url==='data:image/png;base64,'+data));
      assert.ok(content.some((p:any)=>p.text?.includes('文件正文')));
    }
    assert.ok(JSON.stringify(requests[1].messages).includes('second file'));
    await ai.remove(thread.id);
    await assert.rejects(access(join(directory,'ai-attachments',thread.id)));
  }finally{await ai.flush();ai.dispose();await rm(directory,{recursive:true,force:true});}
});

