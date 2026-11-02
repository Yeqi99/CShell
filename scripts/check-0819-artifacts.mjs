import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const [edition,directory,source]=process.argv.slice(2);
assert(['opensource','pro'].includes(edition),'Usage: node scripts/check-0819-artifacts.mjs <opensource|pro> <artifact-directory> <source-sha>');
assert(directory&&/^[a-f0-9]{40}$/.test(source??''),'Exact source SHA and artifact directory required');
const plan=JSON.parse(await readFile(new URL('../docs/release-evidence/PLAN-0.8.19.json',import.meta.url),'utf8'));
const channel=plan.channels.find(c=>c.edition===edition),dir=resolve(directory),names=await readdir(dir);
assert.deepEqual([...names].sort(),[...channel.assets].sort(),'Artifact directory must contain exactly the planned channel files');
const assets=[];
for(const name of channel.assets){const path=join(dir,name),s=await stat(path);assert(s.isFile()&&s.size>0,'Missing/empty artifact '+name);const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);assets.push({name,size:s.size,sha256:h.digest('hex')});}
const sums=(await readFile(join(dir,'SHA256SUMS.txt'),'utf8')).trim().split(/\r?\n/),pending=new Map(assets.filter(a=>a.name!=='SHA256SUMS.txt').map(a=>[a.name,a.sha256]));
for(const line of sums){const m=/^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);assert(m&&pending.get(m[2])===m[1],'Unexpected/mismatched checksum line');pending.delete(m[2]);}assert.equal(pending.size,0,'Incomplete SHA256SUMS');
console.log(JSON.stringify({version:plan.version,edition,tag:channel.tag,sha:source,status:'inventory-only-awaiting-build-and-runtime-evidence',note:'File hashes only; does not attest source provenance, signing or native runtime tests; no network, writes, tags or publication.',assets},null,2));
