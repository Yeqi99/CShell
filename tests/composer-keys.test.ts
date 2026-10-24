import {test} from 'node:test';
import assert from 'node:assert/strict';
import {submitsComposer} from '../src/ui/composer-keys';
const enter={key:'Enter',shiftKey:false,altKey:false,repeat:false,keyCode:13,nativeEvent:{isComposing:false}};
test('Enter submits; Shift+Enter keeps a newline',()=>{
 assert(submitsComposer(enter));assert(!submitsComposer({...enter,shiftKey:true}));
});
test('IME confirmation, legacy 229, repeat and alternate actions do not submit',()=>{
 for(const change of [{nativeEvent:{isComposing:true}},{keyCode:229},{repeat:true},{altKey:true},{key:'Process'}])assert(!submitsComposer({...enter,...change}));
});
