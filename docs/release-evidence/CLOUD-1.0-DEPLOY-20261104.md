# 1.0 云端部署阶段记录

2026-11-04（北京时间约 19:01），香港生产服务器：

- 部署前磁盘 125 GiB 总量、30 GiB 可用、76% 使用率；原同步与中继服务正常。
- 候选源上传到 `/var/tmp/cshell-cloud-sync-1.0-final`。服务器执行全部 Python 测试：54 项通过。
- 对生产数据库只读复制后进行两次迁移预演：原 9 张表内容保留，新增 38 张表，SQLite integrity=ok，health/旧 bridges/domains HTTP 通过。
- 按维护脚本停止同步服务、复制数据库、安装模块并启动。备份：`/opt/cshell-sync/backup-1.0-20261104T110014Z`。健康接口通过，未更改会员价格、已有额度或环境密钥。
- 中继由当前 `services/cloud-relay/main.ts` 打包，旧包备份 `/opt/cshell-relay/relay.before-1.0.cjs`，更新后服务 active，日志报告 ready。数据目录、证书与服务环境保持。

## 后续网关与后台部署

- `/opt/cshell-mcp/main.cjs` 已安装；新增受限 Docker systemd 服务 `cshell-mcp`，仅监听 127.0.0.1:8791，保留非 root/read-only/cap-drop 约束。内部授权令牌在服务器生成并保存，未输出。
- Caddy 增加 `shell.canp.ai/mcp` 代理，原文件备份 `.before-mcp-1.0`，配置验证并 reload 成功。公网与本机无令牌请求均返回 401；服务 active。
- admin 静态文件已更新，原目录备份 `/opt/cshell-web-stage/admin-before-1.0`。
- 使用实际 CShell User-Agent 经公网匿名提交两次同 ID 测试反馈，管理员认证读取只出现一次。测试记录 `f5b40377-09ba-4084-aaea-f588e2bbbecf`，明确标记部署验收而非用户投诉。Python 默认 User-Agent 被公网 403 拒绝，实际应用 User-Agent 成功。

## 真实 HTTPS MCP 验收

- 使用本机当前登录账号，通过正常账户 API 注册临时只读 bridge 和仅含 list_servers_page 的专用客户端；令牌只在进程内，未输出。
- 真实 MCP SDK StreamableHTTPClientTransport 连接 `https://shell.canp.ai/mcp`，同一 session 两次读取授权服务器目录，间隔 12 秒，跨过网关周期权限检查。实际 bridge 请求转发本机已授权 MCP，并检查 HTTP 成功、无错误、返回 result 存在。未修改本机授权范围。
- 撤销临时客户端后，同一 SDK 连接再次 listTools 被拒绝；finally 撤销客户端并移除临时 bridge。上述流程重复验收通过。
- 原账号当时没有活动 bridge；该验收使用独立只读验收桥接进程，不能声称已替用户启用安装版应用的常驻账号桥接设置。
- 补充恢复验收：同一会话两次只读后正常 close，使用新 SDK Client/transport 重新初始化，再执行两次只读；共四次成功，随后撤销客户端并验证拒绝访问。临时客户端与 bridge 已清理。未重放任何写入。

## 1.0 下载发布前置核对（尚未切换）

- 官方 Cloudflare MCP 只读确认两条通用路由 `shell.canp.ai/downloads/opensource/v*`、`shell.canp.ai/downloads/pro/v*` 已存在，覆盖 1.0，无需新增版本路由。两条精确 `releases.json` 路由也存在。
- 生产 Worker 内嵌清单为 0.8.22，共 189 个白名单文件（使用官方 MCP truncate:false 完整读取）；Pro 当前 v0.8.22、开源当前 v0.8.21。已备份精确生产清单至 `.local/edge-live-pre-100.json`。工作树旧 manifest 为 0.8.21，不能误作生产基线。
- Worker 不自动从香港读取清单；未列入白名单的 1.0 下载地址返回 404。需生成并一次部署经过校验的完整新 Worker，不能只上传香港文件。
- 香港剩余 32,181,637,120 bytes（约 30 GiB），使用率 77%；尚无 v1* 目录。同步、中继、MCP 服务均 active。部署所需临时副本与正式包空间仍应按最终资产总和复核，不清理现存版本来掩盖不足。
- 新附件路径为 `/opt/cshell-downloads/{opensource,pro}/v1.0.0/<asset>`，公开路径为 `/downloads/{opensource,pro}/v1.0.0/<asset>`。先上传临时目录，逐文件核对大小及 SHA256，完成后同文件系统 rename 为正式不可变目录；不存在的架构不能加入目录或清单。
- 准备两份 `verified-{opensource,pro}-100.json`，明确 `expectedAssets`，且与实际附件集合严格一致。生成器已支持 1.0 独立平台清单及两版当前版本不同的生产状态，同时保留来源提交、频道、大小、摘要和完整 SHA256SUMS 校验。11 项生成器与 Worker 回归通过。
- GitHub 两个 release 的完整附件和摘要核验后，再生成新 edge 清单（previous 使用生产备份）。香港两个 `releases.json` 先备份并分别以临时文件校验、原子 rename；跨频道两个文件切换不是单个事务，两个频道的附件必须在任何清单切换前全部可用。
- Cloudflare Worker 更新使用官方 MCP 单次脚本版本部署，保留通用路由。检查最终裸 URL 两个 catalog、各附件 Range/完整摘要、实际客户端更新检查；回滚恢复旧 Worker 与旧 catalog，不移动旧标签。
- 本轮未发布 1.0 附件、未把候选标为发布、未切换任何更新清单。

## 香港附件暂存完成

- 两频道各 14 项、合计 28 项附件已上传到 `.incoming-1.0/{opensource,pro}`，总计 2,212,875,014 bytes。暂存根目录 0700，不作为公开下载入口。
- 每项先在本机独立核对 SHA256/size，再上传 `.part`、远端核对 SHA256/size，成功后改为暂存正式文件名；最终在服务器分别执行完整 `sha256sum -c SHA256SUMS.txt`，26 个二进制全部 OK。两份 SHA256SUMS 本身也已核对摘要。
- 逐包来源提交、路径、大小与摘要记录在 `HK-1.0-STAGED-20261104.json`。一次 SSH 新连接失败后从已核验 receipt 恢复，没有重复上传或跳过校验。
- 两份旧香港 catalog 已备份至 `.incoming-1.0/catalog-backup`；完整线上 Worker 模块备份 `.local/edge-live-worker-before-100.mjs`，语法检查通过。当前磁盘约 28 GiB 可用、78% 使用率。
- 等待统一发布确认后才将完整目录移到各 `v1.0.0` 路径；未修改现有 releases.json 或 Worker。

## 尚待验收

- HTTPS SDK 会话及撤销已验证；长时间负载、跨月计量及实际安装版账号桥接配置仍需后续验证。
- canp.site 专用 DNS 令牌文件仍不存在；未执行真实 DNS 写入或 HTTPS 建站验收。
- 服务启动及本机健康验证不能代替实际用户中继流量验收；应继续真实连接测试。

不自动回滚数据库，避免覆盖部署后的合法新写入。

