import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopTextChunks} from '../src/ui/desktop-paste';
import {desktopViewInputSchema} from '../src/shared/desktop-view';

test('remote text paste preserves Unicode and line breaks within wire limits',()=>{
 const text='a'.repeat(511)+'🙂\r\n中文'.repeat(300);
 const chunks=desktopTextChunks(text);
 assert.equal(chunks.join(''),text);
 for(const chunk of chunks){assert.ok(chunk.length<=512);assert.ok(!/[\uD800-\uDBFF]$/.test(chunk));desktopViewInputSchema.parse({kind:'text',text:chunk});}
});
test('remote paste bounds reject unsupported data before any input',()=>{
 assert.deepEqual(desktopTextChunks(''),[]);
 assert.throws(()=>desktopTextChunks('a\0b'));
 assert.throws(()=>desktopTextChunks('x'.repeat(2_000_001)));
});
