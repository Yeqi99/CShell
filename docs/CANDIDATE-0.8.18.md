# 0.8.18 普通版候选验收

当前为候选，不是已发布版本。未创建标签、未变更线上下载/更新源、未覆盖用户安装。

## 第一轮 Windows 安装包

本地候选源码 `bd02e0396a42646ca9b299748c61de5d3c21c399`。

| 包 | 字节数 | SHA-256 |
|---|---:|---|
| CShell-0.8.18-win-x64.exe | 123762018 | e05732378bb7f27c2f1bad8980b1895dc779bed3bc36d1b848f69d69678dae06 |
| CAgent-Setup-0.8.18-win-x64.exe | 26186593 | 7e89fb037512f883ff4980d732e1e252a5c6692ee329dd77360a028498acb31f |

CShell 实际 win-unpacked exe 通过隔离 SSH 终端、SFTP、sandbox 验收。CAgent NSIS 解包后摘要核验、实际 CMD PTY、TLS、受限授权及停止通过。两包未签名；Windows SmartScreen 提示仍可能出现。

## 候选 CI

GitHub 候选分支 `codex/candidate-core-0.8.18` 首轮远端提交 `706cddcd2558e778ab729cd9e97d95dba7c7aa3e`，tree `9c12732b075b824e74c44afed1811332d6c525c8` 与本地源码 tree 完全一致。远端提交由 Git Data API 创建，不冒充本地提交历史相同。

工作流 `41280855262` 仅构建上传 artifact，publish 条件不满足，不能生成 Release。Android API 29/35 验收完成；Linux/macOS 第一轮测试长时间未结束，尚不能计为通过。Windows 第一轮发现 RDP 标签宿主复用与编辑器 smoke 样式打包配置问题。

后续已同步独立 RDP session ID 与 editor smoke outfile 修复；实际 RDP saved smoke、editor reload race smoke、TypeScript 检查通过。测试加入每项 120 秒超时以显露跨平台挂起，不通过 force-exit 隐藏资源泄漏。后续源码变化须重新生成候选包，以上首轮摘要不作为最终发布附件摘要。
