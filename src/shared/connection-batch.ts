import {extractConnectionByRules} from './connection-rules';
import {extractedConnectionSchema,type ExtractedConnection} from './connection-extraction';

export type ImportColumn='name'|'host'|'port'|'username'|'password'|'group'|'protocol';
export interface ConnectionBatchRow {row:number;connection?:ExtractedConnection;group?:string;error?:string}
const aliases:Record<string,ImportColumn>={name:'name',title:'name',名称:'name',连接名称:'name',host:'host',hostname:'host',address:'host',ip:'host',主机:'host',主机地址:'host',服务器地址:'host',port:'port',端口:'port',user:'username',username:'username',login:'username',用户名:'username',password:'password',pass:'password',密码:'password',group:'group',folder:'group',分组:'group',protocol:'protocol',type:'protocol',协议:'protocol'};
const bounded=(text:string)=>{if(text.length>2*1024*1024||text.includes('\0'))throw Error('导入内容过大或包含无效字符');};
/** RFC 4180 quoting, including embedded newlines. Formula cells are plain text, never evaluated. */
export function readConnectionCsv(text:string,delimiter:','|';'|'\t'=','){
 bounded(text);text=text.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const field=()=>{row.push(cell);cell='';closed=false;if(row.length>100)throw Error('CSV 列数超过 100');};
 const line=()=>{field();if(row.some(value=>value.trim()))rows.push(row);row=[];if(rows.length>5001)throw Error('一次最多导入 5000 条连接');};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c===delimiter){field();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;line();continue;}
  if(closed){if(c===' '||c==='\t')continue;throw Error('CSV 引号后的内容无效');}
  if(c==='"'){if(cell)throw Error('CSV 引号格式无效');quoted=true;}else cell+=c;
 }
 if(quoted)throw Error('CSV 引号未闭合');if(cell||row.length||closed)line();
 const headers=rows.shift()??[];
 const mapping:Partial<Record<ImportColumn,number>>={};
 headers.forEach((header,index)=>{const key=aliases[header.trim().toLowerCase().replace(/[ _-]/g,'')];if(key){if(mapping[key]!==undefined)throw Error('CSV 含重复字段，请明确选择列');mapping[key]=index;}});
 return {headers,rows,mapping};
}
export function connectionsFromCsv(table:ReturnType<typeof readConnectionCsv>,mapping=table.mapping):ConnectionBatchRow[]{
 if(mapping.host===undefined)throw Error('请选择主机地址列');
 const selected=Object.values(mapping);if(selected.some(i=>!Number.isInteger(i)||i!<0||i!>=table.headers.length)||new Set(selected).size!==selected.length)throw Error('列映射无效');
 return table.rows.map((cells,index)=>{
  const row=index+2;
  try{
   if(cells.length!==table.headers.length)throw Error('列数与表头不一致');
   const get=(key:ImportColumn)=>mapping[key]===undefined?'':cells[mapping[key]!]??'';
   const protocol=get('protocol').trim().toLowerCase()||'ssh';if(!['ssh','rdp','sftp','ftp','ftps'].includes(protocol))throw Error('此连接类型不支持批量导入');
   const port=get('port').trim();if(port&&!/^\d+$/.test(port))throw Error('端口必须是数字');
   const fields:Record<string,unknown>={host:get('host').trim(),port:port?Number(port):protocol==='rdp'?3389:['ftp','ftps'].includes(protocol)?21:22};
   for(const key of ['name','username','password'] as const){const value=get(key);if(value)fields[key]=key==='password'?value:value.trim();}
   const parsed=extractedConnectionSchema.safeParse({providerId:'cshell.'+protocol,fields});if(!parsed.success)throw Error('地址、端口或字段格式不正确');
   const group=get('group').trim();if(group.length>80)throw Error('分组名称过长');
   return {row,connection:parsed.data,group};
  }catch(e){return {row,error:(e as Error).message};}
 });
}
/** Explicit multi-target blocks only; does not scan prose or send text to an AI. */
export function connectionsFromText(text:string):ConnectionBatchRow[]{
 bounded(text);const blocks:{row:number;text:string}[]=[];
 const lines=text.replace(/\r\n?/g,'\n').split('\n');
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue;
  const start=/^\s*(?:ssh\s|(?:ssh|rdp|sftp|ftp|ftps):\/\/|(?:主机地址|服务器地址|主机|host|hostname|ip)\s*[:：=])/i.test(line);
  if(start||!blocks.length)blocks.push({row:i+1,text:line});else blocks[blocks.length-1].text+='\n'+line;
  if(blocks.length>5000)throw Error('一次最多导入 5000 条连接');
 }
 return blocks.map(block=>{try{
  if(/^\s*(?:sftp|ftp|ftps):\/\//i.test(block.text)){
   const url=new URL(block.text.trim());if(url.search||url.hash||(url.pathname&&url.pathname!=='/'))throw Error('Only connection endpoints can be imported');
   const protocol=url.protocol.slice(0,-1).toLowerCase();if(!['sftp','ftp','ftps'].includes(protocol))throw Error('Unsupported protocol');
   return {row:block.row,connection:extractedConnectionSchema.parse({providerId:'cshell.'+protocol,fields:{host:url.hostname.replace(/^\[|\]$/g,''),port:url.port?Number(url.port):protocol==='sftp'?22:21,...(url.username?{username:decodeURIComponent(url.username)}:{}),...(url.password?{password:decodeURIComponent(url.password)}:{})}})};
  }
  return {row:block.row,connection:extractConnectionByRules(block.text,/^\s*rdp:\/\//i.test(block.text)?'cshell.rdp':'cshell.ssh')};}catch{return {row:block.row,error:'无法明确识别此连接，请检查地址、端口和分隔方式'};}});
}

export type ConnectionImportPreview = {
  token: string; headers: string[]; mapping: Partial<Record<ImportColumn, number>>;
  rows: { row: number; name?: string; host?: string; port?: number; username?: string; group?: string; protocol?: string; hasPassword?: boolean; duplicate?: boolean; error?: string }[];
};
