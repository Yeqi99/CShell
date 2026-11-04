import {randomUUID} from 'node:crypto';
type Direction='ingress'|'egress';
type Window={id:string;used:number;budget:number;expires:number;input:Input};
type Input={targetId:string;credential:string;operation:string;direction:Direction;bytes:number;tunnelId:string};
/** Each direction is serialized by its Transform. Unconfirmed settlements retain
 * their server reservation; they never silently release a potentially spent grant. */
export class RelayTrafficBudget {
 private windows=new Map<string,Window>();
 private pending=new Map<string,Promise<unknown>>();
 constructor(private request:(action:'reserve'|'settle',body:Record<string,unknown>)=>Promise<void>,private now=()=>Date.now()){}
 consume(input:Input){return this.serial(input.tunnelId,()=>this.consumeNext(input));}
 private serial<T>(id:string,work:()=>Promise<T>):Promise<T>{const next=(this.pending.get(id)??Promise.resolve()).catch(()=>{}).then(work);this.pending.set(id,next);void next.finally(()=>{if(this.pending.get(id)===next)this.pending.delete(id);}).catch(()=>{});return next;}
 private async consumeNext(input:Input){
  const key=input.tunnelId+':'+input.direction;
  let window=this.windows.get(key);
  if(window&&(window.used+input.bytes>window.budget||window.expires<=this.now())){await this.settle(key,window);window=undefined;}
  if(!window){
   const budget=Math.max(input.bytes,1024*1024),id=randomUUID();
   await this.request('reserve',{...input,id,budget});
   window={id,used:0,budget,expires:this.now()+5000,input};this.windows.set(key,window);
  }
  window.used+=input.bytes;
 }
 private async settle(key:string,w:Window){
  await this.request('settle',{...w.input,id:w.id,ingress:w.input.direction==='ingress'?w.used:0,egress:w.input.direction==='egress'?w.used:0});
  if(this.windows.get(key)===w)this.windows.delete(key);
 }
 close(tunnelId:string){return this.serial(tunnelId,async()=>{for(const [key,w] of this.windows)if(key.startsWith(tunnelId+':'))await this.settle(key,w);});}
}
