import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store';
import { builtinPlugins } from '../src/shared/plugins';
const codec = {
  encrypt: async (s: string) => Buffer.from(s).toString('base64'),
  decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
};

test('account sync restores bundled plugin choices on a fresh device without copying external packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-plugins-'));
  try {
    const a = new Store(join(root, 'a'), codec), b = new Store(join(root, 'b'), codec);
    await a.load(); await b.load();
    const manifest = builtinPlugins.find(p => p.provider === 'opencode')!;
    await a.setPlugins([...a.plugins(), {manifest, enabled:true, source:'bundled'}]);
    await b.cloudImport(await a.cloudExport());
    assert.equal(b.plugins().find(p => p.manifest.id === manifest.id)?.enabled, true);
    await a.setPlugins(a.plugins().map(p => p.manifest.id === manifest.id ? {...p,enabled:false}:p));
    await b.cloudImport(await a.cloudExport());
    assert.equal(b.plugins().find(p => p.manifest.id === manifest.id)?.enabled, false);
    assert.equal(b.mcpSettings().enabled, false);
  } finally { await rm(root,{recursive:true,force:true}); }
});
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
      defaultConnectionView: 'visual',
    });
    await a.setSecret(id, { password: 'test-secret' });
    await a.setMcpToken('local-only-token');
    await a.setMcpSettings({ ...a.mcpSettings(), enabled: true, allowCommands: true });
    const portable = await a.cloudExport();
    assert(!JSON.stringify(portable).includes('local-only-token'));
    await b.cloudImport(portable);
    assert.equal(b.snapshot().profiles[0].defaultConnectionView, 'visual');
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

test('connection view and sidebar preferences survive cloud restore and local reload',async()=>{const root=await mkdtemp(join(tmpdir(),'view-sync-'));try{const a=new Store(join(root,'a'),codec),b=new Store(join(root,'b'),codec);await a.load();await b.load();await a.preferences({...a.snapshot().preferences,defaultConnectionView:'visual',defaultConnectionViewExplicit:true,sidebarFontSize:14,sidebarGroupSize:17});await b.cloudImport(await a.cloudExport());const reloaded=new Store(join(root,'b'),codec);await reloaded.load();assert.equal(reloaded.snapshot().preferences.defaultConnectionView,'visual');assert.equal(reloaded.snapshot().preferences.sidebarFontSize,14);assert.equal(reloaded.snapshot().preferences.sidebarGroupSize,17);}finally{await rm(root,{recursive:true,force:true});}});

test('external snippets restore selection and commands, executable selections only match installed identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-external-'));try{
 const a=new Store(join(root,'a'),codec),b=new Store(join(root,'b'),codec);await a.load();await b.load();
 const snippet={manifest:{protocol:1 as const,id:'example.shortcuts',version:'1.0.0',name:'Shortcuts',description:'',publisher:'Fixture',provider:'snippets' as const,permissions:['terminal.input' as const],commands:[{label:'list',text:'ls -la'}]},enabled:true,source:'custom:'+'a'.repeat(64)};
 await a.setPlugins([...a.plugins(),snippet]);await b.cloudImport(await a.cloudExport());assert.deepEqual(b.plugins().find(p=>p.manifest.id===snippet.manifest.id),snippet);
 await b.load();assert.equal(b.plugins().find(p=>p.manifest.id===snippet.manifest.id)?.enabled,true);
 const duplicate=await a.cloudExport();duplicate.extensions.external!.push(duplicate.extensions.external![0]);assert.throws(()=>b.cloudValidate(duplicate),/Duplicate/);
 await b.setPlugins(b.plugins().filter(p=>p.manifest.id!==snippet.manifest.id));const deleted=await b.cloudExport();assert(!deleted.extensions.external?.some(p=>p.manifest.id===snippet.manifest.id));await b.load();await b.cloudImport(deleted);assert(!b.plugins().some(p=>p.manifest.id===snippet.manifest.id));
 await b.cloudImport(await a.cloudExport());
 const bad=await a.cloudExport();bad.extensions.external![0].manifest.name='tampered';const before=b.cloudCheckpoint();await assert.rejects(b.cloudImport(bad),/摘要/);assert.equal(b.cloudCheckpoint(),before);
 const executable={...snippet,manifest:{...snippet.manifest,id:'example.native',provider:'process' as const,permissions:['remote.execute' as const],commands:[]}};
 await a.setPlugins([...a.plugins(),executable]);await b.cloudImport(await a.cloudExport());assert(!b.plugins().some(p=>p.manifest.id==='example.native'),'missing executable is not fabricated as installed');
 assert((await b.cloudExport()).extensions.external!.some(p=>p.manifest.id==='example.native'),'pending selection survives another sync');
 await b.setPlugins([...b.plugins(),{...executable,enabled:false}]);await b.cloudImport(await a.cloudExport());assert.equal(b.plugins().find(p=>p.manifest.id==='example.native')?.enabled,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
