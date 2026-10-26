import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const file = resolve('scripts/classroom/Install-DL-Lab.ps1');
const win = process.platform === 'win32';
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
function ps(code: string) { return spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')], {encoding:'utf8',timeout:20000}); }
test('DL independent task is bounded, pinned CPU and only bootstraps a private conda', async () => {
 const s=await readFile(file,'utf8');assert.ok(Buffer.byteLength(s)<16384);
 for(const pin of ['tensorflow==2.15.1','numpy==1.26.4','pandas==2.2.3','matplotlib==3.9.4','jupyter==1.1.1','python=3.10'])assert.ok(s.includes(pin));
 assert.ok(s.indexOf("GetFolderPath('DesktopDirectory')")<s.indexOf("Env 'USERPROFILE'"));
 assert.ok(s.indexOf('Get-FileHash')<s.indexOf('Run $installer'));
 assert.match(s,/--prefix/);assert.doesNotMatch(s,/conda (update|install) /);
 assert.match(s,/--ServerApp.ip=127\.0\.0\.1/);assert.match(s,/JUPYTER_TOKEN=\[Guid\]/);
 assert.match(s,/Run \$python '-I -m pip check'/);
});
test('PowerShell parses and preview or insufficient space never creates target; existing dl refused', {skip:!win}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dl-preview-'));
 try {
  const target=join(dir,'new dl'), old=join(dir,'missing base');
  const result=ps(`$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile(${quote(file)},[ref]$t,[ref]$e);if($e){throw ($e|Out-String)};& ${quote(file)} -Root ${quote(target)} -LabRoot ${quote(old)}`);
  assert.match(result.stdout,/"bootstrap":\s*true/);
  if(result.status!==0)assert.match(result.stderr,/Insufficient space/);
  await assert.rejects(access(target));
  await mkdir(target);await writeFile(join(target,'keep.txt'),'keep');
  assert.notEqual(ps(`& ${quote(file)} -Root ${quote(target)} -LabRoot ${quote(old)} -Apply`).status,0);
  assert.equal(await readFile(join(target,'keep.txt'),'utf8'),'keep');
  for(const suffix of ['bad&run','bad%PATH%','bad!x'])assert.notEqual(ps(`& ${quote(file)} -Root ${quote(join(dir,suffix))}`).status,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real shortcut generation preserves spaces and Chinese paths without opening programs', {skip:!win}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dl-links-'));
 try{
  const root=join(dir,'中文 teaching lab'), desktop=join(dir,'fixture desktop');await mkdir(root);await mkdir(desktop);
  const source=await readFile(file,'utf8');
  const chunk=source.slice(source.indexOf(" $cmd=Join-Path $rootPath 'Start-dl.cmd'"),source.indexOf(" @{format='cshell-dl-lab-1';root=$rootPath;prefix="));
  assert.ok(chunk.length>100);
  const result=ps(`$ErrorActionPreference='Stop';$rootPath=${quote(root)};$desktop=${quote(desktop)};$base=Join-Path $rootPath 'Anaconda3';$envPath=Join-Path $rootPath 'envs\\dl';$notebooks=Join-Path $rootPath 'notebooks';New-Item -ItemType Directory $notebooks|Out-Null;${chunk};$a=$shell.CreateShortcut($cmdShortcut);$b=$shell.CreateShortcut($webShortcut);@{cmd=$a.Arguments;web=$b.Arguments}|ConvertTo-Json`);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Start-dl/);
  const cmd=await readFile(join(root,'Start-dl.cmd'),'utf8');assert.ok(cmd.includes(root));assert.ok(!cmd.startsWith('\ufeff'));assert.match(cmd,/activate "/);
  const launch=join(root,'Start-dl-Jupyter.ps1');
  const syntax=ps(`$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile(${quote(launch)},[ref]$t,[ref]$e);if($e){throw ($e|Out-String)}`);assert.equal(syntax.status,0,syntax.stderr);
  assert.match(await readFile(launch,'utf8'),/open_browser=True/);
  const mock=join(root,'mock-jupyter.ps1');
  const launcher=await readFile(launch,'utf8');
  await writeFile(mock,"function Capture { $args | ConvertTo-Json; if($env:JUPYTER_TOKEN.Length -ne 64){throw 'Missing auth token'} };$global:LASTEXITCODE=0;\n"+launcher.replace("& (Join-Path $PSScriptRoot 'envs\\dl\\python.exe')",'Capture'));
  const argv=ps(`& ${quote(mock)}`);assert.equal(argv.status,0,argv.stderr);
  assert.ok(JSON.parse(argv.stdout).includes('--ServerApp.root_dir='+join(root,'notebooks')));
  await mkdir(join(root,'Anaconda3','condabin'),{recursive:true});
  await writeFile(join(root,'Anaconda3','condabin','conda.bat'),'@set "DL_TEST_ACTIVE=1"\r\n@exit /b 0\r\n');
  const activation=spawnSync('cmd.exe',['/d','/v:on','/c',`call "${join(root,'Start-dl.cmd')}" && echo DL_ACTIVE=!DL_TEST_ACTIVE!`],{encoding:'utf8',timeout:15000,windowsVerbatimArguments:true});
  assert.equal(activation.status,0,activation.stderr);assert.match(activation.stdout,/DL_ACTIVE=1/);
 }finally{await rm(dir,{recursive:true,force:true});}
});


