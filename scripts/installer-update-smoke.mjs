import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
const {getMakeNsisPath}=builder('app-builder-lib/out/toolsets/windows');
const tool=await getMakeNsisPath(),root=await mkdtemp(join(tmpdir(),'cshell-installer-update-'));
for(const agent of [false,true]){
 const script=join(root,agent?'agent.nsi':'desktop.nsi');
 await writeFile(script,'\ufeff'+`Unicode true
!include "MUI2.nsh"
!define VERSION "0.8.17"
!define PRODUCT_NAME "${agent?'CAgent':'CShell'}"
${agent?'!define CAGENT_INSTALLER':'!define APP_EXECUTABLE_FILENAME "CShell.exe"'}
Name "Fixture"
OutFile "${join(root,agent?'agent.exe':'desktop.exe')}"
RequestExecutionLevel user
!include "${resolve('scripts/windows-deployment/installer-update-page.nsh')}"
${agent?'Page custom ShowInstallSummary':'!insertmacro customPageAfterChangeDir'}
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Section
SectionEnd
`);
 const p=spawnSync(tool.path,['/V2',script],{env:{...process.env,...tool.env},encoding:'utf8',windowsHide:true});assert.equal(p.status,0,p.stdout+p.stderr);
}
const deployment=join(root,'deployment');await mkdir(deployment);
await writeFile(join(deployment,'deployment.json'),JSON.stringify({platform:'win32',arch:'x64',version:'0.8.17'}));
await writeFile(join(deployment,'Install-CAgent.ps1'),'throw "compile fixture only"');
const packaged=spawnSync(process.execPath,['scripts/package-agent-windows-exe.mjs',deployment,join(root,'agent-real-template.exe')],{encoding:'utf8',windowsHide:true});
assert.equal(packaged.status,0,packaged.stdout+packaged.stderr);
// Exercise the production .onInit in a harmless silent fixture: only a temp receipt is written.
const selectionReceipt=join(root,'selected.ini'),selectionExe=join(root,'selection.exe');
let selection=await readFile(join(root,'cagent-installer.nsi'),'utf8');
selection=selection.replace(/^OutFile .+$/m,`OutFile "${selectionExe}"`).replace(/Section "Install"[\s\S]*?SectionEnd/,`Section "Probe"\n WriteINIStr "${selectionReceipt}" "Probe" "Directory" "$INSTDIR"\nSectionEnd`);
const selectionScript=join(root,'selection.nsi');await writeFile(selectionScript,selection);
let run=spawnSync(tool.path,['/V2',selectionScript],{env:{...process.env,...tool.env},encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stdout+run.stderr);
let detectedDirectory;
for(const explicit of [undefined,join(root,'chosen-directory')]){
 run=spawnSync(selectionExe,explicit?['/S',`/D=${explicit}`]:['/S'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(run.status,0,run.stderr);
 const bytes=await readFile(selectionReceipt);const receipt=bytes[0]===255?bytes.toString('utf16le'):bytes.toString('utf8');
 const actual=/Directory=(.*)/.exec(receipt)?.[1]?.trim();assert(actual);
 if(explicit)assert.equal(actual,explicit);else detectedDirectory=actual;
}
const packageConfig=JSON.parse(await readFile('package.json','utf8'));
assert.equal(packageConfig.build.nsis.include,'scripts/windows-deployment/installer-update-page.nsh');
const installer=await readFile('scripts/windows-deployment/Install-CAgent.ps1','utf8');
assert(installer.indexOf('if ($PrepareOnly)')<installer.indexOf("New-Item -Path 'HKCU:"));
const discover=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/windows-deployment/Find-CAgent.ps1')],{encoding:'utf8',windowsHide:true});
assert.equal(discover.status,0,discover.stderr);
if(discover.stdout){const candidate=discover.stdout;assert.equal(detectedDirectory,candidate);assert(!/[\r\n]/.test(candidate));await readFile(join(candidate,'Open CAgent.vbs'));
 const v=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/windows-deployment/Find-CAgent.ps1'),'-VersionOf',candidate],{encoding:'utf8',windowsHide:true});assert.equal(v.status,0,v.stderr);assert.match(v.stdout,/^\d+\.\d+\.\d+/);
}
console.log(JSON.stringify({passed:true,compiled:['desktop','cagent'],existingCAgentDetected:!!discover.stdout,fixture:root}));
