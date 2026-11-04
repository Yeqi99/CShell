import {createAgentRuntime} from '../../src/agent/runtime';
import {createInterface} from 'node:readline';
const runtime=await createAgentRuntime({directory:process.argv[2]});
process.stdout.write(JSON.stringify({ready:true})+'\n');
const lines=createInterface({input:process.stdin});
for await(const line of lines){const p=JSON.parse(line);try{if(p.method==='close'){await runtime.close();process.stdout.write(JSON.stringify({id:p.id,result:true})+'\n');break;}const result=await runtime.dispatch(p.method,p.params);process.stdout.write(JSON.stringify({id:p.id,result})+'\n');}catch(e){process.stdout.write(JSON.stringify({id:p.id,error:String(e)})+'\n');}}
await runtime.close();
