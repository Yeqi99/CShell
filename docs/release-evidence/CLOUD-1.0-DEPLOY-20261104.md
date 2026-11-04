# 1.0 云端部署阶段记录

2026-11-04（北京时间约 19:01），香港生产服务器：

- 部署前磁盘 125 GiB 总量、30 GiB 可用、76% 使用率；原同步与中继服务正常。
- 候选源上传到 `/var/tmp/cshell-cloud-sync-1.0-final`。服务器执行全部 Python 测试：54 项通过。
- 对生产数据库只读复制后进行两次迁移预演：原 9 张表内容保留，新增 38 张表，SQLite integrity=ok，health/旧 bridges/domains HTTP 通过。
- 按维护脚本停止同步服务、复制数据库、安装模块并启动。备份：`/opt/cshell-sync/backup-1.0-20261104T110014Z`。健康接口通过，未更改会员价格、已有额度或环境密钥。
- 中继由当前 `services/cloud-relay/main.ts` 打包，旧包备份 `/opt/cshell-relay/relay.before-1.0.cjs`，更新后服务 active，日志报告 ready。数据目录、证书与服务环境保持。

## 尚待验收

- MCP gateway 8791 尚未安装或添加公网路由，不得把同步后端部署称为公网 MCP 已可用。
- admin 静态页面尚未部署；匿名反馈到管理员读取的生产闭环、实际 SDK 长连接、计量及重连仍待做。
- canp.site 专用 DNS 令牌文件仍不存在；未执行真实 DNS 写入或 HTTPS 建站验收。
- 服务启动及本机健康验证不能代替实际用户中继流量验收；应继续真实连接测试。

不自动回滚数据库，避免覆盖部署后的合法新写入。
