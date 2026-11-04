import {z} from 'zod';

export const memberSiteWorkflowInput=z.object({
  domain:z.string().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,30}[a-z0-9]\.canp\.site$|^[a-z][a-z0-9-]{1,30}[a-z0-9]\.canp\.site$/).max(253),
  target:z.string().min(1).max(200),port:z.number().int().min(1024).max(65535).default(3000),
}).strict();

/** Returns an execution guide, never a deployment result. Machine tools retain their own grants. */
export function memberSiteWorkflow(input:unknown) {
  const {domain,target,port}=memberSiteWorkflowInput.parse(input);
  return {
    workflow:'member-site-v1',status:'plan-only',domain,target,url:`https://${domain}`,
    instructions:'按顺序使用当前实际提供的域名与机器工具执行。每步检查真实输出；未知结果先查状态，不能重放写操作。以下命令仅为已经确认使用 systemd 与 Caddy 的 Linux 示例；其他平台先发现实际服务管理方式。不得把生成计划当作完成。',
    steps:[
      {id:'ownership',action:'读取会员域名与实际连接。确认域名等于当前 namespace 或以点加 namespace 结尾，且会员有效。没有前缀时按用户给定名称认领；冲突时给出可选名称，不随意改用户已有域名。',evidence:['账号域名归属','目标连接 ID 与实际身份','会员有效']},
      {id:'preflight',action:'通过目标机器工具检查 OS、架构、可用磁盘、运行中网站/端口/反向代理、服务管理器与权限。确认目标公网 IPv4/IPv6、80/443可达。会员设备中继只提供机器管理连接，不等于网站公网入口。私网机器无入口时明确阻碍。保留现有站点，不能覆盖主配置或停止其他服务。',evidence:['目标主机检查结果','端口占用','公网入口','已有配置备份位置']},
      {id:'application',action:`在目标独立目录部署网站，固定依赖版本并执行构建/测试。应用只监听 127.0.0.1:${port}，使用真实服务管理器持久运行；静态站点也可使用独立静态目录。验证本机健康检查成功后继续。需要安装依赖或提权时遵守当前授权；不盲目执行下载脚本。`,evidence:['构建结果','应用进程与持久服务','本机 HTTP 健康检查']},
      {id:'dns',action:`读取 ${domain} 的现有记录，只创建或修改本次网站所需 A/AAAA。使用域名工具与稳定 requestId；超时用原ID重试或查询，不创建重复记录。没有可达IPv6时不要发布AAAA。检查权威解析结果及外部解析。保留旧值供回滚。`,evidence:['记录 ID','预期/实际 IP','权威解析结果']},
      {id:'https',action:'优先复用已安装反向代理。使用 Caddy 时为当前网站生成独立配置，并通过已有 import 接入；先验证完整配置，再 graceful reload。Caddy 自动申请与续签证书，证书存储必须持久且对服务用户可写。没有Caddy时先选择适合目标的已验证安装渠道；不要替换正在运行的 Nginx/Caddy。',caddySite:`${domain} {\n    reverse_proxy 127.0.0.1:${port}\n}\n`,checks:['caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile','systemctl reload caddy'],evidence:['配置验证成功','服务重载成功','ACME签发日志']},
      {id:'acceptance',action:`从目标外部访问 https://${domain}，校验证书主机名/可信链/有效期、HTTP跳转和网站预期内容。不能用 -k 跳过证书校验；DNS成功或服务running都不代表网站成功。`,checks:[`curl --fail --show-error --max-time 20 https://${domain}/`,`curl --silent --show-error --head --max-time 20 http://${domain}/`],evidence:['外部 HTTPS 状态','预期页面内容','证书到期时间','HTTP→HTTPS']},
      {id:'renewal',action:'验证服务开机启动、运行用户及持久证书目录权限，读取ACME续签相关日志。自动续签由Caddy服务维持，不需要机器人每次申请证书或保存CF全区密钥。记录证书有效期，并可用现有目标/事件能力建立定期只读健康检查；检查失败通知，不盲目重签以免触发CA限额。首次部署只能报告“自动续签已配置并检查”，不能声称已完成未来续签。',checks:['systemctl is-enabled caddy','systemctl is-active caddy','journalctl -u caddy -n 80 --no-pager'],evidence:['开机启动状态','持久证书存储可写','证书有效期与检查时间']},
    ],
    failurePolicy:'发生失败时报告具体失败步骤和已完成证据。仅回滚本次修改的站点配置/服务及DNS记录；先比较当前状态，若他人已修改则停止覆盖。保留构建日志但过滤秘密。不得关闭其他站点、删除用户目录、暴露账户密钥或将根域名CF凭据放到会员机器。',
    finishFields:['网站URL','部署机器','实际构建版本','DNS验证','HTTPS验证','自动续签配置检查','剩余限制'],
    references:['https://caddyserver.com/docs/automatic-https','https://caddyserver.com/docs/running'],
  };
}
