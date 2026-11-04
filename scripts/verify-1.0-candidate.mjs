import assert from 'node:assert/strict';
import {readFile,access,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const pkg=JSON.parse(await readFile('package.json','utf8'));
assert.equal(pkg.version,'1.0.0');
assert.equal(process.env.CSHELL_EDITION,'opensource','Core checkout builds only open source');
for(const file of ['src/core/account-mcp-bridge.ts','services/cloud-sync/server.py','src/desktop/cloud-sync.ts']) {
 let exists=false;try{await access(file);exists=true;}catch{}assert.equal(exists,false,`Private Pro source present: ${file}`);
}
for(const file of ['scripts/build.mjs','scripts/agent-build.mjs'])assert.match(await readFile(file,'utf8'),/__CSHELL_PRO__:\s*"?false"?/);
if(process.argv.includes('--agent')) {
 const path=join('release',pkg.version,`agent-${process.platform}-${process.arch}`);
 const info=JSON.parse(await readFile(join(path,'build-info.json'),'utf8'));
 assert.equal(info.version,pkg.version);assert.equal(info.edition,'opensource');assert.equal(info.platform,process.platform);assert.equal(info.arch,process.arch);
}
await mkdir('test-results/release-1.0',{recursive:true});
await writeFile('test-results/release-1.0/preflight-opensource.json',JSON.stringify({version:pkg.version,edition:'opensource',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),privateSourceAbsent:true}));
console.log('Core 1.0 source and edition preflight passed');
