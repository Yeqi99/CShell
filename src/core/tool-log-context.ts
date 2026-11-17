/** The original result is already in this task's encrypted log store. */
export function logPreview(raw:string,id:string,tool:string,target:string|undefined,input:unknown){
  let value:Record<string,unknown>={};
  try{const parsed=JSON.parse(raw);if(parsed && typeof parsed==='object')value=parsed;}catch{}
  const args=input && typeof input==='object'?input as Record<string,unknown>:{};
  const errors=typeof value.stderr==='string' && value.stderr.trim()?value.stderr:raw;
  const errorLines=errors.split(/\r?\n/).filter(line=>/error|failed|denied|exception|错误|失败/i.test(line)).slice(0,4);
  const receipt={
    cshellLog:1,tool,target,command:typeof args.command==='string'?args.command:undefined,
    exitCode:value.exitCode??value.code,errors:errorLines.map(line=>line.slice(0,250)),
    task_log_read:{id,offset:0},
  };
  return JSON.stringify(receipt)+'\n'+raw.slice(0,1800)+'\n…\n'+raw.slice(-1000);
}

/** Shrink only outputs with a recoverable original. Recognize older saved transcripts too. */
export function storedLogReceipt(content:unknown):string|undefined{
  if(typeof content!=='string')return;
  const line=content.split('\n',1)[0];
  try{
    const receipt=JSON.parse(line);
    if(receipt.cshellLog===1 && typeof receipt.tool==='string' && typeof receipt.task_log_read?.id==='string' &&
       /^[\da-f-]{36}$/i.test(receipt.task_log_read.id))return line;
  }catch{}
  const legacy=content.match(/\[完整日志[^\]\n]*task_log_read[^\]\n]*?id=([\da-f-]{36})[^\]\n]*\]/i);
  if(legacy)return content.slice(0,240)+'\n'+legacy[0]+'\n'+content.slice(-240);
}
