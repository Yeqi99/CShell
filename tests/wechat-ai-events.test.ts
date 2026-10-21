import test from 'node:test';
import assert from 'node:assert/strict';
import { wechatAiEvent, wechatAiEvents } from '../src/core/wechat-ai-events';
test('Wechat events retain exact identity but exclude protocol/credential data',()=>{
 const event={kind:'message',messageId:'123',senderId:'wxid_peer',recipientId:'wxid_owner',conversationId:'wxid_peer',conversationType:'private',nativeType:1,timestampRaw:'1792241000',text:'hello',format:'text',secret:'never forward'};
 const result=wechatAiEvent({id:'subscription',accountId:'wxid_owner',event})!;
 assert.equal(result.id,'wxid_peer:123');assert.equal(result.isSelf,false);assert.equal(result.payload.text,'hello');assert.equal(JSON.stringify(result).includes('never forward'),false);
 assert.equal(wechatAiEvent({id:'s',accountId:'wxid_owner',event:{...event,senderId:'wxid_owner'}})?.isSelf,true);
 assert.equal(wechatAiEvent({id:'s',accountId:'wxid_owner',event:{...event,messageId:'0'}}),null);
 assert.equal(wechatAiEvent({id:'s',accountId:'wxid_owner',event:{...event,nativeType:49,format:'xml',text:'<credentials/>'}})?.payload.text,null);
});

test('payment notifications preserve message rules, omit tickets and use stable card identities',()=>{
 const raw={kind:'message',messageId:'123',senderId:'wxid_peer',recipientId:'wxid_owner',conversationId:'wxid_peer',conversationType:'private',nativeType:49,timestampRaw:'1792241000',text:null,format:'payment-card',
 payment:{kind:'transfer',messageState:'transfer_notice',paymentReference:'a'.repeat(64),amountMinor:10,currency:'CNY',settlementStatus:'unverified',nativeurl:'secret-ticket'}};
 const convert=(event=raw)=>wechatAiEvents({id:'s',accountId:'wxid_owner',event});
 const events=convert();assert.deepEqual(events.map(e=>e.type),['message.received','transfer.received']);
 assert.equal(events[1].payload.amountMinor,10);assert.equal(events[1].payload.settlementStatus,'unverified');
 assert(!JSON.stringify(events).includes('secret-ticket'));
 assert.equal(convert({...raw,messageId:'124'})[1].id,events[1].id);
 assert.equal(convert({...raw,senderId:'wxid_owner'}).length,1);
 assert.equal(convert({...raw,payment:{...raw.payment,messageState:'receipt_notice'}}).length,1);
 assert.equal(convert({...raw,payment:{...raw.payment,paymentReference:'invalid'}}).length,1);
 assert.equal(convert({...raw,nativeType:1}).length,1);
 assert.equal(convert({...raw,format:'text'}).length,1);
 const red=convert({...raw,nativeType:2001*2**32+49,payment:{...raw.payment,kind:'red_packet',messageState:'red_packet_notice'}})[1];
 assert.equal(red.type,'red_packet.received');assert.equal(red.payload.amountMinor,null);assert.equal(red.payload.currency,null);
});
