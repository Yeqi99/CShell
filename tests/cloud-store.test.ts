import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store';
const codec = {
  encrypt: async (s: string) => Buffer.from(s).toString('base64'),
  decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
};
test('cloud export/import carries credentials but never transfers MCP grants or tokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-store-'));
  try {
    const a = new Store(join(root, 'a'), codec),
      b = new Store(join(root, 'b'), codec);
    await a.load();
    await b.load();
    const id = randomUUID();
    await a.saveProfile({
      id,
      name: 'Server',
      host: 'example.com',
      port: 22,
      username: 'user',
      auth: 'password',
      group: 'Servers',
      favorite: true,
    });
    await a.setSecret(id, { password: 'test-secret' });
    await a.setMcpToken('local-only-token');
    await a.setMcpSettings({ ...a.mcpSettings(), enabled: true, allowCommands: true });
    const portable = await a.cloudExport();
    assert(!JSON.stringify(portable).includes('local-only-token'));
    await b.cloudImport(portable);
    assert.equal((await b.secret(id))?.password, 'test-secret');
    assert.equal(b.mcpSettings().enabled, false);
    assert.equal(b.mcpSettings().allowCommands, false);
    assert.equal(await b.mcpToken(), undefined);
    await b.trust('example.com:22', 'already-verified');
    assert.throws(() => b.cloudValidate({ ...portable, hosts: { 'example.com:22': 'changed' } }));
    assert.throws(() => b.cloudValidate({ ...portable, mcp: a.mcpSettings() }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('connection view and sidebar preferences survive cloud restore and local reload',async()=>{const root=await mkdtemp(join(tmpdir(),'view-sync-'));try{const a=new Store(join(root,'a'),codec),b=new Store(join(root,'b'),codec);await a.load();await b.load();await a.preferences({...a.snapshot().preferences,defaultConnectionView:'original',sidebarFontSize:14,sidebarGroupSize:17});await b.cloudImport(await a.cloudExport());const reloaded=new Store(join(root,'b'),codec);await reloaded.load();assert.equal(reloaded.snapshot().preferences.defaultConnectionView,'original');assert.equal(reloaded.snapshot().preferences.sidebarFontSize,14);assert.equal(reloaded.snapshot().preferences.sidebarGroupSize,17);}finally{await rm(root,{recursive:true,force:true});}});
