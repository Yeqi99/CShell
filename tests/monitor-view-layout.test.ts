import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mergeMonitorDisplay } from '../src/shared/monitor-view-layout';
import { monitorViewSchema, type MonitorView, type ViewTile } from '../src/shared/monitor-views';
const tile = (displayId: string): ViewTile => ({id:randomUUID(),profileId:randomUUID(),kind:'ssh',label:'Server',displayId,column:0,row:0,width:12,height:12,directory:'',command:'',screen:''});
test('closing display panes survives repeated saves while preserving other screens and source identity',()=>{
  const a=tile('A'),b=tile('B');
  const saved:MonitorView={id:randomUUID(),name:'Fleet',mode:'tile',tiles:[a,b]};
  const own=new Set([a.id]);
  const edited={...saved,tiles:[]};
  const next=mergeMonitorDisplay(saved,edited,own,'A');
  assert.deepEqual(next.tiles,[b]);
  assert.deepEqual(mergeMonitorDisplay(next,edited,own,'A'),next);
  assert.ok(monitorViewSchema.safeParse(next).success);
  assert.deepEqual(saved.tiles,[a,b]);
});
test('display edits cannot inject sources or change other screens',()=>{
  const a=tile('A'),b=tile('B');
  const saved:MonitorView={id:randomUUID(),name:'Fleet',tiles:[a,b]};
  const edited={...saved,tiles:[{...a,width:6,profileId:randomUUID(),command:'unexpected'}, {...b,label:'changed'},tile('C')]};
  const merged=mergeMonitorDisplay(saved,edited,new Set([a.id]),'A');
  assert.deepEqual(merged.tiles,[{...a,width:6},b]);
});
test('closing the final pane produces a valid empty layout',()=>{
 const a=tile('A'),saved:MonitorView={id:randomUUID(),name:'Fleet',tiles:[a]};
 assert.ok(monitorViewSchema.safeParse(mergeMonitorDisplay(saved,{...saved,tiles:[]},new Set([a.id]))).success);
});
