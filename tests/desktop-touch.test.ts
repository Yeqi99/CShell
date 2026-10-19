import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesktopTouch,videoPoint} from '../android/web/desktop-touch';
test('letterboxing excludes black bars and maps portrait and landscape to source',()=>{
 const r={left:10,top:20,width:400,height:800};assert.equal(videoPoint(210,21,r,1920,1080),undefined);assert.deepEqual(videoPoint(210,420,r,1920,1080),{x:.5,y:.5});assert.equal(videoPoint(0,0,r,0,0),undefined);
});
test('tap clicks at pointer, drag holds until release, cancel releases once',()=>{
 const events:unknown[]=[];const t=new DesktopTouch(e=>events.push(e),(x,y)=>{events.push({x,y});return true;});
 t.down(1,1,1);t.up(1);assert.deepEqual(events.slice(1),[{kind:'button',button:0,down:true},{kind:'button',button:0,down:false}]);events.length=0;
 t.down(1,10,10);t.motion(1,40,40);t.cancel();t.up(1);assert.equal(events.filter((e:any)=>e.down===false).length,1);assert.equal(events.filter((e:any)=>e.down===true).length,1);
});
test('two fingers scroll without a click or sticky drag',()=>{const events:any[]=[];const t=new DesktopTouch(e=>events.push(e),()=>true);t.down(1,10,10);t.down(2,20,20);t.motion(2,20,40);t.up(1);t.up(2);assert.deepEqual(events,[{kind:'wheel',delta:60}]);});
test('long press is right click and never also a left click',async()=>{const events:any[]=[];const t=new DesktopTouch(e=>events.push(e),()=>true);t.down(1,10,10);await new Promise(r=>setTimeout(r,600));t.up(1);assert.deepEqual(events,[{kind:'button',button:1,down:true},{kind:'button',button:1,down:false}]);});
test('touch outside displayed video cannot click',()=>{const events:any[]=[];const t=new DesktopTouch(e=>events.push(e),()=>false);t.down(1,0,0);t.up(1);assert.deepEqual(events,[]);});
