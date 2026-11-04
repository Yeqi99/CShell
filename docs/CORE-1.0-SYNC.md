# 开源 1.0 共享功能迁移记录

本轮在 `codex/core-020-model-market` 执行，原 HEAD 为 `67e66aa`。以 Pro 已发布 0.8.21 的 `036099a` 为增量基线进行三方合并，保留开源独立改动，不重放 Pro 历史账号实现。版本设为 1.0.0；这不是发布记录。

## 已迁移

- 跨机器文件流式复制、TLS 一次性直传票据、摘要校验、取消与安全回退；SSH/SFTP/FTP 适配与紧凑复制粘贴工具。
- WSL 离线导入、安装停滞状态与提权日志；保留既有发行版，不自动重启。
- 用户反馈入口、诊断脱敏、匿名回执与失败重试；桌面和 CAgent 原生界面共用错误语义。
- 微信市场统一单项展示与精确版本选择、0.1.3 摘要镜像、运行中版本核验。
- 桌面系统服务迁移、取消 TLS 握手、失效桌面捕获等修复。
- Android 网络流与代理租约、用户显式开启 TCP VPN、四 ABI 固定版本构建脚本；手机文件校验与代理配置。
- 保持开源的包身份、更新源和界面范围；桌面/CLI/CAgent 构建固定 `__CSHELL_PRO__=false`，不因外部 Pro 环境变量跨渠道。

## 冲突处理

- `agent/runtime.ts`保留开源 HTTP 出口与无云账号架构，分别加入反馈与文件直传回调，不引入 accountNetwork。
- `desktop/main.ts`、`desktop/ai.ts`、`preload.ts`保留开源接线；未加入会员域名与云 MCP 客户端入口。
- `agent/relay.ts`及账号计量测试保持开源版本，会员流量后台不随客户端迁移。
- Android 同步回调保持开源原状；纯本地字体设置帮助函数不含账号通信。
- CAgent 原生窗口保留开源账号删除逻辑，仅合并通用反馈/市场/权限改进。
- 原有两个许可证文件的未提交行尾状态保留；未复制私有云服务、官网部署、生产 Worker、用户配置、凭据或微信私有实现。
- 开源独有工作流与文档均保留；Android 构建工作流追加固定 NDK 引擎构建，未触发远程 CI。

## 验证与边界

- 开源 TypeScript、Vite/desktop/CLI 构建通过；Android web TypeScript 与打包通过。
- CAgent 原生 C# 窗口编译通过；29 项重点回归通过。
- 初次全量 788 项中仅两项渠道测试不适配开源固定渠道；修复开源构建显式 false 并以真实 bundle 验证，两个测试已通过。最终全量 788 项：784 通过、0 失败、4 条件跳过；日志见 `.local/core-1.0-check/tests-final.log`。
- 尚未运行本次开源 APK 原生四 ABI 构建、Windows 安装包或真实跨设备验收。后续子智能体新增的 MCP 高层文件工具需再做增量同步。
- 本轮不推送、不发布、不覆盖实际安装。

## 逐文件处理

