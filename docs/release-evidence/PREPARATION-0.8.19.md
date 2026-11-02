# 0.8.19 构建与发布准备

状态：仅准备。不得使用尚未完成的源码构建，不创建 tag、不发布、不改现有更新目录。

## 源码对齐

- 当前两个工作树为 `core-unified-followup/CShell` 与 `pro-unified-followup/CShell`。account 负责桌面发现/Ping，cap 负责 Android 受控账号/中继；由各负责者完成测试、提交后再统一对齐公共实现。保留 Pro 账号、会员、同步差异，不能整树覆盖。
- 两边 `package.json` 升到 0.8.19 后固定精确完整源码 SHA。远端 Git Data 发布曾使用与本地不同 commit SHA，但 tree 相同；如继续此方式，必须记录本地 SHA、远端 SHA、tree，核验完全相同。控制清单在源码提交后单独提交，避免自引用。
- 上轮不同阶段包的留用基于逐项运行时等价证明；本轮不能仅改文件名沿用 0.8.18。Android/桌面已发生代码变化必须重建。CAgent 即使功能不变也需新版本号构建，按最终树完成相应打包验证。

## 预计库存：30 件

精确名称见 `PLAN-0.8.19.json`：Core 16、Pro 14，含各自 SHA256SUMS。两渠道各有 Windows x64 CShell EXE、Windows x64 CAgent EXE、Android APK、Linux x64/arm64 DEB 与 AppImage、macOS x64/arm64 DMG、CAgent Linux/macOS x64/arm64 tar.gz；Core 另有两架构 macOS ZIP。不虚构 Windows arm64 包。微信 0.1.2 未改则保持独立既有发行，不重发工具包。

## 复用构建入口

| 对象 | 已有入口 | 必须核验 |
|---|---|---|
| 桌面 | `.github/workflows/release.yml`；`pnpm build`；`pnpm exec electron-builder --win/--mac/--linux --x64/--arm64 --publish never` | 渠道配置、固定 source、原生平台/架构、真实窗口与包启动 |
| CAgent | `scripts/agent-build.mjs` → `scripts/package-agent.mjs`；独立 `cagent-release.yml` | Windows 固定摘要编译器、原生 PTY/生命周期、安装/解包版本与身份保留 |
| Android | `node scripts/build-android.mjs` → `gradle -p android assembleRelease lint` | `CSHELL_EDITION=pro` 与普通版分离；原签名/包 ID；versionName/Code 从 package.json 生成；真实手机能力和系统授权限制 |
| 全平台 | `release.yml` 原生 5 runner 矩阵、Android 与原生 API 29/35 检查 | 不把跨平台打包通过写成实机完成；保留签名/公证限制 |

构建流程的所有环境变量与签名材料沿用既有配置，不记录秘密。清除 Pro edition 环境后再构建普通版，避免包 ID、资源或配置串渠道。完整 `release.yml` 有 tag `v*` 发布入口，准备阶段只能使用明确不发布的 dispatch；不要提前打正式 tag。

## 发布控制需要适配

现有 `scripts/publish-verified-candidates.mjs` 固定 `version='0.8.18'`、`verified-*-0818.json`；工作流固定 0818 的 stage/publish 分支和 concurrency。019 开始发布前单独修改这些发行控制参数并更新其测试，不能直接调用现有版本冒充019。既有恢复脚本也须核验渠道/tag适用性，不直接恢复到错误版本。

`node scripts/check-0819-artifacts.mjs <opensource|pro> <目录> <40位源码SHA>` 可离线检查精确附件集、完整大小/摘要与 SHA256SUMS，并输出 inventory-only 报告。该脚本不写文件、不联网、不发布，也不证明传入源码 SHA 与包的构建来源；须另附 CI/本机构建及运行证据后，才能生成正式 verified 清单。

发布顺序：最终源码/构建验证 → HK 相邻暂存完整摘要核验/原子目录就位 → 两 GitHub draft 全量核验 → 两正式 release → 边缘生成 → HK 裸目录与原 Worker 同步 → 官网/admin/docs → 实际更新器完整下载/校验。不得覆盖旧 tag/同名不同摘要附件。

## Cloudflare 与验收

现阶段无可用 Cloudflare API connector/既有 CLI 配置；不继续搜索令牌，不新增凭据。现有已登录根会话浏览器可更新 Worker；编辑器 iframe 输入在自动化中受限，上轮用户粘贴部署，根任务通过 UI 保存路由。此限制应提前纳入最终发布安排，不能生成 bundle 就声称上线。

两正式 release 公开且 verified 清单完成后：`node services/update-edge/generate.mjs --released --version 0.8.19 --previous manifest.json`。保留已有8条绑定、只增两条019资产子树，最终10条。继续使用 `cshell-update-emergency`，不新增站点/DNS。验证裸 releases.json（不带绕路 query）、所有校验文件、新28二进制 ranges/固定SHA头，以及真实 AgentUpdater 全量下载验证。仅明确授权时安装本机。
