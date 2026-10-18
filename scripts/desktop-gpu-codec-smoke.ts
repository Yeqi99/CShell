import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Only synthetic native encoder output is decoded; no user desktop is read.
const fixture=process.argv[2]??'test-results/cagent-desktop-gpu-colors.h264';
const bytes=await readFile(fixture);
const manifest=JSON.parse(await readFile(fixture+'.json','utf8'));
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
  const frames:any[]=[],errors:string[]=[]; const canvas=document.createElement("canvas");canvas.width=640;canvas.height=360;const context=canvas.getContext("2d")!;
  const decoder=new Decoder({output:(frame:any)=>{context.drawImage(frame,0,0);frames.push({width:frame.displayWidth,height:frame.displayHeight,timestamp:frame.timestamp,colorSpace:frame.colorSpace.toJSON(),rgb:[...context.getImageData(320,180,1,1).data].slice(0,3)});frame.close();},error:(error:Error)=>errors.push(error.message)});
  decoder.configure(config);
  for(const chunk of chunks)decoder.decode(new Chunk({type:chunk.key?'key':'delta',timestamp:chunk.timestamp,data:new Uint8Array(chunk.data)}));
  await decoder.flush();decoder.close();return {frames,errors};
 },chunks);
 assert.deepEqual(result.errors,[]);assert.equal(result.frames.length,30);
 assert.ok(result.frames.every((f:any)=>f.width===640&&f.height===360));
 assert.deepEqual(result.frames.map((f:any)=>f.timestamp),manifest.map((f:any)=>f.timestamp));
 await writeFile(fixture+'.diagnostic.json',JSON.stringify(result,null,2));
 for(let i=0;i<result.frames.length;i++)for(let c=0;c<3;c++)assert.ok(Math.abs(result.frames[i].rgb[c]-manifest[i].rgb[c])<=8,JSON.stringify({index:i,expected:manifest[i].rgb,actual:result.frames[i].rgb}));
 await writeFile(fixture+'.decoded.json',JSON.stringify({fixture:true,encodedBytes:bytes.length,...result},null,2));
 console.log('PASS native H264 -> WebCodecs: 30 synthetic frames, RGB color tolerance, dimensions and timestamp order');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
