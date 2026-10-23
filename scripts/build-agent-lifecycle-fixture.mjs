import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
// Use only an isolated copy of the packaged runtime, never an installed app.
const outfile=process.argv[2];
if(!outfile)throw new Error('Provide an isolated fixture agent.cjs output path');
await build({entryPoints:['src/agent/cli.ts'],outfile,bundle:true,platform:'node',format:'cjs',target:'node22',external:['node-pty'],plugins:[{name:'delayed-app-start',setup(b){b.onLoad({filter:/[\\/]agent[\\/]app\.ts$/},async a=>{let contents=await readFile(a.path,'utf8');contents=contents.replace(/(export async function startCagentApp[^\n]+\{)/,'$1\nawait new Promise(resolve=>setTimeout(resolve,1500));');return {contents,loader:'ts'};});}}]});
