# MCP 应用更新

独立应用权限 `updates.manage`，已有授权不会自动增加。设置 → AI 与安全 → MCP 应用权限勾选“更新 CShell”。API 客户端使用相同独立权限。

调用 `application_update`：

1. `{ "action": "check" }` 启动检查。
2. `{ "action": "status" }` 轮询真实状态。
3. 发现新版后 `{ "action": "download" }`；继续轮询到 `ready`。
4. `{ "action": "install", "acknowledgeRestart": true }` 显式同意关闭当前会话并重启。返回调度状态后 MCP 会断开，客户端重新连接原 MCP 地址。
5. 再读 status：receipt 的 `verified: true` 表示当前运行版本与此前目标版本相同；调度成功本身不表示安装成功。

只使用安装程序既有的官方渠道、当前 edition/platform/arch。禁止提供 URL、路径、摘要或降级版本。下载校验 SHA256；安装前再次核验。Windows NSIS、Linux AppImage、macOS 使用既有安装实现；仍保留系统必需确认。应用退出复用历史和浏览器保存流程；已确认重启不再弹鼠标关闭确认框。安装会停止连接、传输和任务，请调用方先保存工作。

收据在本机用户数据目录 update-receipt.json，独立于账号云配置，不含密钥。安装异常保存失败状态；更新后仍旧版本会显示 verified=false，不能当作成功。

验证：拒绝任意源、拒绝未确认重启、撤销授权拒绝、收据跨进程版本核验测试与 TypeScript 检查通过。尚需安装包真实升级与 MCP 重连验收。
