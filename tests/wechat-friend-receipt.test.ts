import test from 'node:test';
import assert from 'node:assert/strict';
import {friendActionReceipt as receipt} from '../src/agent/wechat-friend-receipt';
const requestId = 'a'.repeat(64);
test('friend write receipts require matching identity and affirmative evidence', () => {
  for (const action of ['accept','invite'] as const) {
    assert.equal(receipt(501,{requestId,nativeActionsAvailable:false},requestId,action).status,'unsupported');
    for (const http of [200,202,409]) assert.deepEqual(receipt(http,{requestId,state:'observed'},requestId,action),{requestId,httpStatus:http,status:'requires-reconciliation',nextAction:'read',replay:false});
    assert.throws(()=>receipt(200,{requestId:'b'.repeat(64)},requestId,action));
  }
  assert.equal(receipt(200,{requestId,friend:'confirmed'},requestId,'accept').status,'confirmed');
  for (const invite of ['invited','joined']) assert.equal(receipt(200,{requestId,invite},requestId,'invite').status,invite);
});
