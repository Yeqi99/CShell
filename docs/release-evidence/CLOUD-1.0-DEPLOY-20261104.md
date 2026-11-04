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

## 尚待验收

- HTTPS SDK 会话及撤销已验证；长时间负载、跨月计量及实际安装版账号桥接配置仍需后续验证。
- canp.site 专用 DNS 令牌文件仍不存在；未执行真实 DNS 写入或 HTTPS 建站验收。
- 服务启动及本机健康验证不能代替实际用户中继流量验收；应继续真实连接测试。

不自动回滚数据库，避免覆盖部署后的合法新写入。
