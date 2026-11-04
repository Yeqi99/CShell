/** Repackage verified existing binaries; does not publish or change trusted catalog. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {managedWechatCatalog} from '../src/agent/managed-wechat-catalog';
import {capabilityDigest} from '../src/agent/capability-catalog';
import {parseCapabilityManifest} from '../src/agent/capability-packages';

async function main(){
 const [source,destination]=process.argv.slice(2);if(!source||!destination)throw Error('Usage: tsx scripts/prepare-wechat-1.0.ts <verified-existing-bundles> <candidate-output>');
 await mkdir(destination,{recursive:true});const candidates=[];
 for(const entry of managedWechatCatalog){
  const data=await readFile(join(source,basename(new URL(entry.url!).pathname)));
  if(data.length!==entry.bundleBytes||capabilityDigest(data)!==entry.bundleSha256)throw Error('Existing bundle mismatch: '+entry.id);
  const bundle=JSON.parse(data.toString('utf8'));
  const manifest=parseCapabilityManifest(bundle.manifest,entry.manifestSha256);
  if(Object.keys(bundle.files).length!==manifest.files.length)throw Error('Unexpected bundle files');
  for(const file of manifest.files){const bytes=Buffer.from(bundle.files[file.path],'base64');if(bytes.length!==file.bytes||capabilityDigest(bytes)!==file.sha256)throw Error('Binary mismatch: '+file.path);}
  const fileName=basename(new URL(entry.url!).pathname).replace('0.1.2','0.1.3');
  manifest.version='0.1.3';manifest.compatibility.agentVersion={min:'0.8.17',maxExclusive:'1.1.0'};
  manifest.source.releaseTag='wechat-toolkit-v0.1.3';manifest.source.assetUrl='https://github.com/Yeqi99/CShell/releases/download/wechat-toolkit-v0.1.3/'+fileName;
  const manifestJson=JSON.stringify(manifest);parseCapabilityManifest(manifestJson,capabilityDigest(manifestJson));
  const output=Buffer.from(JSON.stringify({...bundle,manifest:manifestJson}));
  await writeFile(join(destination,fileName),output,{flag:'wx'});
  candidates.push({...entry,version:manifest.version,url:manifest.source.assetUrl,manifestJson,manifestSha256:capabilityDigest(manifestJson),bundleSha256:capabilityDigest(output),bundleBytes:output.length});
 }
 await writeFile(join(destination,'candidate-catalog.json'),JSON.stringify(candidates,null,2),{flag:'wx'});
 console.log('Prepared candidates only. Run 1.0 install/tool regression before publishing or replacing the catalog.');
}
void main().catch(e=>{console.error(e.message);process.exitCode=1;});
