import {test} from 'node:test';import assert from 'node:assert/strict';
import {readConnectionCsv,connectionsFromCsv,connectionsFromText} from '../src/shared/connection-batch';
test('CSV preserves quoted credentials and reports invalid rows without leaking them',()=>{
 const table=readConnectionCsv('\uFEFF名称,主机地址,端口,用户名,密码\r\n"华东,机器",example.com,22,root,"p,a"\r\n坏行,example.net,70000,root,private-secret');
 const rows=connectionsFromCsv(table);assert.equal(rows[0].connection?.fields.password,'p,a');assert.equal(rows[0].connection?.fields.name,'华东,机器');assert(rows[1].error);assert(!rows[1].error.includes('private-secret'));
});
test('CSV handles multiline escaped quotes and requires explicit mapping for unknown headers',()=>{
 const table=readConnectionCsv('Server;Account;Secret\n"example.com";root;"a""b\nc"',';');assert.throws(()=>connectionsFromCsv(table),/地址列/);const result=connectionsFromCsv(table,{host:0,username:1,password:2});assert.equal(result[0].connection?.fields.password,'a"b\nc');assert.throws(()=>readConnectionCsv('Host\n"unclosed'),/未闭合/);
});
test('text preserves multiple target blocks and never executes trailing shell input',()=>{
 const rows=connectionsFromText('ssh root@one.example -p 2222\nssh user@two.example\n主机: three.example\n用户名: root\n密码: test-secret');assert.equal(rows.length,3);assert.equal(rows[0].connection?.fields.port,2222);assert.equal(rows[2].connection?.fields.password,'test-secret');assert(connectionsFromText('ssh root@one.example; touch /tmp/unsafe')[0].error);
});
test('unsupported protocols and duplicate mapping cannot silently become SSH',()=>{
 assert(connectionsFromCsv(readConnectionCsv('host,protocol\nexample.com,telnet'))[0].error);assert.throws(()=>readConnectionCsv('host,hostname\na,b'),/重复/);assert.throws(()=>connectionsFromCsv(readConnectionCsv('host,user\na,b'),{host:0,username:0}),/映射/);
});
