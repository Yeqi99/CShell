import assert from 'node:assert/strict';
import test from 'node:test';
import {mobilePreferences} from '../android/web/account-preferences';
test('mobile consumes account typography with bounded invalid input and reset',()=>{
 const p=mobilePreferences({uiFontSize:16,fontSize:18,terminalFont:'Consolas',lineHeight:1.4});
 assert.equal(p.uiFontSize,16);assert.equal(p.fontSize,18);assert.equal(p.fontFamily,'Consolas');assert.equal(p.lineHeight,1.4);
 assert.equal(mobilePreferences({fontSize:Infinity}).fontSize,14);
 assert.equal(mobilePreferences({fontSize:500}).fontSize,28);
 assert.equal(mobilePreferences(null).fontSize,14);
});
