const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync, mkdtempSync, rmSync, renameSync } = require('node:fs');
module.exports = async function buildRdp(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (context.arch !== 1) throw new Error('RDP helper packaging currently supports Windows x64');
  const root = context.packager.projectDir;
  const parent = join(root, '.local', 'rdp-dist');
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, 'stage-'));
  const dest = join(parent, 'cshell-rdp');
  try {
    execFileSync(process.env.CSHELL_BUILD_PYTHON || 'python', ['scripts/rdp/package.py', stage], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    rmSync(dest, { recursive: true, force: true });
    renameSync(stage, dest);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
};
