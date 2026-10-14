# 连接入口、市场布局与 WSL 网络设置

- 新建连接直接选择 Windows 远程桌面、SSH 终端、CShell Client；对应表单按需加载，切换后保留草稿。RDP 继续通过系统客户端打开，不伪装为已保存或内嵌会话。
- 插件市场使用可搜索的紧凑卡片。应用市场目录与详情独立滚动，小窗口目录横向排列，安装计划在详情区原位显示；安装仍需用户检查并确认，保持原有目标和授权边界。
- WSL 插件的“网络与代理”设置当前 Windows 用户的 `.wslconfig`：NAT / mirrored，以及 autoProxy。保存保留其他章节，备份原配置并检查版本冲突，不自动重启、不关闭系统代理、不更改防火墙。
- “重启 WSL”先在后端弹出确认，说明会停止所有发行版及依赖应用，再执行 `wsl --shutdown`；下次打开终端启动。未在用户真实环境执行重启或修改网络，仅只读检测；设置写入测试使用临时目录。
- 参考：[Microsoft WSL 网络说明](https://learn.microsoft.com/windows/wsl/networking)。镜像网络入口检查 Windows 11 22H2 与 WSL 2.0 以上版本，实际网络兼容性依赖主机环境。

验证：76 项自动化测试通过，新增 `scripts/navigation-market-smoke.ts` 验证 RDP 独立入口、协议草稿、市场搜索/窄窗口/安装计划及 WSL 保存不重启；`scripts/client-smoke.ts` 验证双进程真实终端和撤权。RDP 回归替换启动 IPC，不对真实远程电脑发起登录。

完整桌面回归（pnpm test:desktop）通过，覆盖真实 SSH/SFTP、设置与编辑草稿、主题与语言、插件/应用、字体/背景、MCP。修复设置异步保存完成后错误切回终端的问题：关闭设置只在当前仍为设置页时切换工作区。

Windows 打包产物也通过 navigation-market-smoke；测试使用独立临时数据，不读写用户保存的服务器或网络设置。
