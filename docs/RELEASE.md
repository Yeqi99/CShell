# CShell 0.5.0 / CShell Client 0.1.0 Windows 预览版

本次提供 Windows x64 主程序与独立受控端。

- Client 与 SSH 共用左侧服务器列表，支持命名、分组、收藏、编辑和双击连接；旧设备记录自动迁移并保留加密身份。修改名称和分组不会中断已有终端。
- 新建连接统一选择 SSH、CShell Client、Windows 本机 CMD / PowerShell，以及已启用插件检测到的 WSL。RDP 通过 Windows 系统客户端打开，目前不保存 RDP 配置。
- 独立 Client 使用紧凑窗口，配置监听地址、端口、连接密码和终端权限；支持复制不含密码的连接信息。首次连接核对设备指纹，后续通过证书授权连接。
- 智能体与文字助手改进：模型连通性检查、工具执行记录、翻译与输入辅助；生成候选不自动执行。连接提取与 WSL 安装流程同步改进。

## 下载

- `CShell-0.5.0-win-x64.exe`：主程序。
- `CShell-Client-0.1.0-win-x64.exe`：安装在被管理 Windows 电脑上的独立受控端。
- `SHA256SUMS.txt`：以上安装包的 SHA-256 校验值。

Windows 安装包未代码签名。本轮仅发布 Windows x64，不包含新版 macOS、Linux 或 Android 附件。

## 验证与边界

60 项自动化测试通过，已执行 Windows 本机双进程 Client 连接回归，覆盖真实 CMD / PowerShell、命名分组收藏、双击重连、凭据保护与撤权断连。主程序已在本机安装并核验安装内容。

Client 默认关闭监听，使用 TLS 1.3、设备指纹校验和独立加密凭据；不会自动开放防火墙或提升权限。当前已验证本机回环连接，跨机器局域网、休眠恢复和长期断网尚未完成真机验收。Client 暂不提供文件传输、屏幕控制、NAT 穿透、中继、Windows 服务或 WSL 一键安装。

本版为开发预览。源码采用 MIT，第三方依赖许可见 THIRD_PARTY_NOTICES.txt。
