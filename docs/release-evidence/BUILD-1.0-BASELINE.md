# 1.0 候选构建与 0.8.22 基线对照

日期：2026-11-04。仅本地验证，没有触发 CI、发布或升级本机。

- package.json=1.0.0；开源输出 release/1.0.0，Pro 由配置自动输出 release/pro-1.0.0。
- Android Gradle 与 verify-android 均从 package 推导；versionName=1.0.0，versionCode=1000000，大于0.8.22的8022。包ID、签名身份未改变。
- 新候选入口：release-1.0-desktop-candidate.yml、release-1.0-agent-candidate.yml、release-1.0-android-candidate.yml；均只手动触发，不含生产发布。桌面/CAgent各双edition五平台架构，Android双edition。历史发布inventory未改动。
- 每个runner运行 `node scripts/verify-1.0-candidate.mjs`；CAgent构建后加 `--agent` 校验真实build-info版本/edition/平台/架构及Pro账号注册实现；成品继续现有PTY/TLS/账号/APK验签验包流程。
- CAgent build-info现明确记录edition，与bundler define一致，避免仅凭文件名判断渠道。

## 9e227c4 的9个文件

历史不可变SHA256存入 scripts/release-1.0-baseline.json；当前对照在 test-results/release-1.0/preflight-{edition}.json，脚本可重复生成。

| 文件 | 当前保留证据 |
|---|---|
| services/cloud-sync/bridges.py | 注册、账号/worker隔离、poll/reply/invoke/remove全部保留；额外加入1.0计量预留与结算 |
| services/cloud-sync/server.py | bridge import、注册/poll/reply/remove/invoke认证路由保留 |
| services/cloud-sync/test_bridges.py | 与原提交相同；4项真实测试全部通过 |
| src/core/account-mcp-bridge.ts | opt-in客户端绑定、账号身份加密、独立consumer/session所有权实现保留 |
| src/desktop/cloud-sync.ts | AccountMcpBridge初始化、before-quit停止与可选MCP provider保留 |
| src/desktop/main.ts | registerCloudHandlers传入实际mcp provider保留 |
| src/shared/contracts.ts | accountBridge.clientId UUID可选配置保留 |
| src/ui/components/McpSettings.tsx | 已授权客户端选择及accountBridge配置入口保留 |
| tests/account-mcp-bridge.test.ts | 真实HTTP桥接caller与session归属测试通过 |

这表示实现和回归已在当前工作树，而不是9e227c4已成为当前分支祖先。两个新增TS桥接文件仍需随父任务统一提交，否则从HEAD构建缺失。静态标记/哈希不代替行为回归。

已运行：双edition preflight、桥接TS与构建渠道/旧窗口保护共3测试、Python bridge4测试；新workflow YAML解析/矩阵/仅手动触发验证通过。尚未构建1.0全平台附件、未验证Android真APK的1.0签名与版本，需最终冻结后的candidate运行补齐。

补充：scripts/build.mjs 的桌面捆绑 dist/agent/agent.cjs 也已注入 edition。测试实际执行构建脚本收集各入口参数，再分别用两种define构建下载源，桌面主进程/捆绑Agent/CLI全部验证通过（2项渠道测试）。
