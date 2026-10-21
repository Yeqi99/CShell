import { createHash } from 'node:crypto';
import { wechatEventTypes } from '../shared/wechat-events';
import { z } from 'zod';
import { wechatAiEvents } from './wechat-ai-events';
import type { AiEventSource, AiPluginEvent } from '../shared/ai-events';
import type { AgentCall } from '../shared/agent';

export interface RemoteEventTarget {sessionId:string;identity:string;label:string;call(input:AgentCall,signal:AbortSignal):Promise<unknown>}
const subscription=z.object({id:z.string().uuid(),accountId:z.string().min(1).max(160).optional(),state:z.string(),targets:z.array(z.string().max(160)).max(100)});
const pageSchema=z.object({events:z.array(z.unknown()).max(100),nextCursor:z.string().max(100),gap:z.boolean(),listenerState:z.string()});
export const remoteWechatSource=(identity:string)=>'wechat.remote.'+createHash('sha256').update(identity).digest('hex');
/** Bounded durable pull delivery. Only subscriptions owned by this authenticated controller are returned by CAgent. */
export class RemoteWechatEvents {
  private states=new Map<string,{target:RemoteEventTarget;items:z.infer<typeof subscription>[];checked:number;error?:string;warning?:string}>();
  private cursors:Record<string,string>={};
  private busy=false;
  private writes:Promise<void>=Promise.resolve();
  private closed=false;
  private abort=new AbortController();
  constructor(private host:{targets():RemoteEventTarget[];ingest(event:AiPluginEvent):Promise<unknown>;load():Promise<Record<string,string>>;save(cursors:Record<string,string>):Promise<void>}){}
  async init(){this.cursors=z.record(z.string().max(256),z.string().max(100)).parse(await this.host.load());if(Object.keys(this.cursors).length>512)throw new Error('远端事件游标数量超过限制');}
  private live(source:string){if(this.closed)return undefined;const state=this.states.get(source);return state&&this.host.targets().some(t=>t.sessionId===state.target.sessionId&&t.identity===state.target.identity)?state:undefined;}
  sources():AiEventSource[]{return this.host.targets().map(target=>{const id=remoteWechatSource(target.identity),state=this.live(id);return {id,name:`微信 · ${target.label}`,eventTypes:wechatEventTypes(),available:!!state&&!state.error&&Date.now()-state.checked<10000,...((state?.error||state?.warning)?{reason:state.error||state.warning}:{})};});}
  subscriptions(){return [...this.states.keys()].flatMap(source=>{const state=this.live(source);return state&&!state.error?state.items.filter(s=>s.state==='listening').map(s=>({id:s.id,source,name:`${state.target.label} · ${s.targets.join(', ')}`})):[];});}
  session(source:string){return this.live(source)?.target.sessionId;}
  authorized(source:string,id:string,account:string,conversation:string){const state=this.live(source),item=state?.items.find(s=>s.id===id);return !!state&&!state.error&&Date.now()-state.checked<10000&&item?.state==='listening'&&item.accountId===account&&(item.targets.includes('*')||item.targets.includes(conversation));}
  async start(source:string,args:unknown){const state=this.live(source);if(!state)throw new Error('请先连接目标 CAgent');return state.target.call({method:'packages.invoke',params:{packageId:'cagent.wechat',toolId:'wechat_subscribe',args}},this.abort.signal);}
  async tick(){
    if(this.busy||this.closed)return;this.busy=true;
    try{
      const targets=[...new Map(this.host.targets().map(t=>[t.identity,t])).values()].slice(0,16),ids=new Set(targets.map(t=>remoteWechatSource(t.identity)));
      for(const key of this.states.keys())if(!ids.has(key))this.states.delete(key);
      // At most 16 independent machines, one request per machine; a slow host cannot stall others.
      await Promise.all(targets.map(async target=>{
        if(this.closed)return;
        const source=remoteWechatSource(target.identity),previous=this.states.get(source);
        const state={target,items:previous?.target.sessionId===target.sessionId?previous.items:[],checked:previous?.checked??0,error:previous?.error,warning:previous?.warning};this.states.set(source,state);
        const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(5000)]);
        const call=(toolId:string,args:unknown)=>target.call({method:'packages.invoke',params:{packageId:'cagent.wechat',toolId,args}},signal);
        try{
          state.items=z.array(subscription).max(8).parse(await call('wechat_subscriptions',{}));state.checked=Date.now();state.error=undefined;
          for(const item of state.items){
            if(item.state!=='listening'||!item.accountId)continue;
            const key=source+':'+item.id+':'+item.accountId;
            if(!Object.hasOwn(this.cursors,key)&&Object.keys(this.cursors).length>=512)throw new Error('游标已满');
            const page=pageSchema.parse(await call('wechat_events',{subscriptionId:item.id,cursor:this.cursors[key],limit:100,waitSeconds:0}));
            if(page.listenerState!=='listening'){item.state=page.listenerState;continue;}
            // A gap is reported without inventing lost messages. Valid retained events can still trigger.
            if(page.gap)state.warning='消息队列存在缺口；已保留消息继续处理，缺失消息不会补造';
            for(const raw of page.events){
              if(!this.live(source))throw new Error('连接已改变');signal.throwIfAborted();
              const incoming=wechatAiEvents({id:item.id,accountId:item.accountId,event:raw});
              for(const event of incoming)if(item.targets.includes('*')||item.targets.includes(event.conversationId))await this.host.ingest({...event,source});
            }
            this.cursors[key]=page.nextCursor;
            this.writes=this.writes.then(()=>this.host.save({...this.cursors})).catch(error=>{this.closed=true;this.abort.abort();throw error;});await this.writes;
          }
        }catch{state.error='远端微信订阅不可用，请检查机器连接、微信绑定和接收权限';state.items=[];}
      }));
    }finally{this.busy=false;}
  }
  async close(){this.closed=true;this.abort.abort();this.states.clear();await this.writes;}
}
