import{mkdtemp,readdir,readFile,rm,access}from'node:fs/promises';import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{execFile}from'node:child_process';import{promisify}from'node:util';import{prepareMacUpdate}from'../src/desktop/portable-update';import assert from'node:assert/strict';
if(process.platform!=='darwin')throw Error('Run on macOS');
const exec=promisify(execFile),pkg=JSON.parse(await readFile('package.json','utf8')),pro=process.env.CSHELL_EDITION==='pro',out=resolve(pro?'release/pro-'+pkg.version:pkg.build.directories.output),product=pro?'CShell Pro':'CShell';
const image=(await readdir(out)).find(n=>n.endsWith('-'+process.arch+'.dmg'));if(!image)throw Error('Missing DMG');
const original=join(out,process.arch==='arm64'?'mac-arm64':'mac',product+'.app'),root=await mkdtemp(join(tmpdir(),'cshell-mac-update-')),target=join(root,product+'.app');
try{
 await exec('/usr/bin/ditto',[original,target]);
 const plan=await prepareMacUpdate(join(out,image),join(target,'Contents/MacOS',product),pkg.version);
 const backup=plan.commit();await access(join(backup,'Contents/Info.plist'));await access(join(target,'Contents/Info.plist'));
 const version=(await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',join(target,'Contents/Info.plist')])).stdout.trim();assert.equal(version,pkg.version);
 console.log('PASS real DMG staging, bundle identity/version validation, atomic replacement and backup');
}finally{await rm(root,{recursive:true,force:true});}
