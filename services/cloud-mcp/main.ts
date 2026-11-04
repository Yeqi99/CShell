import {cloudMcpGateway} from './gateway';
const secret=process.env.MCP_AUTH_TOKEN;if(!secret)throw Error('Missing MCP gateway credential');
async function backend(path:string,body:unknown){const r=await fetch('http://127.0.0.1:8789/v1/admin/mcp/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Mcp-Token':secret!},body:JSON.stringify(body),signal:AbortSignal.timeout(28000),redirect:'error'});if(!r.ok){await r.body?.cancel();throw Object.assign(Error(r.status===429?'MCP allowance or capacity exhausted; inspect usage before retrying.':r.status===403?'Membership or operation permission required.':'MCP operation result unconfirmed.'),{status:r.status});}return r.json();}
const gateway=cloudMcpGateway({authorize:token=>backend('authorize',{token}),invoke:(token,name,args,operationId)=>backend('invoke',{token,name,arguments:args,operationId})});
gateway.http.listen(Number(process.env.MCP_GATEWAY_PORT||8791),'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>void gateway.close());
