import {test} from 'node:test';
import assert from 'node:assert/strict';
import {desktopTestTarget,desktopTestDeployment} from '../scripts/desktop-test-target';
test('public desktop fixtures require explicit endpoints instead of personal defaults',()=>{
 const keys=['CAGENT_TEST_HOST','CAGENT_TEST_PUBLIC_MANAGEMENT_PORT','CAGENT_TEST_PUBLIC_DESKTOP_PORT','CAGENT_TEST_MANAGEMENT_PORT','CAGENT_TEST_DESKTOP_PORT'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  for(const key of keys)delete process.env[key];
  assert.throws(()=>desktopTestTarget());
  process.env.CAGENT_TEST_HOST='desktop.example.invalid';
  assert.throws(()=>desktopTestTarget());
  process.env.CAGENT_TEST_PUBLIC_MANAGEMENT_PORT='45001';
  assert.deepEqual(desktopTestTarget(),{host:'desktop.example.invalid',port:45001});
  assert.throws(()=>desktopTestDeployment());
  process.env.CAGENT_TEST_PUBLIC_DESKTOP_PORT='45002';
  assert.deepEqual(desktopTestDeployment(),{host:'desktop.example.invalid',managementPort:9998,publicManagementPort:45001,desktopPort:9999,publicDesktopPort:45002});
  process.env.CAGENT_TEST_HOST='https://example.invalid/path';assert.throws(()=>desktopTestTarget());
 }finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
