# CShell Pro 0.8.3 发布记录

源码：a90f408b9ed69576f1789a0bfd8154e470600a64，标签 pro-v0.8.3。发行页 https://github.com/Yeqi99/CShell/releases/tag/pro-v0.8.3 。本轮上游修复已直接同步到 Pro 工作树，无需再次合并旧 origin/main。

Windows、Android 和 Windows CAgent 使用已构建并由香港更新目录公布的附件，上传 GitHub 前逐个核对摘要。四组 macOS/Linux CI 构建成功，共六个附件；下载中心按平台显示真实可用版本。Windows 本机 0.8.3 的 app.asar 与测试构建摘要一致，CAgent 0.8.3 与 Pro 正在运行。

本轮主程序修复、模型网关和平台验证详见 REPAIR-2026-10-22.md。额外验证：OpenCode 云配置、MCP Agent 连接、客户端/CAgent 更新通道 7 项测试通过；官网下载设备切换、18 篇文档、键盘操作与窄屏通过；独立下载中心窄屏无溢出且全部安装包来自香港源。

远端 Windows 检查曾出现 MCP Agent 测试进程失败，独立重跑通过；另一次完整单元测试通过后，旧 RDP 界面测试因两个同名新建连接按钮产生歧义。已将测试限定到侧栏入口，本机重跑通过，保留原发布标签不移动；不能据此称原标签所有 CI 全绿。

Windows 未 Authenticode 签名；Android 本轮未实体设备验证；Mac/Linux 为实验构建、未实体设备验证，Mac 未公证。Mac/Linux CAgent 自动安装尚未实现。CShell 自动检查/下载后由用户执行安装，Windows CAgent 退出时安装，Android 保留系统确认。

本次是修复版。登录导入来源确认、访客与账号隔离及缓存清理、CAgent 登录 Pro 标识、连接表单内下载区等用户追加功能仍待后续实现；不得在比较表标记为已开放。OpenCode 修复已包含；不重新覆盖用户现有配置。
