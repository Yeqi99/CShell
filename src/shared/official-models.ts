export const officialModelUrl = 'https://shell.canp.ai/api/v1/models/chat/completions';
export const officialModels = [
  {
    id: 'b3ec7d42-7c04-4ee0-8b01-e67064082f10',
    name: 'Qwen3 8B · 免费',
    model: 'canp-qwen3-8b',
    url: officialModelUrl,
    key: '',
  },
  {
    id: 'f3bd9fe9-b107-461d-929d-26de37b5efb1',
    name: 'Qwen3.5 4B 视觉 · 免费',
    model: 'canp-qwen35-4b',
    url: officialModelUrl,
    key: '',
  },
];
const poolId = /^pool-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
export type CatalogItem = string | {id:string;name?:string;contextWindow?:number};
export const isPooledProvider=(p:{url:string;model:string;id:string})=>p.url===officialModelUrl && poolId.exec(p.model)?.[1]===p.id;
export function catalogProviders(rows:CatalogItem[]){
  return rows.flatMap<{id:string;name:string;model:string;url:string;key:string;contextWindowTokens?:number}>(row=>{
    const model=typeof row==='string'?row:row.id;
    const match=poolId.exec(model);
    if(match)return [{id:match[1],name:(typeof row==='object'&&row.name||model)+' · Pro',model,...(typeof row==='object'&&Number.isSafeInteger(row.contextWindow)&&(row.contextWindow??0)>=1024?{contextWindowTokens:row.contextWindow}:{}),url:officialModelUrl,key:''}];
    return officialModels.filter(p=>p.model===model);
  });
}
export const isOfficialModel = (url: string, model: string) =>
  url === officialModelUrl && (poolId.test(model) || officialModels.some((p) => p.model === model));
