# 1.0 发布剩余门槛（2026-11-04，只读盘点）

本表不代表发布批准或已完成；本轮未发布、未升级本机。以 `RELEASE-1.0-ACCEPTANCE.md` 和新增实测证据为准，不能用旧 ROAD-TO-1.0 历史基线判定当前状态。

## 源码与 0.8.22 基线

- 源码版本已统一为 1.0.0（提交 5665b6d），Android versionCode 为 1000000，新增手动候选构建流程。尚未完成最终平台成品构建与发布；不得把版本字段修改视为正式发布。
- `9e227c4`（已发布 0.8.22 账号 MCP bridge）不是当前 HEAD 的祖先；其代码已人工移植到工作树，但 `src/core/account-mcp-bridge.ts`、`tests/account-mcp-bridge.test.ts` 仍为未跟踪文件。相关 desktop cloud-sync / contracts / McpSettings 及生产桥接路由已存在。故不能声称“已全部提交合入”。冻结时逐项比对该提交的 9 个文件，保留后续 1.0 改动并纳入提交，再跑 bridge 回归。
- 当前有大量并行未提交文件，必须统一核对归属和提交后构建；不能从旧标签或旧候选目录取包冒充 1.0。
- 开源/Pro 共享修复同步后分别构建；CAgent 的 `__CSHELL_PRO__` define 和 build-info edition 必须验包，避免 Pro 自动更新再次下载开源包。

## 功能收口仍需核验

- 新会员域名仍在开发：完成后端配置、最小权限服务令牌和真实 DNS 验收，当前文档明确尚未生产验证。
- 反馈、流量计量、扩容、MCP 长连接、新分块保险库等后端尚需统一迁移/备份/上线验收；保持存量用户权益，不因增加默认额度字段而自动限流。
- 分块传输的新证据已在 VAULT-CHUNK-TRANSPORT-1.0.md，旧 SYNC-1.0-COVERAGE-AUDIT.md 中“尚未实现”条目已过时，收口需更新交叉引用。65 MiB 桌面真实 HTTP 通过，但 Android 256 MiB 实机未验证，不可提高手机上限冒充通过。
- UI / Android / 文件跨机器：按实际最终提交再跑已有 smoke；设备不可用或平台无能力的限制留在发行说明，不将 mock 页面视作真实手机能力验收。

## 构建入口与成品

- 桌面：`pnpm build`；Windows `pnpm dist`；`.github/workflows/release.yml`（开源）和 `pro-packages.yml`（Pro）覆盖 Win x64、macOS x64/arm64、Linux x64/arm64。
- CAgent：`node scripts/agent-build.mjs <output>`，Pro 必须显式 `CSHELL_EDITION=pro`；Windows native 指定已核验 LLVM-MinGW `CAGENT_NATIVE_CXX`，包含用户和系统桌面组件；其余平台见 cagent-release/pro-agent-candidate workflows。
- Android：build-android.mjs + Gradle 签名 release；遵守 scripts/android-release-identity.json，验签、包 ID、versionCode 和升级保留数据。
- 既有 candidate/publish workflows 中仍有 0.8.18/20/21 分支、并发组及历史 inventory 硬编码，不能直接触发就视为 1.0 发布流水线。先更新为准确最终提交和 inventory。
- 每个平台仅列成功构建且摘要核验的附件；macOS 签名/公证及未实机平台限制如实注明。

## 微信市场

- UI 只有一个“微信工具”，内部精确匹配适配包；保留旧安装身份与授权。0.1.3 候选两包已经兼容 1.0 并验证各 93 文件，但 docs/release-evidence/wechat-1.0-candidates.json 仍标 published:false。
- 上传已核验候选包和清单到公开可下载的香港/发行附件，再更新市场目录；私有实现源码不公开。不把 4.2 文本能力描述为旧版全部能力，也不宣称未知微信版本兼容。
- 安装、工具列表、授权/撤销、事件订阅仍用最终包再验，不仅靠目录去重测试。

## 部署次序

1. 冻结源码、回归、构建并生成分 edition/platform/arch 的摘要清单；创建新 v1.0.0 与 pro-v1.0.0，不移动旧标签。
2. 后端数据备份与迁移演练；部署兼容旧端的服务（含 vault_chunks.py），保留生产 MCP bridge 路由。分块表启用后不可回滚到忽略分块数据的旧服务。
3. 香港检查实际磁盘/剩余空间，保留最近两版与当前依赖；按已有授权只清理旧发布附件，不影响其它服务。先上传全部包再切清单，核验大小、SHA256、下载范围请求和失败恢复。
4. GitHub 两渠道 Release 核验后发布；官网下载、文档、admin 同步最终实际能力。不要让旧 0.8.20 publish inventory 覆盖 1.0 清单。
5. Cloudflare 用已授权官方 MCP/API 更新 Worker/路由，保留既有通用 Pro/开源路由；从公网实际读 releases.json 和附件，不以控制台部署成功代替更新验收。
6. 从当前已装版本检查/下载/校验/安装新版本，确认路径/渠道/身份数据；新域名开发及最终成品未冻结前不升级本机。

## 德威云恢复的发布后必做项

见 release-evidence/DEWEI-CAGENT-RECOVERY-20261104.md。真实会员中继、系统桌面首帧、输入确认、剪贴板序号已通过；没有改 RDP/微信。

当前目标仍为正式 Pro 0.8.21 加系统 worker 修复，旧包更新源错误，因此临时关闭自动更新。原值在目标数据目录 `pro-channel-recovery-update-setting.json`。**安装已确认 Pro 渠道的新正式包之后恢复原值，再核验更新源与心跳**，不能遗漏或提前恢复导致回退到开源后台。
