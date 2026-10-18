import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Only synthetic native encoder output is decoded; no user desktop is read.
const bytes=await readFile('test-results/cagent-desktop-fixture.h264');
const manifest=JSON.parse(await readFile('test-results/cagent-desktop-fixture.h264.json','utf8'));
let offset=0;
const chunks=manifest.map((entry:any)=>{const data=bytes.subarray(offset,offset+entry.size);offset+=entry.size;return {...entry,data:[...data]};});
assert.equal(offset,bytes.length);
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Codec fixture</title>');});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.addInitScript("globalThis.__name = (fn) => fn");await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
 const result=await page.evaluate(async(chunks:any[])=>{
  const Decoder=(globalThis as any).VideoDecoder, Chunk=(globalThis as any).EncodedVideoChunk;
  const config={codec:'avc1.4d001e',codedWidth:640,codedHeight:360,optimizeForLatency:true};
  const supported=await Decoder.isConfigSupported(config);if(!supported.supported)throw new Error('H264 WebCodecs decoder unavailable');
  const frames:any[]=[],errors:string[]=[];
  const decoder=new Decoder({output:(frame:any)=>{frames.push({width:frame.displayWidth,height:frame.displayHeight,timestamp:frame.timestamp});frame.close();},error:(error:Error)=>errors.push(error.message)});
  decoder.configure(config);
  for(const chunk of chunks)decoder.decode(new Chunk({type:chunk.key?'key':'delta',timestamp:chunk.timestamp,data:new Uint8Array(chunk.data)}));
  await decoder.flush();decoder.close();return {frames,errors};
 },chunks);
 assert.deepEqual(result.errors,[]);assert.equal(result.frames.length,30);
 assert.ok(result.frames.every((f:any)=>f.width===640&&f.height===360));
 assert.deepEqual(result.frames.map((f:any)=>f.timestamp),manifest.map((f:any)=>f.timestamp));
 await writeFile('test-results/cagent-desktop-codec.json',JSON.stringify({fixture:true,encodedBytes:bytes.length,...result},null,2));
 console.log('PASS native H264 -> WebCodecs: 30 synthetic frames, dimensions and timestamp order');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
