import {readdir,stat,writeFile,rename,rmdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const expected=['CShell-Pro-0.8.22-win-x64.exe','CShell-Pro-0.8.22-mac-arm64.dmg','CShell-Pro-0.8.22-mac-x64.dmg',
 'CShell-Pro-0.8.22-linux-amd64.deb','CShell-Pro-0.8.22-linux-arm64.deb',
 'CShell-Pro-0.8.22-linux-arm64.AppImage','CShell-Pro-0.8.22-linux-x86_64.AppImage'].sort();
const rootEntries=(await readdir('candidates')).sort();
if(rootEntries.length===1 && rootEntries[0]==='pro-0.8.22') {
 assert.deepEqual((await readdir('candidates/pro-0.8.22')).sort(),expected);
 for(const name of expected) await rename('candidates/pro-0.8.22/'+name,'candidates/'+name);
 await rmdir('candidates/pro-0.8.22');
}
assert.deepEqual((await readdir('candidates')).sort(),expected);
const assets=[];
for(const name of expected){const path='candidates/'+name;const size=(await stat(path)).size;assert(size>1000000);
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 assets.push({name,size,sha256:hash.digest('hex')});}
await writeFile('candidates/SHA256SUMS.txt',assets.map(a=>a.sha256+'  '+a.name).join('\n')+'\n');
await writeFile('candidates/account-bridge-release.json',JSON.stringify({version:'0.8.22',edition:'pro',source:'5b00e3213b52a44076ebc50032f7739d7b975209',assets},null,2));
console.log('Verified 7 desktop payloads; Android and CAgent remain on 0.8.21.');
