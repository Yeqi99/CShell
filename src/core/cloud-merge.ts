import { isDeepStrictEqual as equal } from 'node:util';
/** Three-way merge: independent edits compose; conflicting edits never silently win. */
export function mergeCloud(base: any, local: any, remote: any, path: string[] = []): any {
  if(equal(local,remote)||equal(base,remote))return structuredClone(local);
  if(equal(base,local))return structuredClone(remote);
  if(path.join('.')==='ai.policy')throw Error('权限设置在多端被修改，已保留原始权限，请选择要恢复的版本');
  const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  if(object(base)&&object(local)&&object(remote)){
    const result:Record<string,unknown>=Object.create(null);
    for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
      if(['__proto__','prototype','constructor'].includes(key))throw Error('不支持的配置字段');
      const value=mergeCloud(base[key],local[key],remote[key],[...path,key]);if(value!==undefined)result[key]=value;
    }return result;
  }
  if([base,local,remote].every(Array.isArray)){
    const all=[...base,...local,...remote];
    const field=['deviceId','id'].find(k=>all.every(v=>object(v)&&typeof v[k]==='string'));
    if(field&&all.length){
      const map=(items:any[])=>{const m=new Map<string,any>();for(const v of items){if(m.has(v[field]))throw Error('配置包含重复标识');m.set(v[field],v)}return m};
      const b=map(base),l=map(local),r=map(remote),result=[];
      for(const key of new Set([...l.keys(),...r.keys(),...b.keys()])){const value=mergeCloud(b.get(key),l.get(key),r.get(key),[...path,key]);if(value!==undefined)result.push(value)}return result;
    }
  }
  throw Error('同一项配置在多端被修改，已保留原始数据');
}
