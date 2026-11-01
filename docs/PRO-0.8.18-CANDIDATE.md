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
