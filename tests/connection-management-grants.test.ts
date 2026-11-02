import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mcpSettingsSchema,apiClientSchema,apiApplicationCapabilities} from '../src/shared/contracts';
import {aiPolicySchema,emptyAiPolicy} from '../src/shared/ai';
import {selectAllMcpPermissions} from '../src/ui/components/mcp-all-permissions';
test('legacy explicit grants are not expanded; explicit select all includes connection administration',()=>{
 const old=mcpSettingsSchema.parse({enabled:false,port:3777,allowedProfiles:[],allowCommands:false,applicationCapabilities:['connections.read']});
 assert.deepEqual(old.applicationCapabilities,['connections.read']);
 assert.deepEqual(aiPolicySchema.parse(emptyAiPolicy()).application,[]);
 const all=mcpSettingsSchema.parse(selectAllMcpPermissions(old,[],[]));
 assert.deepEqual(all.applicationCapabilities,[...apiApplicationCapabilities]);
 for(const p of ['connections.manage','credentials.manage','identity.trust'])assert(all.applicationCapabilities?.includes(p as any));
 assert.equal(all.enabled,false);assert.deepEqual(all.allowedProfiles,[]);
 const client=apiClientSchema.parse({id:crypto.randomUUID(),name:'test',enabled:true,allowedProfiles:[],allowCommands:false,capabilities:[],review:'always',disclosure:{mode:'full',level:'contract',budgetBytes:8192},applicationCapabilities:[...apiApplicationCapabilities]});
 assert.equal(client.applicationCapabilities?.length,7);
});
