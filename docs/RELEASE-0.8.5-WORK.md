# 0.8.5 候选：升级与退出一致性（开发中，未发布）

本轮立项来自 0.8.4 实际本机升级，不为版本号凑数。

1. 静默安装 CAgent 跳过快捷方式更新，原快捷方式图标可能留在旧版本目录。修改为只刷新指向当前安装的既有快捷方式，不重建用户删除的快捷方式，不接管其他安装，不改变自启动选择。实现已修改，需隔离安装夹具验证。
2. CAgent 0.8.4 的 build-info.json 为 0.8.4，但 Windows 可执行文件 ProductVersion 为 0.0.0.0。构建时生成受校验的程序集版本元数据，编译后移除临时源。需真实编译并读取 VersionInfo 验证。
3. 退出保护待复现：桌面 close 判断仅列出连接、传输和 HTTP，没有智能体运行/待授权状态；审查后台任务在无连接时是否被无提示终止。未完成复现和实现，不能算已修复。

目前没有递增版本号、创建标签或新包。上述改动先在内核验证，再合并 Pro；至少三项真实改进完成后才考虑发布。目标仍为稳定的 1.0，并允许在充分审计后提前停止。

## 定向验证通过

- 真实 WPF 编译产物的 ProductName=CAgent、ProductVersion=0.8.5、FileVersion=0.8.5.0；不合法版本拒绝。正式版本号尚未修改，此产物仅在 test-results 中验证元数据。
- scripts/windows-shortcut-smoke.ps1 在隔离临时目录执行生产快捷方式逻辑，真实 .lnk 验证自有快捷方式刷新、已删除不重建、其他安装逐字节不变。静默参数保留 NoLaunch/NoShortcuts，并显式增加 RefreshExistingShortcuts；原 NoShortcuts 调用语义不变。
- scripts/ai-exit-smoke.ts 在真实 Electron 与延迟模型服务下验证无机器连接时运行 AI 的退出提示，取消后窗口/任务继续，确认后停止并退出。运行/待授权 turns 与正在收尾的任务由后端状态判定；不扩大权限。桌面 TypeScript 与 main 构建通过，tests/ai.test.ts 回归通过。
- 以上三项尚未打包发布；需合并 Pro 验证及完整版本收口，不能替换 0.8.4 附件。

## 两版合并与持续回归

内核 d42375d 的三项修复已合并 Pro，Pro TypeScript/main 构建及 ai-exit-smoke 实测通过；dfbdfc4 将退出与快捷方式真实回归加入 Windows CI 和发行工作流。Pro 合并提交 8483015、内核 dfbdfc4 已推送。未修改 0.8.4 既有标签或附件，正式版本仍 0.8.4。

完整回归正在运行：内核 exec session 94423、Pro exec session 58863，日志各工作树 test-results/085-full-regression.log。已确认进程句柄存活；继续时先轮询这些句柄，不能因为暂时无输出就重复启动。当前已完成部分真实 WSL/原生终端及浏览器测试，但整套尚未结束，不能声称全部通过。
