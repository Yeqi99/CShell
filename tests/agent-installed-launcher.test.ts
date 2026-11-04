import test from 'node:test';
import assert from 'node:assert/strict';
import {installedRuntimeConflict} from '../src/agent/installed-launcher';
test('superseded native window cannot start old runtime after installer handoff',()=>{
 const entry='C:\\CAgent\\versions\\old\\agent.cjs';
 const script=(path:string)=>`sh.Run Chr(34) & "${path}" & Chr(34), 1, False`;
 assert.equal(installedRuntimeConflict(entry,script('C:\\CAgent\\versions\\new\\Cagent.exe')),true);
 assert.equal(installedRuntimeConflict(entry,script('C:\\CAgent\\versions\\old\\Cagent.exe')),false);
 assert.equal(installedRuntimeConflict(entry,script('D:\\Other\\versions\\new\\Cagent.exe')),false);
 assert.equal(installedRuntimeConflict('C:\\source\\agent.cjs',script('C:\\CAgent\\versions\\new\\Cagent.exe')),false);
 assert.equal(installedRuntimeConflict(entry,'invalid'),false);
});
