import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RelayTrafficBudget} from '../services/cloud-relay/traffic-budget';
test('relay windows batch chunks and settle exact directional bytes on close',async()=>{
 const calls:{action:string;body:any}[]=[];const meter=new RelayTrafficBudget(async(action,body)=>{calls.push({action,body});});
 const input={targetId:'a',credential:'secret',operation:'forward',direction:'ingress' as const,bytes:1024,tunnelId:'t'};
 for(let i=0;i<100;i++)await meter.consume(input);
 assert.equal(calls.length,1);await meter.close('t');assert.equal(calls.length,2);assert.equal(calls[1].body.ingress,102400);assert.equal(calls[1].body.egress,0);
});
test('reserve failure prevents consumption; concurrent close waits for in-flight grant',async()=>{
 const denied=new RelayTrafficBudget(async()=>{throw Error('limit');});await assert.rejects(denied.consume({targetId:'a',credential:'s',operation:'forward',direction:'egress',bytes:10,tunnelId:'t'}));
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);const calls:any[]=[];
 const meter=new RelayTrafficBudget(async(a,b)=>{if(a==='reserve')await gate;calls.push([a,b]);});
 const operation=meter.consume({targetId:'a',credential:'s',operation:'forward',direction:'egress',bytes:10,tunnelId:'t'});const close=meter.close('t');release();await Promise.all([operation,close]);assert.equal(calls[1][1].egress,10);
});
