import {writeFile,readFile} from 'node:fs/promises';
const root=new URL('./',import.meta.url),prefix='https://shell.canp.ai/downloads/';
const manifest={version:'0.8.16',generatedAt:new Date().toISOString(),files:{},catalogs:{}};
for(const [edition,tag,count] of [['opensource','v0.8.16',16],['pro','pro-v0.8.16',14]]){
 const response=await fetch('https://api.github.com/repos/Yeqi99/CShell/releases/tags/'+tag,{headers:{'User-Agent':'CShell-update-edge'},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Public GitHub API '+response.status);
 const release=await response.json();if(release.draft||release.prerelease||release.tag_name!==tag||release.assets.length!==count)throw Error('Unexpected release');
 const assets=[];
 for(const a of release.assets){
  if(!/^[A-Za-z0-9_.-]+$/.test(a.name)||!Number.isSafeInteger(a.size)||a.size<1||!/^sha256:[a-f0-9]{64}$/.test(a.digest))throw Error('Unverified asset metadata');
  const github='https://github.com/Yeqi99/CShell/releases/download/'+tag+'/'+a.name;if(a.browser_download_url!==github)throw Error('Unexpected public asset URL');
  const path='/downloads/'+edition+'/v0.8.16/'+a.name;manifest.files[path]={url:github,size:a.size,digest:a.digest,name:a.name};assets.push({name:a.name,size:a.size,digest:a.digest,browser_download_url:'https://shell.canp.ai'+path});
 }
 manifest.catalogs['/downloads/'+edition+'/releases.json']=[{tag_name:'v0.8.16',name:edition==='pro'?'CShell Pro 0.8.16':'CShell 0.8.16',draft:false,prerelease:false,published_at:release.published_at,html_url:'https://shell.canp.ai/downloads.html',assets}];
}
await writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2));
const source=await readFile(new URL('worker.mjs',root),'utf8');const code=source+'\nconst MANIFEST='+JSON.stringify(manifest)+';\nexport default {fetch:createHandler(MANIFEST)};\n';
await writeFile(new URL('deployment.json',root),JSON.stringify({name:'cshell-update-emergency',routes:['shell.canp.ai/downloads/opensource/releases.json','shell.canp.ai/downloads/pro/releases.json','shell.canp.ai/downloads/opensource/v0.8.16/*','shell.canp.ai/downloads/pro/v0.8.16/*'],compatibility_date:'2026-10-01',code,manifest},null,2));
console.log(JSON.stringify({files:Object.keys(manifest.files).length,catalogs:Object.keys(manifest.catalogs),bytes:Buffer.byteLength(code)}));
