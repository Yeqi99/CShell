import test from 'node:test';
import assert from 'node:assert/strict';
import { wechatAiEvent } from '../src/core/wechat-ai-events';
test('Wechat events retain exact identity but exclude protocol/credential data',()=>{
 const event={kind:'message',messageId:'123',senderId:'wxid_peer',recipientId:'wxid_owner',conversationId:'wxid_peer',conversationType:'private',nativeType:1,timestampRaw:'1792241000',text:'hello',format:'text',secret:'never forward'};
 const result=wechatAiEvent({id:'subscription',accountId:'wxid_owner',event})!;
 assert.equal(result.id,'wxid_peer:123');assert.equal(result.isSelf,false);assert.equal(result.payload.text,'hello');assert.equal(JSON.stringify(result).includes('never forward'),false);
 assert.equal(wechatAiEvent({id:'s',accountId:'wxid_owner',event:{...event,senderId:'wxid_owner'}})?.isSelf,true);
 assert.equal(wechatAiEvent({id:'s',accountId:'wxid_owner',event:{...event,messageId:'0'}}),null);
 assert.equal(wechatAiEvent({id:'s',accountId:'wxid_owner',event:{...event,nativeType:49,format:'xml',text:'<credentials/>'}})?.payload.text,null);
});
