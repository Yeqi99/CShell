import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionHref,parsePermissionHref,permissionNodes } from '../src/shared/permission-links';
import { permissionLinkTool } from '../src/core/permission-link-tool';
test('permission links allow only known navigation nodes, never arbitrary URLs or operations',async()=>{
 for(const node of permissionNodes)assert.equal(parsePermissionHref(permissionHref(node.id))?.id,node.id);
 for(const bad of ['javascript:alert(1)','file:///C:/x','https://example.com/#cshell-permission/wechat/readSessions','#cshell-permission/wechat/readSessions?enable=true','#cshell-permission/wechat/unknown'])assert.equal(parsePermissionHref(bad),undefined);
 assert.throws(()=>permissionHref('wechat/unknown'));
 await assert.rejects(permissionLinkTool.invoke({node:'wechat/readSessions',enable:true},new AbortController().signal));
 const result=JSON.parse(await permissionLinkTool.invoke({node:'wechat/readSessions'},new AbortController().signal));
 assert.equal(result.changesPermissions,false);assert.equal(result.requiresUserSave,true);assert.equal(result.href,'#cshell-permission/wechat/readSessions');
 assert.equal(permissionLinkTool.needsReview({}),false);
});
