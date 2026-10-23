import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionHref,parsePermissionHref,permissionNodes } from '../src/shared/permission-links';
import { permissionLinkTool } from '../src/core/permission-link-tool';
import {z} from 'zod';

test('model receives exact permission IDs and hallucinated CPU/disk nodes are rejected',()=>{
 const schema=z.toJSONSchema(permissionLinkTool.input) as any;
 assert.deepEqual(schema.properties.node.enum,permissionNodes.map(n=>n.id));
 for(const node of ['server.cpu.view','server.disk.view'])assert.equal(permissionLinkTool.input.safeParse({node}).success,false);
 assert.equal(permissionLinkTool.input.safeParse({node:'capability/metrics.read'}).success,true);
});
test('permission links allow only known navigation nodes, never arbitrary URLs or operations',async()=>{
 assert.equal(parsePermissionHref(permissionHref('wechat/sendFiles'))?.label,'微信：发送文件');
 assert.equal(parsePermissionHref(permissionHref('wechat/send'))?.label,'微信：发送范围');
 assert.equal(parsePermissionHref(permissionHref('wechat/remarks'))?.label,'微信：修改备注范围');
 for(const node of permissionNodes)assert.equal(parsePermissionHref(permissionHref(node.id))?.id,node.id);
 for(const bad of ['javascript:alert(1)','file:///C:/x','https://example.com/#cshell-permission/wechat/readSessions','#cshell-permission/wechat/readSessions?enable=true','#cshell-permission/wechat/unknown'])assert.equal(parsePermissionHref(bad),undefined);
 assert.throws(()=>permissionHref('wechat/unknown'));
 await assert.rejects(permissionLinkTool.invoke({node:'wechat/readSessions',enable:true},new AbortController().signal));
 const result=JSON.parse(await permissionLinkTool.invoke({node:'wechat/readSessions'},new AbortController().signal));
 assert.equal(result.changesPermissions,false);assert.equal(result.requiresUserSave,true);assert.equal(result.href,'#cshell-permission/wechat/readSessions');
 assert.equal(permissionLinkTool.needsReview({}),false);
});
