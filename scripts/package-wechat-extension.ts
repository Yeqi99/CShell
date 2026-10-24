import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,sign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {wechatManifest} from '../src/extensions/wechat/manifest';
import {parseCustomExtension} from '../src/core/custom-extensions';

const runtime=resolve(process.argv[2]??''),key=process.env.CSHELL_EXTENSION_SIGNING_KEY;
if(!process.argv[2]||!key)throw new Error('Usage: CSHELL_EXTENSION_SIGNING_KEY=<private key path> tsx scripts/package-wechat-extension.ts <verified runtime directory>');
const output=resolve('release/custom-extensions');await mkdir(output,{recursive:true});
const bundle=await build({entryPoints:['src/extensions/wechat/entry.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',write:false});
const files:{path:string;sha256:string;data:string}[]=[];
const add=(path:string,bytes:Buffer)=>files.push({path,sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')});
add('adapter.cjs',Buffer.from(bundle.outputFiles[0].contents));
const expected=JSON.parse(await readFile(join(runtime,'files.json'),'utf8')) as Record<string,string>;
for(const path of Object.keys(expected).sort()){
  if(!path||path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid runtime path');
  const bytes=await readFile(join(runtime,path));if(createHash('sha256').update(bytes).digest('hex')!==expected[path])throw new Error('Runtime checksum mismatch: '+path);add('runtime/'+path,bytes);
}
add('runtime/files.json',Buffer.from(JSON.stringify(expected)));
const signed={format:'cshell-extension-1',manifest:wechatManifest,files:files.map(({path,sha256})=>({path,sha256}))};
const pack={...signed,files,signature:sign(null,Buffer.from(JSON.stringify(signed)),await readFile(key)).toString('base64')};
const text=JSON.stringify(pack);parseCustomExtension(text);
const target=join(output,`WeChat-${wechatManifest.version}-win-x64.cshellext`),bytes=gzipSync(text,{level:6});await writeFile(target,bytes);await writeFile(target+'.sha256',createHash('sha256').update(bytes).digest('hex')+'\n');
console.log(JSON.stringify({file:target,bytes:bytes.length,files:files.length}));
