import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Virtual display helper build requires Windows x64');
const output = resolve(process.argv[2] || '.local/vdd-review/CAgentVirtualDisplay.exe');
mkdirSync(dirname(output), { recursive: true });
const result = spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), [
  '/nologo', '/platform:x64', '/r:System.Web.Extensions.dll', `/out:${output}`, resolve('tools/cagent-desktop/VirtualDisplay.cs'),
], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (!process.exitCode && process.argv.includes('--stage-driver')) {
  const temp = mkdtempSync(join(tmpdir(), 'cagent-vdd-build-'));
  try {
    const url = 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip';
    const archive = join(temp, 'driver.zip');
    if (process.env.CAGENT_VDD_ARCHIVE) copyFileSync(process.env.CAGENT_VDD_ARCHIVE, archive);
    else {
      const download = spawnSync('curl.exe', ['--fail','--location','--retry','2','--max-time','90','--output',archive,url], {stdio:'inherit',windowsHide:true});
      if (download.status !== 0) throw new Error('Failed to stage the signed virtual display driver');
    }
    const bytes = readFileSync(archive);
    if (createHash('sha256').update(bytes).digest('hex') !== 'e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a') throw new Error('Invalid virtual display driver archive');
    const extracted = spawnSync('tar.exe',['-xf',archive,'-C',temp], {stdio:'inherit',windowsHide:true});
    if (extracted.status !== 0) throw new Error('Could not extract the verified driver');
    const verified = spawnSync(output,['verify-package',join(temp,'VirtualDisplayDriver')],{stdio:'inherit',windowsHide:true});
    if (verified.status !== 0) throw new Error('Invalid virtual display package contents');
    const payload = join(dirname(output),'VirtualDisplayDriver');
    mkdirSync(payload,{recursive:true});
    for (const file of ['MttVDD.inf','MttVDD.dll','mttvdd.cat','vdd_settings.xml']) copyFileSync(join(temp,'VirtualDisplayDriver',file),join(payload,file));
    copyFileSync(resolve('tools/cagent-desktop/licenses/virtual-display-driver.txt'),join(payload,'LICENSE.txt'));
  } finally { rmSync(temp,{recursive:true,force:true}); }
}
