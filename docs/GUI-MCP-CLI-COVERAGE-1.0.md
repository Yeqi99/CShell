# 1.0 GUI、MCP 与 CLI 能力对照

核对日期：2026-11-04。这里按操作核对实际入口，不以工具数量等同全覆盖。会员长连接通过 `application_list / application_describe / application_invoke` 接入同一受授权应用工具；旧 token 保留原五项范围，新工具不会自动加入旧权限。CLI 使用同一工具目录和调用协议，不能绕过权限或任务所有者检查。

| 产品操作 | 工具/通路 | 授权与边界 | 回归证据 |
| --- | --- | --- | --- |
| 查看、创建、修改连接与凭据 | `connections_manage` 按 action 分流 | connections.read/manage、credentials.manage、identity.trust 分离；已配对 CAgent 只改名称/分组/收藏/端点，不伪造身份或新建配对 | connection-management、connection-management-grants、mcp-management |
| 首次主机指纹、连通性预检、权限排错 | `connection_preflight`、`permission_diagnostics`、连接管理身份流程 | SSH/SFTP 实际预检；不支持的代理/协议阶段明确 unchecked，不假定密码正确 | connection-preflight、mcp-management |
| 终端输入、尺寸、输出及历史 | `terminal_input/resize/state/read` | 当前真实会话、调用方所有权、commands.execute；输出分页有界 | mcp、mcp-agent、mcp-audit |
| 执行命令、找回任务及完整结果 | `task_start/list/read/cancel/release`、`session_list` | 同调用方恢复；stdout/stderr/退出码；重启未知写入不可自动重放 | mcp-account-application、cloud-mcp-session、cloud-mcp-gateway |
| 文件浏览、创建、修改、权限 | Provider 文件工具、目录树工具 | files.read/create/write 与真实 Provider 能力；FTP 不冒充 POSIX chmod | file-permissions、file-connections、mcp-ftp |
| 跨机器文件和目录复制 | `files_copy_start` → task_read/cancel；GUI 复制/粘贴 | 源读+目标创建、两端复核、目录有界、默认不覆盖；直连可用优先，失败不重放部分写入 | machine-copy-operation、direct-machine-copy、mcp-account-application；file-copy-ui-smoke |
| 浏览器登录、交互、抓取、截图 | browser_* 可视工具 | browser.read/control 与真实机器网络出口；网站内容不成为权限 | mcp-visual、visual-tools |
| 远程桌面截图和键鼠 | desktop_status/screenshot/interact | desktop.view/control；平台采集/系统授权仍必需 | mcp-visual、remote-android-tools |
| Android UI、短信、电话 | android_ui_read、android_sms_*、android_call* | 系统权限和工具操作权限同时满足；消息/呼叫有 requestId，提交不冒充送达 | remote-android-tools |
| CAgent 应用和扩展能力 | agent_capabilities_list / agent_capability_invoke | 实时能力目录、contractDigest、显式授权与审核；不裸转发任意 RPC | remote-capability-tools |
| 目标、事件订阅、执行记录 | agent_automation_* | 当前控制端所有权、条件与有界调度；不能提高远端权限 | remote-automation-tools、remote-wechat-events |
| 微信能力与事件 | remote_* 微信工具及能力包装 | 已安装匹配包、当前授权；版本差异如实返回 | remote-wechat-tools、remote-wechat-event-tools-integration |
| 会员域名认领、改名、DNS、建站工作流 | member-domain-tools 八项 | domains.read/manage；仅自有 namespace，Asia/Shanghai 自然月改名限制和幂等请求；DNS不等同部署完成 | member-domain-tools（含真实 MCP HTTP）、member-domains-ui-smoke |
| 本月中继/MCP 已用、预留、上限和余额 | `account_traffic_read` 与账号设置流量卡片 | 独立 account.read；仅当前账号，切换账号丢弃结果，不返回内部成本或凭据 | account-traffic-tool、test_account_traffic.py、account-traffic-ui-smoke |

## 不能宣称无条件全覆盖的部分

- 账号登录、首次认证、MCP 客户端创建及全局权限扩大仍由本人设置完成，不向受限工具提供自我提权接口。
- 原生平台授权（Android 录屏/无障碍/SAF、系统安装）不能通过 MCP 偷偷替代确认；缺少平台能力时不注册虚假工具。
- `application_preferences` 已开放界面布局、主题、字体、语言、终端与连接打开方式的 read/patch；独立 preferences.manage，修改需先读取 revision。排除本地资源路径、凭据、权限与代理配置。实际窗口位置、运行中标签排序仍是 UI 状态，不宣称逐按钮覆盖。
- 网络出口依 Provider 的真实实现；应用 HTTP 出口不是所有进程的整机 VPN。相关实现和实机缺口见 RELEASE-1.0-GAP-AUDIT-20261104.md。
- 上表测试是源码/本地协议或浏览器回归，不替代最终生产会员长连接和跨平台实机验收。

## 本轮实际补齐

新增账号只读流量接口与工具，避免新 GUI 再次形成工具缺口；同时保持旧 token、旧无限额权益不变。按 UTC 自然月展示 ingress+egress，余额扣除当前未结算预留；跨月的旧预留不挤占新月，超期扩容不计入。UI 30 秒刷新，失败明确显示上次快照，账号 remount 清理旧数据。1100/760/390 宽度交互和无横向溢出已验证。
