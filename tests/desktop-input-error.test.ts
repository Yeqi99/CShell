import {test} from 'node:test';import assert from 'node:assert/strict';import {desktopInputFailure} from '../src/agent/desktop-input-error';
test('input diagnostics distinguish lease, ownership and Windows rejection without exposing raw payloads',()=>{
 assert.equal(desktopInputFailure('INPUT_LEASE_EXPIRED').code,'INPUT_LEASE_EXPIRED');
 assert.equal(desktopInputFailure('button not owned by session').code,'INPUT_LATE_RELEASE');
 const denied=desktopInputFailure('INPUT_INJECTION_FAILED_POSSIBLE_UIPI_OR_DESKTOP_RESTRICTION win32=5');assert.equal(denied.code,'INPUT_OS_REJECTED');assert.match(denied.message,/Win32 5/);
 assert.equal(desktopInputFailure('INPUT_SECURE_OR_DIFFERENT_DESKTOP').code,'INPUT_DESKTOP_UNAVAILABLE');
 assert.ok(!desktopInputFailure('json invalid at private-user-content').message.includes('private-user-content'));
});
