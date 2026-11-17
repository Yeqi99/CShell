import catalog from './model-context-catalog.json';

type Source = keyof typeof catalog;
interface ModelInfo {
  model: string;
  url?: string;
  endpoint?: string;
  contextWindowTokens?: number;
  contextCatalog?: Source;
}

const hosts: Record<string, Source> = {
  'api.deepseek.com':'deepseek', 'api.xiaomimimo.com':'xiaomi',
  'dashscope.aliyuncs.com':'alibaba-cn', 'dashscope-intl.aliyuncs.com':'alibaba',
  'api.openai.com':'openai', 'api.anthropic.com':'anthropic',
};
const windows = new Map<string,number>();
// Shipped provider-specific limits from models.dev/api.json; the runtime catalog takes precedence.
for(const [provider,groups] of Object.entries(catalog)) {
  for(const group of groups) {
    const [limit,models]=group as [number,string[]];
    for(const model of models) windows.set(provider+'/'+model,limit);
  }
}

export function modelContextWindow(info:ModelInfo) {
  const configured=info.contextWindowTokens;
  if(configured && Number.isSafeInteger(configured) && configured>=1024) return configured;
  let source=info.contextCatalog;
  if(!source){
    try{source=hosts[new URL(info.url??info.endpoint??'').hostname];}catch{}
  }
  return (source && windows.get(source+'/'+info.model.toLowerCase())) || 32768;
}

// Conservative multilingual estimate for admission only; billing always uses provider usage.
export function estimateContextTokens(value:unknown) {
  const json=JSON.stringify(value,(_key,v)=>typeof v==='string' && v.startsWith('data:image/') ? '[image]' : v)??'';
  let ascii=0,nonAscii=0;
  for(const ch of json){ if(ch.charCodeAt(0)<128)ascii++;else nonAscii+=ch.length; }
  return Math.ceil(ascii/3)+nonAscii+4;
}

export function contextInputLimit(info:ModelInfo,tools:unknown,images=0){
  const window=modelContextWindow(info);
  const replyReserve=Math.min(8192,Math.ceil(window/8));
  return Math.max(0,Math.floor((window-replyReserve)*0.85)-estimateContextTokens(tools)-images*2048);
}
