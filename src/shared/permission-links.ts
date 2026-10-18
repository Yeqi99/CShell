import { aiCapabilities, aiPolicySchema } from './ai';

export const wechatPermissionFields = ['pid','experimental','enabled','readContacts','readMoments','publishMoments','readSessions','send','sendBlocked','receive','history','remarks'] as const;
const wechatNames = ['绑定微信进程','实验控制','启用微信控制','读取通讯录','读取朋友圈缓存','发布纯文字朋友圈','读取最近会话','发送范围','发送黑名单','接收范围','历史读取范围','修改备注范围'];
export const permissionNodes = [
  ...wechatPermissionFields.map((field,i)=>({id:`wechat/${field}`,label:`微信：${wechatNames[i]}`,page:'wechat' as const})),
  ...aiPolicySchema.shape.application.element.options.map(id=>({id:`application/${id}`,label:`智能体应用能力：${id}`,page:'ai' as const})),
  ...aiCapabilities.map(id=>({id:`capability/${id}`,label:`机器默认操作：${id}`,page:'ai' as const})),
  {id:'machines/scope',label:'机器访问范围',page:'ai' as const},
];
export const permissionHref = (id:string) => {
  if(!permissionNodes.some(n=>n.id===id))throw new Error('未知权限节点');
  return `#cshell-permission/${id}`;
};
export function parsePermissionHref(href:string){
  const prefix='#cshell-permission/';
  return href.startsWith(prefix)?permissionNodes.find(n=>n.id===href.slice(prefix.length)):undefined;
}
