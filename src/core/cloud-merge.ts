import { isDeepStrictEqual as equal } from 'node:util';
/** Three-way merge: independent edits compose; conflicting edits never silently win. */
export function mergeCloud(base: any, local: any, remote: any, path: string[] = []): any {
  if(equal(local,remote)||equal(base,remote))return structuredClone(local);
  if(equal(base,local))return structuredClone(remote);
  if(path.join('.')==='desktopLooks'&&local?.looks&&remote?.looks){
    const looks=mergeCloud(base?.looks??{},local.looks,remote.looks,[...path,'looks']);
    // Content-addressed bytes may have been collected on one device while another
    // device starts referencing them. Resolve references first, then collect bytes.
    const available={...base?.images,...local.images,...remote.images},images:Record<string,string>={};
    for(const value of Object.values(looks) as any[])if(value?.imageId){if(typeof available[value.imageId]!=='string')throw Error('桌面背景图片缺失');images[value.imageId]=available[value.imageId];}
    return {looks,images};
  }
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
      const b=map(base),l=map(local),r=map(remote),merged=new Map<string,any>();
      for(const key of new Set([...l.keys(),...r.keys(),...b.keys()])){const value=mergeCloud(b.get(key),l.get(key),r.get(key),[...path,key]);if(value!==undefined)merged.set(key,value)}
      // Compare the order shared by both sides after deletions. A rename must not
      // discard a remote drag, and incompatible drags must ask for reconciliation.
      const shared=new Set([...merged.keys()].filter(key=>l.has(key)&&r.has(key)));
      const order=(items:Map<string,any>)=>[...items.keys()].filter(key=>shared.has(key));
      const original=order(b),localOrder=order(l),remoteOrder=order(r);
      const localMoved=!equal(original,localOrder),remoteMoved=!equal(original,remoteOrder);
      if(localMoved&&remoteMoved&&!equal(localOrder,remoteOrder))throw Error('连接或配置顺序在多端被修改，请选择要保留的顺序');
      const primary=remoteMoved&&!localMoved?r:l,secondary=primary===l?r:l;
      const result=[...primary.keys()].filter(key=>merged.has(key));
      // Preserve additions from the other side beside their surviving neighbors.
      const additions=[...secondary.keys()].filter(key=>merged.has(key));
      for(let i=0;i<additions.length;i++){
        const key=additions[i];if(result.includes(key))continue;
        const next=additions.slice(i+1).find(candidate=>result.includes(candidate));
        const previous=additions.slice(0,i).reverse().find(candidate=>result.includes(candidate));
        const index=next!==undefined?result.indexOf(next):previous!==undefined?result.indexOf(previous)+1:result.length;
        result.splice(index,0,key);
      }
      return result.map(key=>merged.get(key));
    }
  }
  throw Error('同一项配置在多端被修改，已保留原始数据');
}
