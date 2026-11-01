# 0.8.18 候选构建记录

2026-11-01。尚未发布；没有创建发行标签、替换线上更新清单或升级用户的实际安装。

## Windows Pro

- `release/pro-0.8.18/CShell-Pro-0.8.18-win-x64.exe` 已成功生成，包括 blockmap。
- SHA-256：`e059e40ae8ac52b24fcf7d75eabd5da2e4f4a550571b4bde59a64d6bc7cb83c6`。
- 安装器和应用没有 Authenticode 签名，不声称已签名。
- 使用该构建的实际 `win-unpacked/CShell Pro.exe`，隔离配置运行 `platform-package-smoke.ts` 通过。此前最新源码的完整真实桌面交互验收另见主清单。
- 本机首次安装器构建因直连GitHub超时失败；使用现有本机代理重新执行打包成功，没有修改系统代理。

## CAgent 与 Android

- 0.8.18 CAgent独立运行包构建通过，真实CMD PTY/TLS/权限限制/停止通过。
- CAgent候选EXE已在独立目录静默安装，逐个核验48个payload文件摘要，再运行安装后的真实终端/TLS验收通过。未替换实际安装、快捷方式或开机启动项。EXE SHA-256：`e6d0626f390bbcc9ebb94e00286d6c7874791e43ea9dc11ec9495caf05d69dfb`，未签名；收据 `test-results/pro-cagent-0.8.18-installer.json`。
- 对此候选原生窗口执行实际API验收，模型选择、自动化规则管理、主题应用、权限与身份保持通过；使用临时配置，没有调用真实模型或微信。
- Android Pro debug和androidTest包、lint完成（71项Gradle任务，构建成功）；debug不是正式签名包。手机系统仍拒绝USB安装，不能据此宣称安卓实机验收通过。

## 发布前仍须完成

以 [最终验收矩阵](UNIFIED-FINAL-AUDIT-20261101.md) 为准，继续实际微信事件、新设备云恢复与CAgent出口、双机Windows剪贴板、Android系统授权后的验收。候选源码与跨平台构建只生成核验附件，不自动发布。

完成验收后再发布递增标签、核验附件/香港下载源/更新通道、更新官网文档，并保留数据升级和打开本机对应应用。

## Android 正式签名候选核验

GitHub候选工作流41281283583成功，使用既有release密钥，没有创建新签名身份。下载的artifact压缩包SHA-256为2f601caf2ce0c6a3d47392e2b9f682eb11783a328e58420e3ab9792d9caf2e58，与GitHub记录一致；APK摘要4f7efbd66da73bad7af7d4c80d41a919435a59de4e7fb8a665291e1d30fce552，与附件清单一致。apksigner验证通过，证书SHA-256为34cc1c9a0eacafc512a0837c3d286081879822f047e5637a65cdbc5b525914c5。

用户确认开启USB安装后，向已授权Android16手机重试此签名APK，仍立即返回INSTALL_FAILED_USER_RESTRICTED: Install canceled by user。系统没有显示安装页，手机上没有CShell包；不能标记实机验收通过。没有修改手机安全设置或绕过系统确认。

## 收口重建 · 本机 Windows

后续真实RDP多标签隔离、CAgent网页偏好/自动化、原生验收入口隔离及远控状态提示已纳入重新构建。此前本文首轮摘要仅保留为历史，不作为最新发布附件。

- Pro NSIS最新SHA-256：fd5d6ec9c2f7808fe227c90f0cb0373c57a976f775206e05e701c20d70d18b78。实际win-unpacked应用完成platform-package-smoke与release-desktop-smoke，真实SSH/文件/布局/字体草稿/权限MCP等通过。
- CAgent NSIS最新SHA-256：6732ee491149e85849969e2a1175aee4b8279570af83cbcf0e97a27891bacef9，26,227,803字节。安装到隔离目录后真实CMD/TLS/授权/退出通过；原生模型/自动化/主题及身份跨重启验证通过。签名状态仍为未签名。
- 手机已改用系统文件管理器正常安装上述正式签名Android候选并启动；USB安装限制未绕过。实际视频已成功，键鼠和系统授权验收继续，详见Android记录。
- 本机实际用户应用仍未被候选替换，正式渠道未切换。

### 最新 Windows Pro 候选

包含非Windows代理清理、临时连接重连与独立小窗DPI修复的正确Pro配置安装器已重建：release/pro-0.8.18/CShell-Pro-0.8.18-win-x64.exe，SHA-256 `69188fad9fbe886dcfa8b55c6434a2a17de0ae222091a606167b005bb011c88b`。platform-package-smoke及release-desktop-smoke针对该目录的真实CShell Pro.exe全部通过。尚未签名、安装到用户目录或发布。

本轮曾误以默认builder配置产生Pro工作树release/0.8.18/CShell-0.8.18-win-x64.exe；它明确排除于所有发行清单，不属于有效开源或Pro附件，未安装或上传。开源只采用Core工作树构建；Pro仅采用显式electron-builder.pro.cjs产物。CAgent按独立已核验清单取包，不使用release目录全量glob上传。
