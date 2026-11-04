import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {AgentFiles} from './files';
import {dial} from '../core/client/provider';
import {fingerprint,type ClientIdentity} from '../core/client/identity';
import {copyMachineFile} from '../core/machine-file-copy';
const location=z.object({root:z.string().uuid(),path:z.string().min(1).max(4096)}).strict();
const pin=z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
type Ticket={owner:string;recipient:string;file:z.infer<typeof location>;expires:number;deadline:number;offset:number;version:string;busy:boolean;connection?:AbortSignal};
/** Short-lived, recipient-certificate-bound read capabilities, never passwords. */
export class DirectFileTransfer {
 private progress=new Map<string,{owner:string;done:number;total:number;expires:number;active:boolean}>();
 private tickets=new Map<string,Ticket>();
 constructor(private files:AgentFiles,private identity:()=>Promise<ClientIdentity>,private authorized:(owner:string)=>boolean){}
 async manage(method:string,raw:unknown,owner:string,signal:AbortSignal){
  if(!this.authorized(owner))throw Error('File transfer authorization revoked');
  for(const [key,t] of this.tickets)if(t.expires<Date.now())this.tickets.delete(key);
  if(method==='files.transferStatus'){const id=z.object({id:z.string().uuid()}).strict().parse(raw).id,t=this.progress.get(id);if(!t||t.owner!==owner)throw Error('Unknown transfer');return{done:t.done,total:t.total};}
  for(const [id,p] of this.progress)if(p.expires<Date.now())this.progress.delete(id);
  if(method==='files.transferIdentity'){const id=await this.identity();return{certificate:id.certificate,fingerprint:fingerprint(id.certificate)};}
  if(method==='files.transferRevoke'){const p=z.object({ticket:z.string().length(64)}).strict().parse(raw);const t=this.tickets.get(p.ticket);if(t?.owner===owner)this.tickets.delete(p.ticket);return{};}
  if(method==='files.transferGrant'){
   const p=z.object({file:location,recipient:pin}).strict().parse(raw);if(this.tickets.size>=16)throw Error('Transfer capacity reached');
   const first=await this.files.call('files.read',{...p.file,offset:0},owner,signal) as {version:string;size:number};const token=randomBytes(32).toString('hex');
   this.tickets.set(token,{owner,recipient:p.recipient,file:p.file,offset:0,version:first.version,busy:false,expires:Date.now()+60000,deadline:Date.now()+15*60_000});
   return{ticket:token,expiresAt:Date.now()+60000,size:first.size,certificate:(await this.identity()).certificate};
  }
  if(method==='files.transferPull'||method==='files.transferProbe'){
   const p=z.object({id:z.string().uuid().optional(),host:z.string().min(1).max(253).refine(s=>!/[\s/\\]/.test(s)),port:z.number().int().min(1).max(65535),certificate:z.string().min(100).max(8192),ticket:z.string().regex(/^[a-f0-9]{64}$/),destination:location}).strict().parse(raw);
   const channel=await dial({host:p.host,port:p.port,certificate:p.certificate},await this.identity(),()=>{},signal);
   try{
    // Prove recipient identity/ticket before creating a destination temporary file.
    await channel.request('file-ticket',{ticket:p.ticket,probe:true},5000);
    if(method==='files.transferProbe')return{ready:true};
    if(!p.id||this.progress.has(p.id)||[...this.progress.values()].filter(s=>s.active).length>=4)throw Error('Transfer busy');
    for(const [key,old] of this.progress)if(this.progress.size>=64&&!old.active)this.progress.delete(key);
    const state={owner,done:0,total:0,active:true,expires:Date.now()+16*60_000};this.progress.set(p.id,state);
    const result=await copyMachineFile((_m,input)=>{if(!this.authorized(owner))throw Error('File transfer authorization revoked');const {offset,version}=input as any;return channel.request('file-ticket',{ticket:p.ticket,offset,version},15000);},{root:'',path:''},(m,input,s)=>{if(!this.authorized(owner))throw Error('File transfer authorization revoked');return this.files.call(m,input,owner,s??signal);},p.destination,signal,(done,total)=>{state.done=done;state.total=total;});
    return {...result,route:'machine-direct'};
   }finally{channel.socket.destroy();if(p.id){const state=this.progress.get(p.id);if(state?.owner===owner){state.active=false;state.expires=Date.now()+30000;}}}
  }
  throw Error('Unknown transfer operation');
 }
 async read(raw:unknown,recipient:string,signal:AbortSignal){
  const p=z.object({ticket:z.string().regex(/^[a-f0-9]{64}$/),probe:z.literal(true).optional(),offset:z.number().int().nonnegative().optional(),version:z.string().max(512).optional()}).strict().parse(raw),t=this.tickets.get(p.ticket);
  if(!t||t.recipient!==recipient||t.expires<Date.now()||t.deadline<Date.now()||!this.authorized(t.owner))throw Error('Transfer ticket expired or unauthorized');
  if(p.probe)return{ready:true};if(t.connection&&t.connection!==signal)throw Error('Transfer ticket already consumed by another connection');if(!t.connection){t.connection=signal;signal.addEventListener('abort',()=>this.tickets.delete(p.ticket),{once:true});}if(t.busy||p.offset!==t.offset||p.version!==undefined&&p.version!==t.version)throw Error('Transfer position invalid');t.busy=true;
  try{const result=await this.files.call('files.read',{...t.file,offset:t.offset,version:t.version},t.owner,signal) as {next:number;done:boolean};t.offset=result.next;t.expires=Math.min(t.deadline,Date.now()+60000);if(result.done)this.tickets.delete(p.ticket);return result;}
  catch(error){this.tickets.delete(p.ticket);throw error;}finally{t.busy=false;}
 }
 close(){this.tickets.clear();this.progress.clear();}
}
