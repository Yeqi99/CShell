import {readFile} from 'node:fs/promises';
const version=process.env.CSHELL_RELEASE_VERSION;
if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('Release version required');
const plans=await Promise.all(['opensource','pro'].map(async e=>JSON.parse(await readFile(`services/update-edge/verified-${e}-${version.replaceAll('.','')}.json`,'utf8'))));
const pending=plans.flatMap(p=>p.assets.map(a=>({...a,url:`https://shell.canp.ai/downloads/${p.edition}/v${version}/${a.name}`})));
const deadline=Date.now()+30*60_000;
while(pending.length&&Date.now()<deadline){
 for(let i=pending.length-1;i>=0;i--){const a=pending[i];try{const r=await fetch(a.url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(10000)});if(r.status===200&&Number(r.headers.get('content-length'))===a.size)pending.splice(i,1);}catch{}}
 console.log(`${pending.length} release files still awaiting origin readiness`);
 if(pending.length)await new Promise(r=>setTimeout(r,15000));
}
if(pending.length)throw Error('Origin not ready within publication deadline');
console.log('Origin sizes ready; full byte and digest verification follows');
