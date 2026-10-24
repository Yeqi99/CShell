import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCustomExtension,installCustomExtension} from '../src/core/custom-extensions';
import {builtinPlugins} from '../src/shared/plugins';
const manifest={protocol:1,id:'example.commands',version:'1.0.0',name:'我的命令',description:'手动填入终端',publisher:'Example',provider:'snippets',permissions:['terminal.input'],commands:[{label:'列出文件',text:'ls -la'}]};
const pack=(patch:Record<string,unknown>={})=>JSON.stringify({format:'cshell-extension-1',manifest,files:[],...patch});
test('private WeChat is absent from public built-in catalog',()=>assert.equal(builtinPlugins.some(p=>p.provider==='wechat'),false));
test('declarative local extension preserves commands without executing or granting access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cshell-ext-'));
 try{const parsed=parseCustomExtension(pack());assert.equal(parsed.trusted,false);const installed=await installCustomExtension(parsed,root);assert.equal(installed.id,manifest.id);assert.deepEqual(installed.commands,manifest.commands);const pointer=JSON.parse(await readFile(join(root,manifest.id,'current.json'),'utf8'));assert.match(pointer.directory,/^[a-f0-9-]+$/);}finally{await rm(root,{recursive:true,force:true});}
});
test('rejects reserved providers, excessive permissions and executable payloads',()=>{
 for(const changed of [{id:'cshell.commands'},{provider:'wechat',id:'cshell.wechat'},{permissions:['remote.execute']}])assert.throws(()=>parseCustomExtension(pack({manifest:{...manifest,...changed}})));
 assert.throws(()=>parseCustomExtension(pack({files:[{path:'entry.js',data:'',sha256:'0'.repeat(64)}]})));
});
test('rejects traversal, ambiguous Windows names and duplicate paths before extraction',()=>{
 for(const path of ['../bad','C:/bad','/bad','foo\\bad','CON','dir/..','dir/file.','dir/file '])assert.throws(()=>parseCustomExtension(pack({files:[{path,sha256:'0'.repeat(64),data:''}]})));
});
test('invalid signature never authorizes a native provider',()=>assert.throws(()=>parseCustomExtension(pack({manifest:{...manifest,id:'cshell.wechat',provider:'wechat'},signature:'AA=='}))));
