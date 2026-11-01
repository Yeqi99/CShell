# 微信受管服务退出修复：候选作废范围

状态：等待私有工具诊断稳定；尚未启动新构建，禁止发布旧候选。

Core `cd6ddfd`、Pro `d3be149` 修改 `src/agent/managed-wechat.ts`。依赖链为 `agent/cli.ts → runtime.ts → managed-wechat-capability.ts → managed-wechat.ts`。

`scripts/build.mjs` 将该入口打入 `dist/agent/agent.cjs`，两版 Electron 配置均打包 `dist/**/*`，桌面端 `LinuxWorkspaceService` 实际使用这个嵌入运行时。因此此修复不只影响独立 CAgent 安装包。

`scripts/agent-build.mjs` 从同一入口打包独立 `agent.cjs`，没有按平台裁剪受管服务实现。即使某平台尚不支持微信应用安装，也不能沿用含旧公共生命周期实现的运行时。

## 最小完整重建矩阵

| 渠道 | Windows x64 | Linux x64 / arm64 | macOS x64 / arm64 | 二进制总数 |
| --- | --- | --- | --- | ---: |
| 开源 | CShell EXE + CAgent EXE | CShell AppImage、DEB + CAgent tar.gz，各架构 | CShell DMG、ZIP + CAgent tar.gz，各架构 | 14 |
| Pro | CShell Pro EXE + CAgent EXE | CShell Pro AppImage、DEB + CAgent tar.gz，各架构 | CShell Pro DMG + CAgent tar.gz，各架构 | 12 |

合计 26 个桌面/CAgent 二进制及 2 份 SHA256SUMS 必须重新生成。两版 Android 的代码与打包链不包含这个 Node 运行时，已验证的语义修复 APK 保留有效；本轮无需重跑 Android 构建或仪器矩阵。

后续仅在诊断稳定后触发：Core 桌面/CAgent 五平台架构、Pro 桌面五平台架构、Pro 独立 CAgent 五平台架构。可合并同平台工作，避免重复编译。每个实际架构执行新退出测试、包内 PTY/TLS/退出验收；Pro CAgent 继续验证账号接口，桌面继续验证实际打包程序。Windows 安装器需新摘要与包内文件核验，不能用旧 asar/agent.cjs 补丁冒充完整安装包。

旧 GitHub artifacts、香港私有暂存保留用于比对，不覆盖其历史摘要。最终库存与两份 verified-0818 控制文件均标记 `blocked-runtime-rebuild-required`；原源码目标仅为上一轮候选，不得用于本轮发行。
