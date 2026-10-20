import { aiCapabilities, aiPolicySchema } from './ai';

export const wechatPermissionFields = ['pid','experimental','enabled','readContacts','readMoments','publishMoments','readSessions','sendFiles','send','sendBlocked','receive','history','remarks'] as const;
const wechatNames: Record<typeof wechatPermissionFields[number],string> = {pid:'绑定微信进程',experimental:'实验控制',enabled:'启用微信控制',readContacts:'读取通讯录',readMoments:'读取朋友圈缓存',publishMoments:'发布纯文字朋友圈',readSessions:'读取最近会话',sendFiles:'发送文件',send:'发送范围',sendBlocked:'发送黑名单',receive:'接收范围',history:'历史读取范围',remarks:'修改备注范围'};
export const permissionNodes = [
  ...wechatPermissionFields.map(field=>({id:`wechat/${field}`,label:`微信：${wechatNames[field]}`,page:'wechat' as const})),
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
