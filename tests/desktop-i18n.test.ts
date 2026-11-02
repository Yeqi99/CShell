import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopEnglish,desktopText} from '../src/ui/desktop-i18n';

test('desktop and permission product translations are English while unknown names are unchanged',()=>{
 for(const [source,english] of Object.entries(desktopEnglish)){
  assert(!/\p{Script=Han}/u.test(english),source);
  assert.equal(desktopText('zh-CN',source),source);
  assert.equal(desktopText('en-US',source),english);
 }
 assert.equal(desktopText('en-US','用户自己的机器名称'),'用户自己的机器名称');
 assert.equal(desktopText('en-US','原生桌面'),'Native desktop');
 assert.equal(desktopText('en-US','停用'),'Off');
});
