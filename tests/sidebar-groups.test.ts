import test from 'node:test';import assert from 'node:assert/strict';
import {ACCOUNT_DEVICE_GROUP,orderSidebarGroups,readGroupExpansion,groupIsCollapsed} from '../src/ui/components/sidebar-groups';
test('account discovery starts collapsed, explicit expansion survives reload without changing other groups',()=>{
 const key='group:'+ACCOUNT_DEVICE_GROUP;
 assert.equal(groupIsCollapsed({},key,ACCOUNT_DEVICE_GROUP),true);
 const saved=readGroupExpansion(JSON.stringify({[key]:false,'group:My servers':true}));
 assert.equal(groupIsCollapsed(saved,key,ACCOUNT_DEVICE_GROUP),false);
 assert.equal(groupIsCollapsed(saved,'group:My servers',ACCOUNT_DEVICE_GROUP),true);
 assert.equal(groupIsCollapsed(saved,'group:New group',ACCOUNT_DEVICE_GROUP),false);
 assert.deepEqual(readGroupExpansion('{broken'),{});
 assert.deepEqual(readGroupExpansion('{"x":"false","y":true}'),{y:true});
});
test('account group sorts first without mutating machine assignments or caller group order',()=>{
 const names=['Z',ACCOUNT_DEVICE_GROUP,'A'];assert.deepEqual(orderSidebarGroups(names,'en-US',ACCOUNT_DEVICE_GROUP),[ACCOUNT_DEVICE_GROUP,'A','Z']);assert.deepEqual(names,['Z',ACCOUNT_DEVICE_GROUP,'A']);
});