| 文件 | 迁移方式 |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | 自动三方合并 |
| `android/app/src/main/java/hev/htproxy/TProxyService.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidAgentHost.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidAgentService.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidMachineVpnActivity.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidMachineVpnService.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidManagedFiles.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidNetworkChannel.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidNetworkProxy.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidNetworkStreams.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/AndroidVpnSocks.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/FeedbackActivity.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/FeedbackPrivacy.java` | 自动三方合并 |
| `android/app/src/main/java/org/canpshell/mobile/MainActivity.java` | 自动三方合并 |
| `android/app/src/test/java/org/canpshell/mobile/AndroidNetworkTest.java` | 自动三方合并 |
| `android/app/src/test/java/org/canpshell/mobile/AndroidVpnSocksTest.java` | 自动三方合并 |
| `android/web/app.ts` | 人工合并，保留开源边界 |
| `android/web/index.html` | 自动三方合并 |
| `scripts/feedback-ui-smoke.ts` | 自动三方合并 |
| `scripts/machine-copy-ui-smoke.ts` | 自动三方合并 |
| `scripts/machine-file-ipc-smoke.ts` | 自动三方合并 |
| `scripts/prepare-android-vpn.mjs` | 自动三方合并 |
| `scripts/provider-copy-ui-smoke.ts` | 自动三方合并 |
| `scripts/test-native-clipboard.mjs` | 自动三方合并 |
| `scripts/wsl-import-ui-smoke.ts` | 自动三方合并 |
| `src/agent/app.ts` | 人工合并，保留开源边界 |
| `src/agent/capability-catalog.ts` | 自动三方合并 |
| `src/agent/capability-download-source.ts` | 自动三方合并 |
| `src/agent/capability-installer.ts` | 自动三方合并 |
| `src/agent/cli.ts` | 自动三方合并 |
| `src/agent/desktop-capability.ts` | 自动三方合并 |
| `src/agent/file-transfer.ts` | 自动三方合并 |
| `src/agent/files.ts` | 自动三方合并 |
| `src/agent/installed-launcher.ts` | 自动三方合并 |
| `src/agent/managed-wechat-capability.ts` | 自动三方合并 |
| `src/agent/native/CagentWindow.cs` | 人工合并，保留开源边界 |
| `src/agent/relay.ts` | 保留开源原版（私有计量差异） |
| `src/agent/runtime.ts` | 人工合并，保留开源边界 |
| `src/agent/system-desktop.ts` | 自动三方合并 |
| `src/agent/wechat-capability.ts` | 自动三方合并 |
| `src/agent/wechat-market.ts` | 自动三方合并 |
| `src/core/api/agent-exposure.ts` | 自动三方合并 |
| `src/core/client/provider.ts` | 自动三方合并 |
| `src/core/client/server.ts` | 人工合并，保留开源边界 |
| `src/core/ftp.ts` | 自动三方合并 |
| `src/core/machine-copy-operation.ts` | 自动三方合并 |
| `src/core/machine-file-copy.ts` | 自动三方合并 |
| `src/core/mcp.ts` | 自动三方合并 |
| `src/core/provider-file-call.ts` | 自动三方合并 |
| `src/desktop/agent.ts` | 自动三方合并 |
| `src/desktop/ai.ts` | 人工合并，保留开源边界 |
| `src/desktop/feedback.ts` | 自动三方合并 |
| `src/desktop/main.ts` | 人工合并，保留开源边界 |
| `src/desktop/preload.ts` | 自动三方合并 |
| `src/desktop/wsl-download.ts` | 自动三方合并 |
| `src/desktop/wsl-setup.ts` | 自动三方合并 |
| `src/shared/agent.ts` | 自动三方合并 |
| `src/shared/ai.ts` | 自动三方合并 |
| `src/shared/contracts.ts` | 自动三方合并 |
| `src/shared/feedback-submit.ts` | 自动三方合并 |
| `src/shared/feedback.ts` | 自动三方合并 |
| `src/shared/local-terminal.ts` | 自动三方合并 |
| `src/ui/components/AgentMachineFiles.tsx` | 自动三方合并 |
| `src/ui/components/AiPermissionTree.tsx` | 自动三方合并 |
| `src/ui/components/ApiApplicationGrants.tsx` | 自动三方合并 |
| `src/ui/components/ErrorNotice.tsx` | 自动三方合并 |
| `src/ui/components/FeedbackPanel.tsx` | 自动三方合并 |
| `src/ui/components/FilePanel.tsx` | 自动三方合并 |
| `src/ui/components/FtpFilePanel.tsx` | 自动三方合并 |
| `src/ui/components/MachineFileCopyActions.tsx` | 自动三方合并 |
| `src/ui/components/MachineNetworkRules.tsx` | 自动三方合并 |
| `src/ui/components/McpSettings.tsx` | 自动三方合并 |
| `src/ui/components/NetworkSettings.tsx` | 人工合并，保留开源边界 |
| `src/ui/components/ProviderFileCopyActions.tsx` | 自动三方合并 |
| `src/ui/components/Settings.tsx` | 自动三方合并 |
| `src/ui/components/WslPlugin.tsx` | 自动三方合并 |
| `src/ui/components/agent-machine.css` | 自动三方合并 |
| `src/ui/components/feedback-panel.css` | 自动三方合并 |
| `src/ui/components/mcp-all-permissions.ts` | 自动三方合并 |
| `src/ui/components/wsl-offline.css` | 自动三方合并 |
| `src/ui/desktop-i18n.ts` | 人工合并，保留开源边界 |
| `tests/agent-build-edition.test.ts` | 自动三方合并 |
| `tests/agent-capability-runtime.test.ts` | 自动三方合并 |
| `tests/agent-files.test.ts` | 自动三方合并 |
| `tests/agent-installed-launcher.test.ts` | 自动三方合并 |
| `tests/agent-relay.test.ts` | 保留开源原版（私有计量差异） |
| `tests/capability-download-source.test.ts` | 自动三方合并 |
| `tests/client-dial-cancellation.test.ts` | 自动三方合并 |
| `tests/connection-management-grants.test.ts` | 自动三方合并 |
| `tests/desktop-clipboard-unavailable-native.cpp` | 自动三方合并 |
| `tests/direct-file-transfer.test.ts` | 自动三方合并 |
| `tests/feedback.test.ts` | 自动三方合并 |
| `tests/helpers/isolated-agent-process.ts` | 自动三方合并 |
| `tests/machine-file-copy.test.ts` | 自动三方合并 |
| `tests/provider-file-copy.test.ts` | 自动三方合并 |
| `tests/system-desktop-status.test.ts` | 自动三方合并 |
| `tests/system-proxy.test.ts` | 自动三方合并 |
| `tests/wechat-market.test.ts` | 自动三方合并 |
| `tests/wsl-setup.test.ts` | 自动三方合并 |
| `tools/cagent-desktop/install-system-service.ps1` | 自动三方合并 |
| `tools/cagent-desktop/native/desktop.cpp` | 自动三方合并 |

