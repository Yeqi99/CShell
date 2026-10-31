import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {createHandler} from './worker.mjs';
const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));const handle=createHandler(manifest);const results=[];
for(const edition of ['opensource','pro']){
 const paths=Object.keys(manifest.files).filter(p=>p.includes('/'+edition+'/'));
 for(const path of [paths.find(p=>p.endsWith('SHA256SUMS.txt')),paths.find(p=>p.endsWith('-win-x64.exe'))]){
  const full=path.endsWith('SHA256SUMS.txt');const response=await handle(new Request('https://shell.canp.ai'+path,{headers:full?{}:{Range:'bytes=0-1023'}}));const bytes=Buffer.from(await response.arrayBuffer());if(response.status!==(full?200:206))throw Error('Live upstream '+response.status+' '+path+': '+bytes.toString());if(full&&'sha256:'+createHash('sha256').update(bytes).digest('hex')!==manifest.files[path].digest)throw Error('Digest mismatch');if(full){for(const line of bytes.toString().trim().split(/\r?\n/)){const match=/^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);if(!match)throw Error('Invalid checksums');const listed=paths.find(p=>manifest.files[p].name===match[2]);if(!listed||manifest.files[listed].digest!=='sha256:'+match[1])throw Error('GitHub digest disagrees with published SHA256SUMS');}}if(!full&&bytes.length!==1024)throw Error('Range length mismatch');results.push({path,status:response.status,bytes:bytes.length,noClientRedirect:!response.headers.has('location'),sha256Verified:full});
 }
}
await writeFile(new URL('./live-acceptance.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));
