import {randomBytes, randomUUID} from 'node:crypto';
import {readFile, writeFile, rename} from 'node:fs/promises';
import {hostname} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import type {SecretCodec} from './store';
import type {CloudSync} from './cloud-sync';
import type {McpService} from './mcp';

const identitySchema = z.object({bridgeId:z.string().uuid(),secret:z.string().min(43).max(128)}).strict();
const requestSchema = z.object({id:z.string().regex(/^[a-f0-9]{48}$/),consumer:z.string().min(32).max(128),
  name:z.enum(['list_servers_page','connect','describe_connection','invoke_connection','disconnect','list_application_tools','describe_application_tool','invoke_application_tool']),
  arguments:z.record(z.string(),z.unknown())}).strict();

/** Opt-in outbound transport; local MCP caller grants remain authoritative. */
export class AccountMcpBridge {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopped = false;
  private account?: string;
  private registration?: z.infer<typeof identitySchema>;
  private owners = new Map<string,string>();
  private active = new Set<AbortController>();
  constructor(private directory:string, private codec:SecretCodec, private cloud:CloudSync,
    private service:()=>McpService|undefined) {}

  start() {
    this.timer = setInterval(()=>{void this.tick();},2000);
    this.timer.unref();
    void this.tick();
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for(const controller of this.active) controller.abort();
    this.owners.clear();
  }
  private async identity(account:string) {
    const path = join(this.directory, 'account-mcp-' + account + '.enc');
    if(!/^[a-f0-9]{32}$/.test(account)) throw Error('Invalid account identity');
    try { return identitySchema.parse(JSON.parse(await this.codec.decrypt(await readFile(path,'utf8')))); }
    catch(error) {
      if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const value={bridgeId:randomUUID(),secret:randomBytes(32).toString('base64url')};
      await writeFile(path+'.tmp',await this.codec.encrypt(JSON.stringify(value)),{mode:0o600,flag:'wx'});
      await rename(path+'.tmp',path);
      return value;
    }
  }
  private async tick() {
    if(this.busy || this.stopped) return;
    this.busy = true;
    try {
      const mcp=this.service(), status=mcp?.status(), account=this.cloud.accountId();
      const clientId=status?.settings.accountBridge?.clientId;
      const enabled=!!(mcp && status?.running && status.settings.enabled && clientId &&
        status.settings.clients?.some(client=>client.id===clientId && client.enabled) && account && !this.cloud.activationDeferred());
      if(!enabled) {
        for(const controller of this.active) controller.abort();
        if(this.registration && account===this.account) {
          try { await this.cloud.accountRequest('/v1/mcp/remove',this.registration); } catch { /* expires offline */ }
        }
        this.registration=undefined; this.owners.clear();
        return;
      }
      if(account!==this.account) {this.registration=undefined;this.owners.clear();this.account=account;}
      if(!this.registration) {
        const registration=await this.identity(account!);
        await this.cloud.accountRequest('/v1/mcp/register',{...registration,name:hostname().slice(0,80)});
        if(this.stopped || this.cloud.accountId()!==account) return;
        this.registration=registration;
      }
      const registration=this.registration;
      const reply=await this.cloud.accountRequest('/v1/mcp/poll',{...registration,capacity:Math.max(0,8-this.active.size)});
      const jobs=z.array(requestSchema).max(8).parse(reply.requests);
      for(const job of jobs) {
        if(this.active.size>=8) break;
        void this.execute(job,account!,clientId!,registration);
      }
    } catch { /* Registration/read may retry; commands are never replayed. */ }
    finally {this.busy=false;}
  }
  private async execute(job:z.infer<typeof requestSchema>,account:string,clientId:string,
    registration:z.infer<typeof identitySchema>) {
    const controller=new AbortController();this.active.add(controller);
    let result:unknown;
    try {
      const mcp=this.service(),status=mcp?.status();
      if(this.stopped || this.cloud.accountId()!==account || !mcp || !status?.running ||
        status.settings.accountBridge?.clientId!==clientId) throw Error('Authorization changed');
      const invocation=job.name==='invoke_application_tool'?z.object({name:z.string(),arguments:z.record(z.string(),z.unknown())}).strict().parse(job.arguments):{name:job.name,arguments:job.arguments};
      const session=invocation.arguments.sessionId;
      if(['describe_connection','invoke_connection','disconnect'].includes(invocation.name) &&
        (typeof session!=='string' || this.owners.get(session)!==job.consumer)) throw Error('Session ownership mismatch');
      if(invocation.name==='connect' && this.owners.size>=64) throw Error('Too many connections');
      const value=await mcp.accountBridgeCall(clientId,job.consumer,job.name,job.arguments,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));
      if(invocation.name==='connect') this.owners.set(z.string().uuid().parse(value.sessionId),job.consumer);
      if(invocation.name==='disconnect' && typeof session==='string') this.owners.delete(session);
      result={ok:true,result:value};
    } catch { result={ok:false,error:'CShell could not confirm completion; inspect status before retrying.'}; }
    finally {this.active.delete(controller);}
    if(!this.stopped && this.cloud.accountId()===account) {
      try {await this.cloud.accountRequest('/v1/mcp/reply',{...registration,id:job.id,result});} catch { /* Never repeat the operation. */ }
    }
  }
}
