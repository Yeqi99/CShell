import { createPublicKey, sign, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function validateManifest(m) {
 if (!m || !/^\d+\.\d+\.\d+$/.test(m.version) || !m.files || !m.catalogs) throw Error('Invalid manifest');
 if (Object.keys(m.files).length > 10000) throw Error('Manifest too large');
 for (const [path,a] of Object.entries(m.files)) {
  const match=/^\/downloads\/(opensource|pro)\/v(\d+\.\d+\.\d+)\/([^/]+)$/.exec(path);
  if (!match || !/^(?:CAgent[-\w.]+\.(?:exe|tar\.gz)|CShell[-\w.]+\.(?:exe|dmg|zip|deb|AppImage|apk)|SHA256SUMS\.txt)$/.test(match[3])) throw Error('Invalid asset path');
  const tag=(match[1]==='pro'?'pro-v':'v')+match[2];
  if(a.name!==match[3] || a.url!==`https://github.com/Yeqi99/CShell/releases/download/${tag}/${a.name}` || !Number.isSafeInteger(a.size) || a.size<=0 || !/^sha256:[a-f0-9]{64}$/.test(a.digest))throw Error('Invalid asset identity');
 }
 for(const [path,rows]of Object.entries(m.catalogs)) {
  const edition=/^\/downloads\/(opensource|pro)\/releases\.json$/.exec(path)?.[1];
  if(!edition || !Array.isArray(rows) || rows.length!==1 || rows[0].tag_name!=='v'+m.version || rows[0].draft || rows[0].prerelease)throw Error('Invalid catalog');
  const names=new Set();for(const a of rows[0].assets){const p=`/downloads/${edition}/v${m.version}/${a.name}`,pinned=m.files[p];if(names.has(a.name)||!pinned||a.browser_download_url!=='https://shell.canp.ai'+p||a.size!==pinned.size||a.digest!==pinned.digest)throw Error('Unpinned catalog asset');names.add(a.name);}
  if(names.size!==Object.keys(m.files).filter(p=>p.startsWith(`/downloads/${edition}/v${m.version}/`)).length)throw Error('Incomplete catalog');
 }
 if(Object.keys(m.catalogs).length!==2)throw Error('Both catalogs required');return m;
}
export function signManifest(manifest,privateKey,now=Date.now()) {
 validateManifest(manifest);const key=createPublicKey(privateKey);if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 required');
 const payload=Buffer.from(JSON.stringify({issuedAt:new Date(now).toISOString(),manifest}));
 return {algorithm:'Ed25519',payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')};
}
export function verifyManifest(envelope,publicKey,{minimumVersion='0.0.0',now=Date.now()}={}) {
 if(envelope.algorithm!=='Ed25519'||typeof envelope.payload!=='string'||envelope.payload.length>8_000_000)throw Error('Invalid envelope');
 const payload=Buffer.from(envelope.payload,'base64');if(!verify(null,payload,publicKey,Buffer.from(envelope.signature||'','base64')))throw Error('Signature rejected');
 const data=JSON.parse(payload);const issued=Date.parse(data.issuedAt);if(!Number.isFinite(issued)||issued>now+300000)throw Error('Invalid issue time');
 const m=validateManifest(data.manifest);if(m.version.localeCompare(minimumVersion,undefined,{numeric:true})<0)throw Error('Manifest rollback');return m;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,keyPath,output]=process.argv.slice(2);if(!input||!keyPath||!output)throw Error('Usage: signed-manifest.mjs manifest.json private-key.pem signed-manifest.json');
 const manifest=JSON.parse(await readFile(input,'utf8'));const key=await readFile(keyPath);await writeFile(output,JSON.stringify(signManifest(manifest,key)));console.log('Signed verified manifest '+manifest.version+'; private key not emitted');
}
