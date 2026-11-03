# Cloudflare 与手机设备连接跟进

2026-11-03：开发提交 f322dd8；签名候选构建配置 fa65a76，远端分支 codex/cloudflare-mobile-followup。尚未发布新版本。

Cloudflare：插件市场安装后，打开插件并选择“授权并启用智能体工具”。浏览器进入 Cloudflare 官方 OAuth，选择账号与范围。成功后 cloudflare_call 提供 catalog/search/execute/docs，执行沿用对话审核。令牌在当前本机工作区加密保存；退出授权删除本地凭据，完全撤销请在 Cloudflare 管理授权应用。官方端点 https://mcp.cloudflare.com/mcp 。尚未用真实 CShell OAuth 账号验收部署。

手机：已启用 CAgent 时，应用恢复前台启动独立连接服务，不再依赖录屏；录屏仍需 Android 系统授权。列表过滤本机设备，但上传时保留其云端记录。同账号设备分组排序置顶。CAgent 模型目录失败不再阻断设备注册。

显示：侧栏账号设备用紧凑图标及悬停状态，去掉多行徽标；远控按解码帧更新比例，并使用 contain 防止拉伸。

验证：桌面 TypeScript 与完整构建通过；Android web TypeScript、Java debug/test APK 编译通过；7 项 Cloudflare/设备发现测试通过；真实 Electron 插件安装→设置→授权入口 UI 测试通过，截图 test-results/cloudflare-extension.png。

未完成：签名候选 CI 结果、手机覆盖安装及真实上线/旋转验收、电脑 CAgent 同账号中继现场诊断、Cloudflare 真实授权部署、本机桌面升级。USB 手机 ea6fe3c 已连接。Android SDK/JDK 位于 pro-unified-followup/CShell/.local/android-tools；JDK 子目录 jdk/jdk-17.0.20.1+1。本机没有 gh 命令，签名构建通过 push 分支触发。

开源同步：整提交 cherry-pick 因 Pro 专有云同步文件冲突，已安全 abort，未覆盖开源工作树；需分别移植通用 Cloudflare 与显示修复，不把 Pro 云逻辑带入开源。
