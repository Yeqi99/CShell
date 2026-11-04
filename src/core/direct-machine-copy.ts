import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {MachineFile} from './machine-file-copy';
type Call=(method:string,input:unknown,signal?:AbortSignal)=>Promise<unknown>;
/** A failed probe permits fallback. Once pull starts its outcome must not be replayed. */
export async function directMachineCopy(source:Call,target:Call,address:{host:string;port:number},from:MachineFile,to:MachineFile,parentSignal:AbortSignal,guard:()=>void,progress:(done:number,total:number)=>void){
 const controller=new AbortController(),signal=AbortSignal.any([parentSignal,controller.signal]);
 let ticket='';const id=randomUUID();let request:unknown;
 try{
  try{guard();signal.throwIfAborted();const identity=z.object({fingerprint:z.string()}).parse(await target('files.transferIdentity',{},signal));guard();
   const grant=z.object({ticket:z.string(),certificate:z.string(),size:z.number().nonnegative()}).parse(await source('files.transferGrant',{file:from,recipient:identity.fingerprint},signal));ticket=grant.ticket;
   request={id,...address,certificate:grant.certificate,ticket,destination:to};guard();await target('files.transferProbe',request,AbortSignal.any([signal,AbortSignal.timeout(7000)]));progress(0,grant.size);
  }catch{signal.throwIfAborted();guard();return undefined;}
  guard();let polling=false;const timer=setInterval(()=>{if(polling)return;polling=true;void Promise.resolve().then(()=>{try{guard();}catch(error){controller.abort(error);throw error;}return target('files.transferStatus',{id},signal);}).then(value=>{const state=z.object({done:z.number(),total:z.number()}).parse(value);progress(state.done,state.total);}).catch(()=>{}).finally(()=>{polling=false;});},500);
  try{const result=z.object({bytes:z.number().nonnegative(),sha256:z.string(),route:z.string(),verified:z.boolean().optional()}).parse(await target('files.transferPull',request,signal));guard();progress(result.bytes,result.bytes);return result;}finally{clearInterval(timer);}
 }finally{if(ticket)await source('files.transferRevoke',{ticket},AbortSignal.timeout(5000)).catch(()=>{});}
}
