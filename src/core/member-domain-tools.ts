import {memberSiteWorkflow,memberSiteWorkflowInput} from './member-site-workflow';
import {z} from 'zod';
import {memberDomainCommandSchema,type MemberDomainCommand,type MemberDomainState} from '../shared/member-domains';
import type {ConnectionTool} from './connections/contracts';

export function createMemberDomainTools(host:{accountId():string|undefined;domains(input?:MemberDomainCommand,signal?:AbortSignal):Promise<MemberDomainState>}):ConnectionTool[]{
  const names={claim:'claim_member_domain',rename:'rename_member_domain',create:'create_member_dns_record',update:'update_member_dns_record',delete:'delete_member_dns_record'} as const;
  const descriptions={claim:'认领当前会员账号唯一的 canp.site 前缀；服务器验证会员及唯一性。',rename:'修改会员域名前缀；每个北京时间自然月一次，已有 DNS 自动迁至新前缀，站点与证书需更新。',create:'为当前账号创建 DNS：@ 表示当前会员主域名（如 creator.canp.site），www、_acme-challenge 或完整下级域名均可。',update:'按记录 ID 修改解析，短名称相对于该记录所属会员域名。',delete:'删除当前账号指定 DNS 记录；删除可能使网站不可访问。'};
  const run=async(input:MemberDomainCommand|undefined,signal:AbortSignal,guard?:()=>void)=>{
    signal.throwIfAborted();guard?.();const account=host.accountId();if(!account)throw Error('请先登录会员账号');
    if(input&&(input.action==='create'||input.action==='update')&&input.name!=='@'&&!input.name.includes('.')){
      let prefix:string;
      if(input.action==='create')prefix=input.prefix;
      else{
        const id=input.id;const state=await host.domains(undefined,signal);
        signal.throwIfAborted();guard?.();if(host.accountId()!==account)throw Error('账号已切换，请重新查询记录');
        const record=state.records.find(r=>r.id===id);if(!record)throw Error('当前账号没有这条 DNS 记录');
        prefix=record.prefix;
      }
      input={...input,name:input.name+'.'+prefix.toLowerCase()+'.canp.site'};
    }
    const result=await host.domains(input,signal);
    signal.throwIfAborted();guard?.();if(host.accountId()!==account)throw Error('账号已切换，不返回前一个账号的域名信息');
    return JSON.stringify(result);
  };
  return [
    {name:'member_site_workflow',capability:'domains.manage',description:'生成会员域名建站、HTTPS 与自动续签的执行检查计划。先读取此计划，再使用实际授权的机器工具和域名工具执行；生成计划不表示部署成功。',input:memberSiteWorkflowInput,needsReview:()=>false,invoke:async(input,signal,_output,guard)=>{signal.throwIfAborted();guard?.();return JSON.stringify(memberSiteWorkflow(input));}},
    {name:'list_member_domains',capability:'domains.read',description:'查看当前账号的会员域名、DNS 记录、改名时间与实际可用权限，不返回 Cloudflare 凭据。',input:z.object({}).strict(),needsReview:()=>false,invoke:async(input,signal,_output,guard)=>{z.object({}).strict().parse(input);return run(undefined,signal,guard);}},
    {name:'list_member_dns_records',capability:'domains.read',description:'查看当前账号拥有的 DNS 记录，包含旧域名保留的记录。',input:z.object({}).strict(),needsReview:()=>false,invoke:async(input,signal,_output,guard)=>{z.object({}).strict().parse(input);const state=JSON.parse(await run(undefined,signal,guard));return JSON.stringify({namespace:state.namespace,records:state.records});}},
    ...memberDomainCommandSchema.options.filter(schema=>schema.shape.action.value!=='buy').map(schema=>{
      const action=schema.shape.action.value as keyof typeof names;
      const {action: _action,...fields}=schema.shape; const input=z.object(fields).strict();
      return {name:names[action],capability:'domains.manage',description:descriptions[action]+' requestId 是必填幂等键；超时或取消后结果可能已提交，查询状态并用相同参数和 requestId 重试，不能生成新键重复操作。',input,needsReview:()=>true,conflictDomain:()=> 'member-domain',invoke:async(args:unknown,signal:AbortSignal,_output?: (text:string)=>void,guard?:()=>void)=>run(memberDomainCommandSchema.parse({...input.parse(args),action}),signal,guard)} satisfies ConnectionTool;
    }),
  ];
}

