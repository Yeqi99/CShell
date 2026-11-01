# 0.8.18 发布执行准备（未启用）

`publish-verified-candidates.yml` 与 `scripts/publish-verified-candidates.mjs` 仅负责发行控制，不重新构建应用。当前 verified 清单处于 blocked 状态，脚本会在网络访问前拒绝；新增 Android 输入用例尚未通过时不能解除。

## 开始发布前

1. 固定两渠道完整源码树，确认当前产品代码与各平台构建的适用源码一致。更新 `verified-{opensource,pro}-0818.json` 的 source SHA 和精确附件；控制元数据单独提交，避免 SHA 自引用。
2. 合并最终 2 个 Android 包、2 个 Windows CAgent 包和重新生成的两份 SHA256SUMS；其他 24 个已验二进制不重建。完整库存必须为 30 件（普通版 16，Pro 14）。香港私有暂存收据重新核验全部 30 件，不能只检查新文件。
3. 更新两个公开发行说明草稿的最新实测结果和限制。Windows 未签名、macOS 公证限制、物理 Android 与会员中继的实际状态须准确保留。
4. 仅在根任务确认全部发布门禁满足并开始发布后，使用现有香港静态站，将受控暂存完整版本目录放到 `/downloads/opensource/v0.8.18/` 与 `/downloads/pro/v0.8.18/`。目录内不得有私有源码、密钥或本地证据文件；先在同一文件系统相邻临时目录校验，再 rename 为新版本目录，不覆盖旧版本。此时保持两条 `releases.json` 和边缘更新目录不变。

## GitHub 两渠道

- 固定仓库 `Yeqi99/CShell`、tag `v0.8.18` / `pro-v0.8.18`。不得移动已有 tag。工作流只使用 GitHub 自带的 `GITHUB_TOKEN`，不需要导出用户令牌。
- 准备 `codex/publish-verified-0.8.18-stage` 精确提交，通过既有 GitData 推送触发 stage。默认脚本为 `--check`；stage 必须明确执行。
- stage 先检查两源码提交和已有 tag，完整下载香港 30 个文件并逐一检查长度、流式上限、SHA256、SHA256SUMS 内容，随后创建或续传两个 draft。附件命名、数量、GitHub 返回 digest 必须完全一致；未知附件或同名不同摘要立即停止，绝不自动删除或覆盖。
- 根任务复核两个完整 draft 后，再推送 `codex/publish-verified-0.8.18-publish` 或明确 dispatch publish。发布动作不修改更新源。
- 两个 release 的发布不是跨对象原子事务。中间失败时保持更新目录未切换；重跑会只读核验已公开的精确渠道，继续另一 draft。已公开文件/source 不一致时必须停止人工定位，不回滚或覆盖历史发布。

## 下载与更新源

两渠道公开附件和 source 逐一确认后，运行 `services/update-edge/generate.mjs --released --version 0.8.18 --previous manifest.json`。它必须验证正式 public release 与精确清单一致，然后才允许部署边缘更新路由和切换两份版本目录。官网、文档及下载入口使用同一摘要库存；完成实际检查/完整下载/摘要与安装入口验收，再更新本机对应版本。

本流程不部署新下载服务、不公开私有微信实现、不更改用户会话或安装现有机器，也不把准备好的工作流当作已发布结果。
