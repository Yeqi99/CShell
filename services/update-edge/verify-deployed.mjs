import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url),m=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')),results=[];
async function get(path,range){const r=await fetch('https://shell.canp.ai'+path,{redirect:'manual',headers:range?{Range:'bytes=0-1023'}:{},signal:AbortSignal.timeout(60000)});if(r.status!==(range?206:200)||r.headers.has('location'))throw Error(`Unexpected status/redirect ${r.status}: ${path}`);return r;}
for(const edition of ['opensource','pro']){
 const p=`/downloads/${edition}/releases.json`,r=await get(p),catalog=await r.json();
 if(JSON.stringify(catalog)!==JSON.stringify(m.catalogs[p]))throw Error('Deployed catalog differs from verified release: '+edition);
 results.push({path:p,status:200,catalogVerified:true});
 for(const v of ['0.8.16','0.8.17']){
  const paths=Object.keys(m.files).filter(p=>p.startsWith(`/downloads/${edition}/v${v}/`));
  for(const path of [paths.find(p=>p.endsWith('/SHA256SUMS.txt')),paths.find(p=>p.endsWith('-win-x64.exe'))]){
   if(!path)throw Error('Missing pinned probe asset');const full=path.endsWith('.txt'),response=await get(path,!full),bytes=Buffer.from(await response.arrayBuffer());
   if(full&&(bytes.length!==m.files[path].size||'sha256:'+createHash('sha256').update(bytes).digest('hex')!==m.files[path].digest))throw Error('Checksum size/digest mismatch');
   if(!full&&(bytes.length!==1024||response.headers.get('content-range')!==`bytes 0-1023/${m.files[path].size}`))throw Error('Range mismatch');
   results.push({path,status:response.status,bytes:bytes.length,fullDigestVerified:full,noClientRedirect:true});
  }
 }
}
await writeFile(new URL('deployed-acceptance.json',root),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));
