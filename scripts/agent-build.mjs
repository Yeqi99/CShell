import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile, chmod, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import { preparePty } from './prepare-pty.mjs';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const output = resolve(
  process.argv[2] || join(root, 'release', version, `agent-${process.platform}-${process.arch}`),
);
await mkdir(output, { recursive: true });
let desktopNative;
const result = await build({
  entryPoints: [join(root, 'src/agent/cli.ts')],
  outfile: join(output, 'agent.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  target: 'node22',
  external: ['node-pty'],
  metafile: true,
});
if (
  Object.keys(result.metafile.inputs).some((file) =>
    /(^|\/)electron(\/|$)|src\/desktop\//.test(file.replaceAll('\\', '/')),
  )
)
  throw new Error('Agent bundle must not contain Electron or desktop modules');
const pty = dirname(require.resolve('node-pty/package.json'));
await cp(pty, join(output, 'node_modules', 'node-pty'), { recursive: true, dereference: true });
const ptyRequire = createRequire(join(pty, 'package.json'));
await cp(
  dirname(ptyRequire.resolve('node-addon-api/package.json')),
  join(output, 'node_modules', 'node-addon-api'),
  { recursive: true, dereference: true },
);
await writeFile(
  join(output, 'package.json'),
  JSON.stringify(
    {
      name: 'cagent-runtime',
      version,
      private: true,
      dependencies: {
        'node-pty': JSON.parse(await readFile(join(pty, 'package.json'), 'utf8')).version,
      },
    },
    null,
    2,
  ),
);
const checkNative = () =>
  new Promise((resolveCheck) => {
    const child = spawn(process.execPath, ['-e', "require('node-pty')"], {
      cwd: output,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => resolveCheck(false));
    child.once('exit', (code) => resolveCheck(code === 0));
  });
// N-API prebuilds may already match Node. Compile only in this stage when needed.
preparePty(
  join(output, 'node_modules', 'node-pty'),
  process.env.CSHELL_AGENT_REBUILD_NATIVE === '1',
);
if (!(await checkNative())) throw new Error('Staged Agent native PTY cannot load in Node');
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
await cp(process.execPath, join(output, nodeName));
const launcher = process.platform === 'win32' ? 'cshell-agent.cmd' : 'cshell-agent';
await writeFile(
  join(output, launcher),
  process.platform === 'win32'
    ? '@echo off\r\n"%~dp0node.exe" "%~dp0agent.cjs" %*\r\n'
    : '#!/bin/sh\nexec "$(dirname "$0")/node" "$(dirname "$0")/agent.cjs" "$@"\n',
  { mode: 0o755 },
);
await cp(join(output, launcher),join(output,process.platform==='win32'?'cagent.cmd':'cagent'));
if(process.platform==='win32'){
  const python=process.env.CAGENT_WECHAT_PYTHON;
  if(!python)throw new Error('Set CAGENT_WECHAT_PYTHON to a Python 3.12 environment with the pinned WeChat dependencies');
  await new Promise((done,reject)=>{const child=spawn(python,[join(root,'tools/wechat-bridge/build-cagent-runtime.py'),join(output,'wechat-runtime')],{stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error('WeChat runtime build failed')));});

  const framework=join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319');
  await new Promise((resolveBuild,reject)=>{
    const child=spawn(join(framework,'csc.exe'),['/nologo','/target:winexe','/win32icon:'+join(root,'assets/cagent-icon.ico'),'/out:'+join(output,'Cagent.exe'),...['WindowsBase','PresentationCore','PresentationFramework'].map(name=>'/r:'+join(framework,'WPF',name+'.dll')),'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Xaml.dll','/r:System.Web.Extensions.dll',join(root,'src/agent/native/CagentWindow.cs')],{stdio:'inherit',windowsHide:true});
    child.once('error',reject);child.once('exit',code=>code===0?resolveBuild():reject(new Error('Native cagent window build failed')));
  });
  await writeFile(join(output,'cagent-app.vbs'),`Set sh = CreateObject("WScript.Shell")\r\nSet fs = CreateObject("Scripting.FileSystemObject")\r\np = fs.GetParentFolderName(WScript.ScriptFullName)\r\nsh.Run Chr(34) & p & "\\Cagent.exe" & Chr(34), 1, False\r\n`);
  if(process.arch==='x64'){
    const cached=join(root,'test-results/toolchains/llvm-mingw-20261006-ucrt-x86_64/bin/x86_64-w64-mingw32-clang++.exe');
    const compiler=process.env.CAGENT_NATIVE_CXX||(existsSync(cached)?cached:undefined);
    if(!compiler)throw new Error('Set CAGENT_NATIVE_CXX to the LLVM-MinGW x64 clang++ compiler to build the optional desktop capability');
    await new Promise((resolveBuild,reject)=>{
      const child=spawn(compiler,['-std=c++17','-O2','-municode','-static',join(root,'tools/cagent-desktop/native/desktop.cpp'),'-o',join(output,'cagent-desktop.exe'),'-ld3d11','-ldxgi','-lmfplat','-lmfuuid','-lmf','-lole32','-loleaut32','-luuid','-lwmcodecdspuuid','-luser32','-lgdi32','-ladvapi32'],{stdio:'inherit',windowsHide:true});
      child.once('error',reject);child.once('exit',code=>code===0?resolveBuild():reject(new Error('Native desktop capability build failed')));
    });
    const systemDirectory=join(output,'system-desktop');
    await mkdir(systemDirectory,{recursive:true});
    const nativeBuild=(source,name,libraries,defines=[])=>new Promise((done,reject)=>{
      const child=spawn(compiler,['-std=c++17','-O2','-municode','-static',...defines,join(root,'tools/cagent-desktop/native',source),'-o',join(systemDirectory,name),...libraries],{stdio:'inherit',windowsHide:true});
      child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`System desktop build failed: ${source}`)));
    });
    await nativeBuild('desktop.cpp','cagent-desktop.exe',['-ld3d11','-ldxgi','-lmfplat','-lmfuuid','-lmf','-lole32','-loleaut32','-luuid','-lwmcodecdspuuid','-luser32','-lgdi32','-ladvapi32'],['-DCAGENT_EXPERIMENTAL_SYSTEM_BROKER']);
    await nativeBuild('desktop-broker.cpp','cagent-desktop-broker.exe',['-ladvapi32','-luserenv','-lole32']);
    for(const name of ['install-system-service.ps1','system-desktop-status.ps1'])await cp(join(root,'tools/cagent-desktop',name),join(output,name));
    await new Promise((done,reject)=>{const child=spawn(process.execPath,[join(root,'scripts/build-virtual-display.mjs'),join(output,'CAgentVirtualDisplay.exe')],{cwd:root,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error('Virtual display helper build failed')));});
    await cp(join(root,'tools/cagent-desktop/licenses/nlohmann-json.txt'),join(output,'LICENSE.desktop-json.txt'));
    const compilerLicense=join(dirname(dirname(compiler)),'LICENSE.TXT');
    if(!existsSync(compilerLicense))throw new Error('LLVM-MinGW LICENSE.TXT must accompany the selected compiler');
    await cp(compilerLicense,join(output,'LICENSE.desktop-toolchain.txt'));
    desktopNative={platform:'win32',architecture:'x64',sha256:createHash('sha256').update(await readFile(join(output,'cagent-desktop.exe'))).digest('hex'),optional:true,enabledByDefault:false};
  }
}
if (process.platform !== 'win32') {
  await chmod(join(output, launcher), 0o755);
  await chmod(join(output, nodeName), 0o755);
}
await cp(join(root, 'LICENSE'), join(output, 'LICENSE'));
const packages = new Map();
for (const file of [
  ...Object.keys(result.metafile.inputs).filter((file) => file.includes('node_modules')),
  join(pty, 'package.json'),
]) {
  let directory = dirname(resolve(root, file));
  while (directory !== dirname(directory)) {
    try {
      const data = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (data.name && data.version) {
        packages.set(`${data.name}@${data.version}`, { directory, data });
        break;
      }
    } catch {}
    directory = dirname(directory);
  }
}
let notices = 'CAgent (Canp Agent) — bundled third-party licenses\n\n';
for (const [name, { directory, data }] of [...packages.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const files = (await readdir(directory)).filter((file) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(file),
  );
  if (!files.length) throw new Error(`Missing third-party license for ${name}`);
  notices += `${name}\nDeclared license: ${typeof data.license === 'string' ? data.license : JSON.stringify(data.license)}\n`;
  for (const file of files)
    notices += `${file}\n${await readFile(join(directory, file), 'utf8')}\n`;
  notices += '\n========================================\n\n';
}
await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), notices);
await cp(join(pty, 'deps', 'winpty', 'LICENSE'), join(output, 'LICENSE.winpty.txt'));
let nodeLicense;
const previousBuild = await readFile(join(output, 'build-info.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => undefined);
for (const candidate of [
  process.env.CSHELL_AGENT_NODE_LICENSE,
  join(dirname(process.execPath), 'LICENSE'),
  join(dirname(dirname(process.execPath)), 'LICENSE'),
  previousBuild?.node === process.versions.node ? join(output, 'LICENSE.node.txt') : undefined,
].filter(Boolean)) {
  try {
    const value = await readFile(candidate, 'utf8');
    if (value.includes('Node.js') && value.includes('Permission')) {
      nodeLicense = value;
      break;
    }
  } catch {}
}
if (!nodeLicense) {
  const response = await fetch(
    `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw new Error(
      `Cannot fetch exact Node ${process.versions.node} license (${response.status}); provide CSHELL_AGENT_NODE_LICENSE`,
    );
  nodeLicense = await response.text();
  if (!nodeLicense.includes('Node.js') || !nodeLicense.includes('Permission'))
    throw new Error('Invalid Node license response');
}
await writeFile(join(output, 'LICENSE.node.txt'), nodeLicense);
const removeStaged = async (relative) => {
  const target = resolve(output, relative);
  if (!target.startsWith(output + sep)) throw new Error('Unsafe stage cleanup path');
  await rm(target, { recursive: true, force: true });
};
const stagedPty = join(output, 'node_modules', 'node-pty');
for (const name of await readdir(join(stagedPty, 'prebuilds')).catch(() => []))
  if (name !== `${process.platform}-${process.arch}`)
    await removeStaged(join('node_modules', 'node-pty', 'prebuilds', name));
for (const name of ['src', 'deps', 'scripts', 'typings', 'third_party'])
  await removeStaged(join('node_modules', 'node-pty', name));
await removeStaged(join('node_modules', 'node-addon-api'));
async function trimDebug(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await trimDebug(full);
    else if (/\.pdb$|\.test\.js(?:\.map)?$|\.js\.map$/i.test(entry.name)) {
      if (!full.startsWith(output + sep)) throw new Error('Unsafe debug cleanup path');
      await rm(full);
    }
  }
}
await trimDebug(stagedPty);
if (process.platform === 'win32') {
  for (const [filename, command] of [
    ['Start Agent.cmd', 'run'],
    ['Agent Status.cmd', 'status'],
    ['Configure Agent.cmd', 'init'],
  ])
    await writeFile(
      join(output, filename),
      `@echo off\r\n"%~dp0node.exe" "%~dp0agent.cjs" ${command}\r\npause\r\n`,
    );
}
await writeFile(
  join(output, 'README.txt'),
  `CAgent (Canp Agent) ${version}\n\nOpen cagent-app.vbs (Windows) or run cagent app for the standalone local assistant.\nWindows uses a compact native WPF window; other platforms use the system browser. No bundled browser runtime.\nConfigure the model and explicit permissions in Settings.\nLegacy cshell-agent commands and data remain compatible.\n\nRun cshell-agent init to choose shells and create credentials.\nRun cshell-agent run (Windows: Start Agent.cmd) to start the user process.\nIt does not install a Windows service and does not open remote access automatically.\nConfigure and explicitly start the listener from the CShell Agent extension.\nNo Electron or Chromium is bundled.\nKeep the complete Agent data directory, including vault-key, for recovery.\n`,
);
await writeFile(
  join(output, 'build-info.json'),
  JSON.stringify(
    {
      version,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: false,
      desktopNative,
    },
    null,
    2,
  ),
);
console.log(`Agent runtime staged: ${output}`);
