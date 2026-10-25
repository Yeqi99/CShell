export type AgentUpdateActivity = Record<string, number>;
export type AgentUpdatePlan = { cancel(): Promise<unknown>; commit(): Promise<unknown> | unknown; recover?():Promise<unknown> };

/** A prepare/commit coordinator with a real admission barrier. Read polling is
 * not activity; active work, queued mutations and owned resources are. */
export class SafeAgentUpdate {
  private timer?: ReturnType<typeof setInterval>;
  private busy=false;
  private closed=false;
  private idleSince?: number;
  private prepared?: AgentUpdatePlan;
  private requested=false;
  private state:{phase:string;blocking?:string[];error?:string}={phase:'idle'};
  constructor(private options:{
    available():{phase:string;automatic?:boolean;version?:string;path?:string};
    activity():AgentUpdateActivity;
    prepare():Promise<AgentUpdatePlan>;
    admission(closed:boolean):void;
    shutdown():Promise<void>;
    now?:()=>number;
    idleMs?:number;
  }){}
  status(){return {...this.state,protocol:1,activity:this.options.activity()};}
  start(){if(this.timer||this.closed)return;this.timer=setInterval(()=>void this.tick(),15000);this.timer.unref();void this.tick();}
  private preparedFor?:string;
  close(){this.closed=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;if(this.state.phase!=='installing')void this.prepared?.cancel().catch(()=>{});}
  async request(){this.requested=true;await this.tick();return this.status();}
  async tick(){
    if(this.closed||this.busy||this.state.phase==='installing')return;
    const available=this.options.available();
    const revision=JSON.stringify([available.version,available.path]);
    this.busy=true;
    let shutdownStarted=false,commitStarted=false;
    try{
      if(this.prepared&&(this.preparedFor!==revision||available.phase!=='ready')){await this.prepared.cancel();this.prepared=undefined;this.preparedFor=undefined;this.idleSince=undefined;}
      if(available.phase!=='ready'||(!available.automatic&&!this.requested)){this.idleSince=undefined;return;}
      const blocking=Object.entries(this.options.activity()).filter(([,count])=>!Number.isFinite(count)||count>0).map(([name])=>name);
      if(blocking.length){this.idleSince=undefined;this.state={phase:'waiting',blocking};return;}
      const now=(this.options.now??Date.now)();
      this.idleSince??=now;
      if(now-this.idleSince<(this.options.idleMs??30000)){this.state={phase:'waiting',blocking:[]};return;}
      if(!this.prepared){this.state={phase:'preparing'};this.prepared=await this.options.prepare();this.preparedFor=revision;}
      if(this.closed){await this.prepared.cancel();this.prepared=undefined;return;}
      const latest=this.options.available();
      if(latest.phase!=='ready'||JSON.stringify([latest.version,latest.path])!==revision||(!latest.automatic&&!this.requested)){await this.prepared.cancel();this.prepared=undefined;this.preparedFor=undefined;this.idleSince=undefined;return;}
      // No asynchronous gap between closing admission and reading all activity.
      this.options.admission(true);
      const late=Object.entries(this.options.activity()).filter(([,count])=>!Number.isFinite(count)||count>0).map(([name])=>name);
      if(late.length){this.options.admission(false);this.idleSince=undefined;this.state={phase:'waiting',blocking:late};return;}
      this.state={phase:'installing'};
      shutdownStarted=true;
      await this.options.shutdown();
      commitStarted=true;
      await this.prepared.commit();
    }catch(error){
      if(shutdownStarted&&!commitStarted)try{await this.prepared?.recover?.();}catch(recovery){error=new AggregateError([error,recovery],'更新关闭失败，原后台恢复尚未确认');}
      this.options.admission(false);await this.prepared?.cancel().catch(()=>{});this.prepared=undefined;
      this.state={phase:'failed',error:error instanceof Error?error.message:'更新准备失败'};
      this.idleSince=undefined;
    }finally{this.busy=false;}
  }
}
