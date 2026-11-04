import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const pkg=JSON.parse(await readFile('package.json','utf8'));
assert.equal(pkg.version,'1.0.0','Candidate must come from 1.0 source');
assert.equal(pkg.build.directories.output,'release/1.0.0');
const edition=process.env.CSHELL_EDITION||'opensource';
assert.ok(['opensource','pro'].includes(edition),'Unknown edition');
const gradle=await readFile('android/app/build.gradle','utf8');
assert.match(gradle,/versionCode releaseCode; versionName releaseVersion/);
assert.match(gradle,/versionParts\[0\] \* 1000000 \+ versionParts\[1\] \* 1000 \+ versionParts\[2\]/);
const androidCode=1000000;assert.ok(androidCode>8022);
const build=await readFile('scripts/agent-build.mjs','utf8');
assert.match(build,/__CSHELL_PRO__:\s*JSON\.stringify\(process\.env\.CSHELL_EDITION === 'pro'\)/);
assert.match(build,/edition: process\.env\.CSHELL_EDITION === 'pro' \? 'pro' : 'opensource'/);
const checks={
 'services/cloud-sync/bridges.py':['class Bridges','def register','def invoke'],
 'services/cloud-sync/server.py':['from bridges import Bridges',"'/v1/mcp/register'","'/v1/mcp/invoke'"],
 'services/cloud-sync/test_bridges.py':['unittest','Bridges'],
 'src/core/account-mcp-bridge.ts':['class AccountMcpBridge','accountBridge','/v1/mcp/register'],
 'src/desktop/cloud-sync.ts':['new AccountMcpBridge','before-quit'],
 'src/desktop/main.ts':['identityNetwork,()=>mcp??undefined'],
 'src/shared/contracts.ts':['accountBridge: z.object({clientId:z.string().uuid()})'],
 'src/ui/components/McpSettings.tsx':['draft.accountBridge?.clientId','accountBridge:e.target.value'],
 'tests/account-mcp-bridge.test.ts':['AccountMcpBridge'],
};
const reference=JSON.parse(await readFile('scripts/release-1.0-baseline.json','utf8'));
assert.equal(reference.files.length,9);
const baseline=[];
for(const [path,markers] of Object.entries(checks)){
 const current=await readFile(path,'utf8');for(const marker of markers)assert.ok(current.includes(marker),`${path}: missing ${marker}`);
 const prior=reference.files.find(file=>file.path===path);assert.ok(prior,`Unrecorded baseline file ${path}`);
 const sha=value=>createHash('sha256').update(value).digest('hex');
 baseline.push({path,baselineSha256:prior.sha256,currentSha256:sha(current),presenceChecked:true});
}
if(process.argv.includes('--agent')){
 const path=join('release',pkg.version,`agent-${process.platform}-${process.arch}`);
 const info=JSON.parse(await readFile(join(path,'build-info.json'),'utf8'));
 assert.equal(info.version,pkg.version);assert.equal(info.edition,edition);assert.equal(info.platform,process.platform);assert.equal(info.arch,process.arch);assert.equal(info.electron,false);
 const bundle=await readFile(join(path,'agent.cjs'),'utf8');
 if(edition==='pro')assert.ok(bundle.includes('/v1/devices/register'),'Pro account registration absent');
}
const evidence={version:pkg.version,edition,androidCode,baselineCommit:'9e227c4',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baseline,warning:'Markers and hashes prove presence only; run account bridge regression before candidate acceptance.'};
await mkdir('test-results/release-1.0',{recursive:true});
await writeFile(`test-results/release-1.0/preflight-${edition}.json`,JSON.stringify(evidence,null,2)+'\n');
console.log(`1.0 ${edition} preflight passed; Android versionCode ${androidCode}; ${baseline.length} bridge files checked${process.argv.includes('--agent')?'; staged Agent checked':''}`);
