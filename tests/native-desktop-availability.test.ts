import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeDesktopAvailable} from '../src/shared/linux-workspace';
test('native desktop app requires positive desktop evidence, not a VNC package or unknown probe',()=>{
 assert.equal(nativeDesktopAvailable(undefined),false);
 assert.equal(nativeDesktopAvailable({desktopPresence:'unknown'}),false);
 assert.equal(nativeDesktopAvailable({desktopPresence:'absent'}),false);
 assert.equal(nativeDesktopAvailable({desktopPresence:'present'}),true);
 assert.equal(nativeDesktopAvailable({sessions:[{display:':1'}]}),true);
 assert.equal(nativeDesktopAvailable({running:true}),true);
});
