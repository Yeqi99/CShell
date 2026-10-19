import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Virtual display helper build requires Windows x64');
const output = resolve(process.argv[2] || '.local/vdd-review/CAgentVirtualDisplay.exe');
mkdirSync(dirname(output), { recursive: true });
const result = spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), [
  '/nologo', '/platform:x64', '/r:System.Web.Extensions.dll', `/out:${output}`, resolve('tools/cagent-desktop/VirtualDisplay.cs'),
], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
