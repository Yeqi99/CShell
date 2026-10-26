import {z} from 'zod';
import type {ClientVault} from '../core/client/identity';
import {AgentJobs} from '../core/agent-jobs';
export const environmentValues=z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/).refine(n=>!/^CSHELL_|^ELECTRON_|^NODE_OPTIONS$|^NODE_EXTRA_CA_CERTS$/i.test(n),'Reserved variable'),z.string().max(8192).refine(v=>!v.includes('\0')).nullable()).refine(v=>Object.keys(v).length<=100);
const savedEnvironment=z.record(z.string(),z.string());
export class ManagedEnvironment {
 private values:Record<string,string>={};
 constructor(private vault:ClientVault,private apply:(values:Record<string,string>)=>void){}
 async load(){this.values=await this.vault.read('managed-environment',savedEnvironment)??{};this.apply({...this.values});}
 snapshot(){return {names:Object.keys(this.values).sort(),scope:'cagent-new-processes'};}
 async save(input:unknown){const {variables}=z.object({variables:environmentValues}).strict().parse(input);const next={...this.values};for(const [name,value] of Object.entries(variables)){for(const key of Object.keys(next))if(process.platform==='win32'&&key.toLowerCase()===name.toLowerCase())delete next[key];if(value===null)delete next[name];else next[name]=value;}if(Object.keys(next).length>100)throw Error('最多配置100个变量');await this.vault.write('managed-environment',next);this.values=next;this.apply({...next});return this.snapshot();}
}
export class ManagedScripts {
 private jobs=new AgentJobs();private owners=new Set<string>();private closed=new AbortController();
 constructor(private allowed:(owner:string,shell?:string)=>boolean,private execute:(input:unknown,signal:AbortSignal,output:(s:string)=>void)=>Promise<{exitCode:number}>){}
 get activity(){return [...this.owners].reduce((n,o)=>n+this.jobs.list(o).filter(j=>j.state==='running').length,0);}
 async start(owner:string,input:unknown){this.closed.signal.throwIfAborted();const p=z.object({shell:z.enum(['powershell','cmd','sh','bash','zsh']),command:z.string().min(1).max(16384),timeoutMs:z.number().int().min(1000).max(86400000).default(3600000)}).strict().parse(input);if(!this.allowed(owner,p.shell))throw Error('未授权执行此Shell');this.owners.add(owner);return this.jobs.start(owner,this.closed.signal,async(signal,output)=>{const revoke=new AbortController();const timer=setInterval(()=>{if(!this.allowed(owner,p.shell))revoke.abort(Error('授权已撤销'));},200);try{const combined=AbortSignal.any([signal,revoke.signal]);combined.throwIfAborted();if(!this.allowed(owner,p.shell))throw Error('授权已撤销');const result=await this.execute(p,combined,output);combined.throwIfAborted();if(result.exitCode!==0)throw Error('进程退出码 '+result.exitCode);return '进程已退出，退出码 0';}finally{clearInterval(timer);}});}
 query(owner:string,input:unknown,stop=false){if(!this.allowed(owner))throw Error('未授权管理任务');return this.jobs.query(owner,input,stop);}
 async close(){this.closed.abort();await Promise.all([...this.owners].map(o=>this.jobs.stopOwner(o)));}
}
