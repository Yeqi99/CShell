# CAgent 无鼠标更新

已配对且获准机器管理的连接，在 MCP `discover_capabilities` / 连接工具目录发现 `agent_manage`，依次调用：

1. `{ "method": "update.check" }`
2. `{ "method": "update.download" }`
3. `{ "method": "update.status" }` 轮询，直到 phase=ready。error 时停止并报告；不得直接执行未知安装包。
4. `{ "method": "update.install", "params": { "confirm": true } }`

安装返回 queued 只代表等待空闲，不能宣称完成。现有终端、任务等活动会延后安装；请保存工作并正常关闭目标活动，重连同一设备后用 client.status 核验 agentVersion 和设备身份。下载仅由目标自身按发行渠道选择并校验摘要；调用者不能指定 URL 或安装路径。远程不会返回安装文件路径；verify/commit/settings 保留本机用途。借用设备不能更新主人的程序。

本机脚本使用 `cagent update check`、`cagent update download`、`cagent update status`、`cagent update install --confirm`，复用认证本机 IPC。无需操作鼠标。首次使用需要目标 CAgent 已包含此接口；旧目标不能通过尚不存在的接口自我升级。
