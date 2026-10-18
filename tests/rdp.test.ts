import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rdpDocument, rdpProfileSchema, protectRdpPassword } from '../src/core/rdp';
import { extractConnectionByRules } from '../src/shared/connection-rules';
const profile={id:'07f8a99c-b16a-44c4-88bf-6cdd2c7ac196',protocol:'rdp' as const,host:'example.test',port:3390,username:'DOMAIN\\user',name:'Desktop',group:'',favorite:false,auth:'password' as const};
test('RDP file preserves endpoint and username without disabling authentication',()=>{
 const file=rdpDocument(profile,'AB1234');
 assert(file.includes('full address:s:example.test:3390'));assert(file.includes('username:s:DOMAIN\\user'));
 assert(file.includes('authentication level:i:2'));assert(!file.includes('authentication level:i:0'));
 assert(rdpDocument({...profile,host:'::1'}).includes('[::1]:3390'));
 for(const p of [{...profile,host:'host\npassword 51:b:1'},{...profile,username:'u\r\nx'},{...profile,auth:'key'},{...profile,protocol:'ssh'}])assert.throws(()=>rdpProfileSchema.parse(p));
});
test('RDP password protection uses the current Windows user and emits ciphertext only',async()=>{
 if(process.platform!=='win32')return;
 const encrypted=await protectRdpPassword('fixture-only-测试-123');
 assert.match(encrypted,/^[A-F0-9]+$/);assert(encrypted.length>100);assert(!encrypted.includes(Buffer.from('fixture-only','utf16le').toString('hex').toUpperCase()));
});
test('Explicit extractors support RDP, cagent and HTTP without mixing protocols',()=>{
 assert.equal(extractConnectionByRules('rdp://user@example.test:3390','cshell.rdp').fields.port,3390);
 assert.equal(extractConnectionByRules('主机: example.test\n账号: DOMAIN\\user\n密码: test','cshell.rdp').fields.username,'DOMAIN\\user');
 assert.equal(extractConnectionByRules('{"host":"example.test","port":24443,"deviceId":"ignored"}','cshell.client').fields.port,24443);
 assert.equal(extractConnectionByRules('https://example.test/api?q=1','cshell.http').fields.url,'https://example.test/api?q=1');
 assert.throws(()=>extractConnectionByRules('ssh user@example.test','cshell.rdp'));
 assert.throws(()=>extractConnectionByRules('rdp://user@example.test','cshell.ssh'));
 assert.throws(()=>extractConnectionByRules('https://one.test https://two.test','cshell.http'));
 assert.throws(()=>extractConnectionByRules('https://user:secret@example.test','cshell.http'));
});
