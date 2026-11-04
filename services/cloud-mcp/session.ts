import {createHash,randomBytes,randomUUID} from 'node:crypto';

export interface McpPrincipal {account:string;client:string;device:string;revision:number}
export interface McpGrant extends McpPrincipal {expiresAt:number;scopes:readonly string[]}
export interface McpOperation {id:string;digest:string;state:'accepted'|'running'|'completed'|'unknown';result?:unknown}
export interface McpJournal {
 /** Atomically persist before acknowledging. Return existing record on duplicate. */
 create(session:string, operation:McpOperation):McpOperation;
 get(session:string,id:string):McpOperation|undefined;
 update(session:string,operation:McpOperation):void;
}
type Session={id:string;grant:McpGrant;tokenHash:string;generation:number;attached:boolean;lastSeen:number;revoked:boolean};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class CloudMcpSessions {
 private sessions=new Map<string,Session>();
 constructor(private options:{
  journal:McpJournal;
  /** Must check live membership, client revocation, device ownership and permission revision. */
  authorize:(principal:McpPrincipal)=>Promise<McpGrant|null>;
  now?:()=>number;maxSessions?:number;heartbeatMs?:number;
 }){}
 private now(){return this.options.now?.()??Date.now();}
 private async valid(s:Session){
  if(s.revoked||s.grant.expiresAt<=this.now())throw Error('MCP_SESSION_EXPIRED');
  const grant=await this.options.authorize(s.grant);
  if(s.revoked||!grant||grant.expiresAt<=this.now()||grant.account!==s.grant.account||grant.client!==s.grant.client||grant.device!==s.grant.device||grant.revision!==s.grant.revision){s.revoked=true;throw Error('MCP_ACCESS_REVOKED');}
  s.grant=grant;return s;
 }
 private async session(id:string,token:string){
  const s=this.sessions.get(id);
  if(!s||s.tokenHash!==hash(token))throw Error('MCP_UNAUTHORIZED');
  return this.valid(s);
 }
 async open(principal:McpPrincipal){
  for(const [id,s] of this.sessions)if(s.revoked||s.grant.expiresAt<=this.now())this.sessions.delete(id);
  if(this.sessions.size>=(this.options.maxSessions??256))throw Error('MCP_CAPACITY');
  const grant=await this.options.authorize(principal);
  if(!grant||grant.expiresAt<=this.now()||grant.account!==principal.account||grant.client!==principal.client||grant.device!==principal.device||grant.revision!==principal.revision)throw Error('MCP_UNAUTHORIZED');
  // Re-check capacity after async authorization; no await between check and insert.
  if(this.sessions.size>=(this.options.maxSessions??256))throw Error('MCP_CAPACITY');
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  this.sessions.set(id,{id,grant,tokenHash:hash(token),generation:0,attached:false,lastSeen:this.now(),revoked:false});
  return {id,token,expiresAt:grant.expiresAt};
 }
 async attach(id:string,token:string){const s=await this.session(id,token);s.attached=true;s.lastSeen=this.now();return {generation:++s.generation,heartbeatMs:this.options.heartbeatMs??15000};}
 async heartbeat(id:string,token:string,generation:number){const s=await this.session(id,token);this.connection(s,generation);s.lastSeen=this.now();return {expiresAt:s.grant.expiresAt};}
 private connection(s:Session,generation:number){if(!s.attached||s.generation!==generation||this.now()-s.lastSeen>(this.options.heartbeatMs??15000)*3)throw Error('MCP_CONNECTION_STALE');}
 detach(id:string,generation:number){const s=this.sessions.get(id);if(s?.generation===generation)s.attached=false;}
 revokeClient(account:string,client:string){for(const s of this.sessions.values())if(s.grant.account===account&&s.grant.client===client){s.revoked=true;s.attached=false;}}
 async submit(id:string,token:string,generation:number,input:{id:string;scope:string;payload:unknown}){
  const s=await this.session(id,token);this.connection(s,generation);
  if(!s.grant.scopes.includes(input.scope))throw Error('MCP_SCOPE_DENIED');
  if(!/^[a-zA-Z0-9_-]{8,128}$/.test(input.id))throw Error('MCP_INVALID_OPERATION');
  const encoded=JSON.stringify({scope:input.scope,payload:input.payload});if(Buffer.byteLength(encoded)>1024*1024)throw Error('MCP_PAYLOAD_TOO_LARGE');
  const digest=hash(encoded),old=this.options.journal.get(id,input.id);
  if(old){if(old.digest!==digest)throw Error('MCP_OPERATION_CONFLICT');return {dispatch:false,operation:old};}
  const operation=this.options.journal.create(id,{id:input.id,digest,state:'accepted'});
  if(operation.digest!==digest)throw Error('MCP_OPERATION_CONFLICT');
  // Persist running before any network send; crash or lost ACK never authorizes a replay.
  if(operation.state!=='accepted')return {dispatch:false,operation};
  const running={...operation,state:'running' as const};this.options.journal.update(id,running);
  return {dispatch:true,operation:running};
 }
 async query(id:string,token:string,operation:string){await this.session(id,token);return this.options.journal.get(id,operation)??null;}
 /** Called by the authenticated, generation-bound device channel, not the public client. */
 async settle(id:string,token:string,generation:number,operation:string,result:unknown,unknown=false){
  const s=await this.session(id,token);this.connection(s,generation);const old=this.options.journal.get(id,operation);if(!old||old.state!=='running')throw Error('MCP_OPERATION_STATE');
  if(Buffer.byteLength(JSON.stringify(result)??'null')>1024*1024)throw Error('MCP_RESULT_TOO_LARGE');
  this.options.journal.update(id,{...old,state:unknown?'unknown':'completed',result});
 }
}

/** One metering classification per gateway stream. Do not also report it as relay. */
export function mcpTraffic(stream:string,ingressBytes:number,egressBytes:number){
 if(!stream||[ingressBytes,egressBytes].some(v=>!Number.isSafeInteger(v)||v<0))throw Error('MCP_INVALID_COUNTER');
 return {stream,category:'mcp' as const,ingressBytes,egressBytes};
}
