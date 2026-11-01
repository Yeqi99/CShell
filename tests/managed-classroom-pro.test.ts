import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CagentAssistant } from '../src/agent/assistant';
import type { ClientVault } from '../src/core/client/identity';

const model = { endpoint: 'https://fixture.invalid/v1/chat/completions', model: 'base', key: 'base-key' };
function fixture() {
  const data = new Map<string, unknown>();
  let block: (() => Promise<void>) | undefined;
  const vault = { read: async (key: string) => structuredClone(data.get(key)), write: async (key: string, value: unknown) => { await block?.(); data.set(key, structuredClone(value)); } } as unknown as ClientVault;
  const create = () => new CagentAssistant(vault, { shells: async () => [], applications: async () => [], execute: async () => ({}), allowed: () => true });
  return { create, setBlock: (fn?: () => Promise<void>) => { block = fn; } };
}

test('Pro model distribution survives reload/cloud round trip without changing grants', async () => {
  const f = fixture(), assistant = f.create();
  await assistant.load();
  await assistant.configure({ ...model, commands: false, review: true, delegates: [] });
  await assistant.configureModel({ ...model, model: 'managed-model', key: 'managed-key' });
  const cloud = assistant.cloudExport();
  assert.equal(cloud.providers.find(p => p.model === 'managed-model')?.key, 'managed-key');
  await assistant.cloudImport(cloud);
  const reload = f.create(); await reload.load();
  assert.equal(reload.snapshot().model, 'managed-model');
  assert.equal(reload.snapshot().commands, false); assert.equal(reload.snapshot().review, true); assert.deepEqual(reload.snapshot().delegates, []);
  await assistant.close(); await reload.close();
});

test('cloud provider removal clears stale credentials while retaining execution preferences', async () => {
  const f=fixture(), assistant=f.create(); await assistant.load();
  await assistant.configure({...model,commands:false,review:true,delegates:[]});
  const next=assistant.cloudExport(); next.providers=[];
  await assistant.cloudImport(next);
  const reload=f.create(); await reload.load();
  assert.equal(reload.snapshot().model,''); assert.equal(reload.snapshot().keyConfigured,false);
  assert.equal(reload.snapshot().commands,false); assert.equal(reload.snapshot().review,true);
  await assistant.close(); await reload.close();
});

test('pending configuration, cloud import and account restore exclude each other and task start', async () => {
  const f = fixture(), assistant = f.create();
  await assistant.load(); await assistant.configure({ ...model, commands: false, review: true, delegates: [] });
  const cloud = assistant.cloudExport(), workspace = assistant.localWorkspace();
  for (const kind of ['model', 'cloud', 'restore'] as const) {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    f.setBlock(async () => { entered(); await gate; });
    const pending = kind === 'model' ? assistant.configureModel(model) : kind === 'cloud' ? assistant.cloudImport(cloud) : assistant.restoreWorkspace(workspace);
    try {
      await started;
      assert.throws(() => assistant.assertAccountIdle(), /配置正在更新/);
      await assert.rejects(assistant.configureModel(model), /配置正在更新/);
      await assert.rejects(assistant.cloudImport(cloud), /配置正在更新/);
      await assert.rejects(assistant.restoreWorkspace(workspace), /配置正在更新/);
      await assert.rejects(assistant.start({ prompt: 'not while updating', requestId: randomUUID() }, 'local'), /配置正在更新/);
    } finally { release(); await pending; f.setBlock(); }
    assistant.assertAccountIdle();
  }
  await assistant.close();
});

test('CAgent resolves a cloud extension provider through its registered transport', async()=>{
 const f=fixture(),assistant=f.create();await assistant.load();
 const cloud=assistant.cloudExport(),id=randomUUID();
 cloud.providers=[{id,name:'OpenCode',url:'https://model-extension.invalid',model:'old',key:'',extension:{id:'cshell.opencode',model:'account/model'}}];
 await assistant.cloudImport(cloud);
 assert.equal(assistant.snapshot().providerId,id);assert.equal(assistant.snapshot().keyConfigured,true);
 let called=false;
 assistant.resolveExtension=async(ref)=>{assert.equal(ref.id,'cshell.opencode');return {url:'https://bridge.invalid',model:'resolved',key:'',transport:async(_url,init)=>{called=true;assert.equal(JSON.parse(String(init?.body)).model,'resolved');return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'ok'}}]}),{headers:{'content-type':'application/json'}});}};};
 await (assistant as any).modelRequest('https://unused.invalid',{method:'POST',body:JSON.stringify({model:'old',messages:[]})},new AbortController().signal,()=>{});
 assert.equal(called,true);await assistant.close();
});
