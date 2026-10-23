# CShell 官网

生产地址：https://shell.canp.ai/。静态站点使用现有香港服务器与 Caddy；账号 API、下载目录、管理员和 CanpAI 使用各自原有路由。

## 编辑与验证

- `index.html`、`downloads.html` 和 `docs/*.html` 为内容源，直接编辑。`scripts/build-portal.mjs` 校验页面及内部链接，不再用旧版文案覆盖页面。
- `theme.css`：官网与文档共用设计；`site.js`：设备选择、键盘导航与文档标题筛选。
- 运行 `node scripts/build-portal.mjs`，再运行 `node scripts/portal-smoke.cjs`。验证使用 Playwright 和本机 Edge，临时 HTTP 服务自动关闭。
- 下载地址在生成器和 `site.js` 中维护。新增附件先核对版本、架构、摘要及真实 URL，再更新页面；不能用开源安装包冒充 Pro。

## 发布规则

先备份现有 portal，在独立暂存目录解包并核对，再切换静态目录。不要覆盖管理员目录、API 服务、安装包或 CanpAI。发布后验证文档页面、下载 HEAD 与 API 健康状态。

2026-10-22：Pro 0.8.2 已发布 Windows x64、Android 签名 APK，以及 macOS ARM64/x64、Linux ARM64/x64 AppImage/DEB 实验包。官网提供架构和格式选择，开源版继续从 GitHub 下载。Mac 未公证，Mac/Linux 尚未实机验收。会员中继、应用网络代理和扩展同步等新版能力仍在联调，不将服务进程启动等同于功能发布。
