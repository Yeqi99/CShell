import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const file=resolve('scripts/classroom/Test-Classroom-Network.ps1');
test('diagnostic status uses a typed allowlist and has no mutation operations',async()=>{
 const source=await readFile(file,'utf8');
 assert.doesNotMatch(source,/Set-Net|New-NetFirewall|Stop-Process|\.Kill\(|call .*configure/);
 const start=source.indexOf('function SafeStatus('),end=source.indexOf('$report.ipv4=');
 const fn=source.slice(start,end);
 if(process.platform==='win32'){
  const code=fn+`;$v='{"running":true,"passwordConfigured":true,"port":24443,"bind":"0.0.0.0","agentVersion":"0.8.11","token":"SECRET","key":"SECRET","peers":["SECRET"]}'|ConvertFrom-Json;SafeStatus $v|ConvertTo-Json`;
  const r=spawnSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/SECRET|peers|token|key/);assert.equal(JSON.parse(r.stdout).port,24443);
 }
});
test('real read-only diagnostic saves a bounded report and never prints raw status', {skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'classroom-net-'));
 try{
  const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file,'-OutputDirectory',dir],{encoding:'utf8',timeout:45000});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Read-only report saved:/);
  const files=await readdir(dir);assert.equal(files.length,1);
  const text=await readFile(join(dir,files[0]),'utf8');const report=JSON.parse(text.replace(/^\uFEFF/,''));
  assert.equal(report.readOnly,true);assert.ok(report.ipv4);assert.ok(report.udp47884);assert.ok(report.cshell);
  assert.ok(Buffer.byteLength(text)<1048576);
 }finally{await rm(dir,{recursive:true,force:true});}
});
