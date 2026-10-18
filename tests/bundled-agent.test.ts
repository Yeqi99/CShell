import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { bundledAgentExecutable } from '../src/core/bundled-agent';
const hooks = createRequire(import.meta.url)('../scripts/bundled-agent.cjs');

test('packaged CAgent must contain matching standalone resources; corrupt copies fail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cagent-bundle-'));
  try {
    const source = join(root, 'release/1.2.3/agent-win32-x64');
    await mkdir(join(source, 'node_modules/node-pty'), { recursive: true });
    for (const name of ['node.exe', 'Cagent.exe', 'agent.cjs', 'cagent-desktop.exe', 'LICENSE.node.txt', 'node_modules/node-pty/package.json'])
      await writeFile(join(source, name), name);
    await writeFile(join(source, 'build-info.json'), JSON.stringify({ version: '1.2.3', platform: 'win32', arch: 'x64', electron: false, desktopNative: { sha256: createHash('sha256').update('cagent-desktop.exe').digest('hex') } }));
    assert.equal(await bundledAgentExecutable(source, '1.2.3'), join(source, 'Cagent.exe'));
    await assert.rejects(bundledAgentExecutable(source, '1.2.4'), /版本/);
    const appOutDir = join(root, 'app');
    await cp(source, join(appOutDir, 'resources/cagent'), { recursive: true });
    // Model electron-builder extraResources' default omission of node_modules.
    await rm(join(appOutDir, 'resources/cagent/node_modules'), { recursive: true });
    const context = { electronPlatformName: 'win32', appOutDir, packager: { projectDir: root, appInfo: { version: '1.2.3' } } };
    await hooks.afterPack(context);
    await writeFile(join(appOutDir, 'resources/cagent/agent.cjs'), 'stale code');
    await assert.rejects(hooks.afterPack(context), /do not match/);
    await rm(join(source, 'node.exe'));
    await assert.rejects(bundledAgentExecutable(source, '1.2.3'), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