## 增量与隔离 Agent 实包核验

- e4b6bd0 的系统桌面与 WSL 内容与已迁移内容一致（两文件仅尾部空行差异）。c9374eb 保留通用反馈与 VPN 本地入口，排除账号同步专属代码。
- 补入 VPN JVM 测试脚本、说明和 APK 四 ABI/许可证强制检查；真实 SOCKS 测试通过 TCP 往返、DNS、UDP 拒绝、注入拒绝及出口失效关闭。
- 使用已核验 LLVM-MinGW 工具链构建 `.local/core-1.0-agent`；原生桌面、原生窗口及 PTY 通过。build-info 明确 `version=1.0.0`、`edition=opensource`。
- 从该实际包启动独立临时数据目录 Agent，远程监听保持关闭，通过真实本地 IPC 调用 `update.check` 成功，回执 current=1.0.0、available=false；完成后关闭该测试进程，未触及用户 Agent 或应用升级。
- 实包核验回执：`.local/core-1.0-check/agent-runtime-receipt.json`。此结果不表示 1.0 已发布，线上更新目录没有新包是正常状态。

## 最后共享增量（2026-11-04）

- 同步 Pro 1dbf567 的 MCP 高层目录复制、直传 helper 和 GUI 目录复制能力；d5a5bf8 的 Agent/main 接线按语义三方合并。开源不引入会员账号桥、私有域名后端或域名权限入口。
- 同步 9cfdb18：VPN SOCKS 已握手成功后遇到断流只关闭连接，不将 SOCKS 错误帧混入应用数据。实际 socket 负向测试通过。
- `pnpm exec tsc --noEmit` 与 `pnpm build` 通过；全套 791 项，787 通过、0 失败、4 跳过，日志 `.local/core-1.0-check/tests-mcp-final.log`。
- 文件复制交互测试覆盖切换来源会话不改变复制对象、目录复制、目标路径、取消与进度；390/1100 像素组件测试无横向溢出。截图在 `test-results/file-copy/`，为独立组件测试，不冒充真实双机吞吐验收。
- 最终再次构建实际独立 Agent 包，临时数据目录真实 IPC 验证 `1.0.0 / opensource` 与开源更新清单，测试进程正常退出。未升级本机应用、未推送、未发布。
