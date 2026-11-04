import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema,isInitializeRequest} from '@modelcontextprotocol/sdk/types.js';
export type GatewayGrant={client:string;account:string;bridgeId:string;expiresAt:number;scopes:string[]};
type Session={transport:StreamableHTTPServerTransport;server:Server;owner:string;token:string;seen:number};
function applicationContract(name:string):Record<string,unknown>{
 if(name==='list_application_tools')return {description:'Discover authorized desktop application and connection capabilities, including connection management, credentials/trust, diagnostics, domains and enabled extensions. Follow nextCursor. Discovery never grants permissions.',inputSchema:{type:'object',properties:{query:{type:'string'},cursor:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},budgetBytes:{type:'integer'}},additionalProperties:false}};
 if(name==='describe_application_tool')return {description:'Read the exact contract of a capability returned by list_application_tools before invoking it.',inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false}};
 if(name==='invoke_application_tool')return {description:'Invoke a discovered capability through the selected desktop MCP client. Live permissions, target scope, review and audit remain enforced. Sessions/tasks belong only to this remote client. Inspect operation status after an uncertain write; do not replay.',inputSchema:{type:'object',properties:{name:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['name','arguments'],additionalProperties:false}};
 return {};
}
/** Dedicated reverse-proxy TLS endpoint. Never connects to a desktop loopback port. */
export function cloudMcpGateway(options:{authorize:(token:string)=>Promise<GatewayGrant>;invoke:(token:string,name:string,args:Record<string,unknown>,operationId:string)=>Promise<unknown>;maxSessions?:number;idleMs?:number;checkMs?:number}){
 const sessions=new Map<string,Session>();let initializing=0;const owner=(token:string)=>createHash('sha256').update(token).digest('hex');
 async function drop(id:string){const s=sessions.get(id);if(!s)return;sessions.delete(id);await s.transport.close();await s.server.close();}
 const timer=setInterval(()=>{for(const [id,s]of sessions){if(Date.now()-s.seen>(options.idleMs??1800000))void drop(id).catch(()=>{});else void options.authorize(s.token).then(g=>{if(g.expiresAt*1000<=Date.now())return drop(id);}).catch(()=>drop(id)).catch(()=>{});}},options.checkMs??10000);timer.unref();
 const http=createServer((req,res)=>{void(async()=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url!=='/mcp'){res.writeHead(404).end();return;}
  if(req.headers.origin){res.writeHead(403).end();return;}
  const token=req.headers.authorization?.match(/^Bearer (csmcp_[A-Za-z0-9_-]{43})$/)?.[1];
  if(!token){res.writeHead(401).end();return;}
  let grant:GatewayGrant;try{grant=await options.authorize(token);}catch{res.writeHead(401).end();return;}
  if(grant.expiresAt*1000<=Date.now()){res.writeHead(401).end();return;}
  const sid=typeof req.headers['mcp-session-id']==='string'?req.headers['mcp-session-id']:undefined;
  let session=sid?sessions.get(sid):undefined;
  if(sid&&(!session||session.owner!==owner(token))){res.writeHead(404).end();return;}
  let body:unknown;
  if(req.method==='POST'){
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}
   try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{res.writeHead(400).end();return;}
  }
  if(!session){
   if(req.method!=='POST'||!isInitializeRequest(body)){res.writeHead(400).end();return;}
   if(sessions.size+initializing>=(options.maxSessions??128)){res.writeHead(429).end();return;}
   initializing++;
   try{
   const server=new Server({name:'CShell Cloud MCP',version:'1.0.0'},{capabilities:{tools:{}}});
   server.setRequestHandler(ListToolsRequestSchema,async()=>{const fresh=await options.authorize(token);return {tools:[...fresh.scopes.map(name=>({name,description:'CShell authorized '+name+'. Results include operationId; after a connection failure query list_operations/get_operation_status, never repeat an unknown write.',inputSchema:{type:'object' as const,additionalProperties:true},...applicationContract(name)})),{name:'list_operations',description:'List this client’s last 100 durable operations; does not execute or replay anything.',inputSchema:{type:'object' as const,additionalProperties:false}},{name:'get_operation_status',description:'Recover a completed result or inspect unknown/running/expired state. Never replays the operation.',inputSchema:{type:'object' as const,properties:{operationId:{type:'string'}},required:['operationId'],additionalProperties:false}}]};});
   server.setRequestHandler(CallToolRequestSchema,async request=>{
    const fresh=await options.authorize(token);if(!fresh.scopes.includes(request.params.name)&&!['list_operations','get_operation_status'].includes(request.params.name))throw Error('MCP_SCOPE_DENIED');
    const supplied=request.params._meta?.['cshell/operationId'];
    const operationId=typeof supplied==='string'?supplied:`${Math.floor(Date.now()/1000)}:${randomUUID()}`;
    let result:unknown;
    try{result=await options.invoke(token,request.params.name,request.params.arguments??{},operationId);}catch(error){const status=(error as {status?:number})?.status;return {isError:true,content:[{type:'text' as const,text:JSON.stringify({operationId,state:'unknown',...(status===429?{code:'MCP_QUOTA_OR_CAPACITY',message:'MCP allowance or capacity exhausted. Inspect usage and query operation status before retrying.'}:{message:'Operation result unconfirmed. Query get_operation_status/list_operations; do not replay writes.'})})}]};}
    return {content:[{type:'text' as const,text:JSON.stringify(result)}]};
   });
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID,enableJsonResponse:false,onsessioninitialized:id=>{sessions.set(id,session!);}});
   session={transport,server,token,owner:owner(token),seen:Date.now()};
   transport.onclose=()=>{if(transport.sessionId)sessions.delete(transport.sessionId);};
   await server.connect(transport);
   session.seen=Date.now();await session.transport.handleRequest(req,res,body);
   }finally{initializing--;}
   return;
  }
  if(grant.expiresAt*1000<=Date.now()){res.writeHead(401).end();return;}
  session.seen=Date.now();await session.transport.handleRequest(req,res,body);
 })().catch(()=>{if(!res.headersSent)res.writeHead(503).end();else res.end();});});
 http.requestTimeout=30000;http.headersTimeout=10000;
 return {http,close:async()=>{clearInterval(timer);await Promise.all([...sessions.keys()].map(drop));await new Promise<void>(r=>http.close(()=>r()));}};
}
