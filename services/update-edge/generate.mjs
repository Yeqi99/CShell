import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('./',import.meta.url);
export function mergeRelease(previous,releases){
 const manifest=structuredClone(previous);manifest.version='0.8.17';manifest.generatedAt=new Date().toISOString();
 for(const edition of ['opensource','pro']){
  const tag=edition==='pro'?'pro-v0.8.17':'v0.8.17',release=releases[edition];
  const old=Object.entries(previous.files).filter(([p])=>p.startsWith(`/downloads/${edition}/v0.8.16/`));
  const expected=new Set(old.map(([,a])=>a.name.replaceAll('0.8.16','0.8.17').replace('CShell-0.8.17-android-test.apk','CShell-0.8.17-android.apk')));
  if(!release||release.draft||release.prerelease||release.tag_name!==tag||!release.published_at||release.assets.length!==expected.size)throw Error('Release not public/complete: '+edition);
  const assets=[];
  for(const a of release.assets){
   if(!expected.delete(a.name)||!Number.isSafeInteger(a.size)||a.size<1||!/^sha256:[a-f0-9]{64}$/.test(a.digest))throw Error('Unexpected/duplicate/unverified asset');
   const url=`https://github.com/Yeqi99/CShell/releases/download/${tag}/${a.name}`;
   if(a.browser_download_url!==url)throw Error('Unexpected asset source');
   const path=`/downloads/${edition}/v0.8.17/${a.name}`;
   manifest.files[path]={url,size:a.size,digest:a.digest,name:a.name};
   assets.push({name:a.name,size:a.size,digest:a.digest,browser_download_url:'https://shell.canp.ai'+path});
  }
  manifest.catalogs[`/downloads/${edition}/releases.json`]=[{tag_name:'v0.8.17',name:`CShell${edition==='pro'?' Pro':''} 0.8.17`,draft:false,prerelease:false,published_at:release.published_at,html_url:'https://shell.canp.ai/downloads.html',assets}];
 }
 return manifest;
}
async function main(){
 if(!process.argv.includes('--released'))throw Error('Only run with --released after both releases are public; this does not deploy.');
 const previous=JSON.parse(await readFile(new URL('previous-manifest.json',root),'utf8')),releases={};
 for(const edition of ['opensource','pro']){
  const tag=edition==='pro'?'pro-v0.8.17':'v0.8.17';
  const r=await fetch(`https://api.github.com/repos/Yeqi99/CShell/releases/tags/${tag}`,{headers:{'User-Agent':'CShell-update-edge'},signal:AbortSignal.timeout(30000)});
  if(r.status!==200)throw Error('Public release unavailable: '+r.status);releases[edition]=await r.json();
 }
 for(const edition of ['opensource','pro']){const expected=JSON.parse(await readFile(new URL('verified-'+edition+'-0817.json',root),'utf8'));if(releases[edition].target_commitish!==expected.sha)throw Error('Final source changed');for(const a of releases[edition].assets){const e=expected.assets.find(e=>e.name===a.name);if(!e||a.size!==e.size||a.digest!=='sha256:'+e.sha256)throw Error('Final package differs from verified manifest');}}
 const manifest=mergeRelease(previous,releases);
 // Require the actual published SHA256SUMS body to agree with every API digest.
 const {createHandler}=await import('./worker.mjs');const handler=createHandler(manifest);
 for(const edition of ['opensource','pro']){
  const prefix=`/downloads/${edition}/v0.8.17/`,path=prefix+'SHA256SUMS.txt',r=await handler(new Request('https://shell.canp.ai'+path));
  if(r.status!==200)throw Error('Checksum body unavailable');const b=Buffer.from(await r.arrayBuffer());
  if('sha256:'+createHash('sha256').update(b).digest('hex')!==manifest.files[path].digest)throw Error('Checksum body digest mismatch');
  const pending=new Set(Object.keys(manifest.files).filter(p=>p.startsWith(prefix)&&p!==path));
  for(const line of b.toString().trim().split(/\r?\n/)){const m=/^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);if(!m||!pending.delete(prefix+m[2])||manifest.files[prefix+m[2]].digest!=='sha256:'+m[1])throw Error('Checksum list mismatch');}
  if(pending.size)throw Error('Checksum list incomplete');
 }
 const source=await readFile(new URL('worker.mjs',root),'utf8');const code=source+'\nconst MANIFEST='+JSON.stringify(manifest)+';\nexport default {fetch:createHandler(MANIFEST)};\n';
 const routes=['opensource','pro'].flatMap(e=>[`shell.canp.ai/downloads/${e}/releases.json`,...['0.8.16','0.8.17'].map(v=>`shell.canp.ai/downloads/${e}/v${v}/*`)]);
 await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));await writeFile(new URL('deployment.json',root),JSON.stringify({name:'cshell-update-emergency',compatibility_date:'2026-10-01',routes,code,manifest},null,2));
 console.log(JSON.stringify({files:Object.keys(manifest.files).length,routes,codeSha256:createHash('sha256').update(code).digest('hex')}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
