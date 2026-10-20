# 0.7.0 发布验证

发布时间：2026-10-20 21:05（UTC+8）。

- [GitHub Release](https://github.com/Yeqi99/CShell/releases/tag/v0.7.0)：已公开，标记为预发布。
- [完整构建与验证](https://github.com/Yeqi99/CShell/actions/runs/39425710008)：全部通过。
- 发布源码：`e6b2e8d1d9ad3ce81ce44b5510fef4ec52297a12`。
- 15 个平台包和 `SHA256SUMS.txt` 均已上传。发布任务逐项检查附件数量、大小及 SHA-256，全部匹配后才公开发行。

## 平台结果

| 平台 | 本轮结果 |
| --- | --- |
| Windows x64 | CShell 安装包、独立 CAgent 安装包通过构建；真实 PTY、TLS、隔离安装及桌面交互检查通过 |
| macOS Apple Silicon | CShell DMG/ZIP、CAgent 运行时构建通过；原生包与远控界面、全屏、紧凑布局检查通过 |
| macOS Intel | 同上，在 Intel macOS runner 上通过 |
| Linux x64 | CShell AppImage/DEB、CAgent 运行时构建通过；原生架构下包、密钥存储及界面检查通过 |
| Linux ARM64 | 同上，在 ARM64 Linux runner 上通过 |
| Android | APK 构建通过；API 29、35 模拟器原生连接与发行包检查通过 |

各平台包来自同一次工作流和同一源码提交，没有混用此前构建附件。

## 回归与本机更新

Node 全量 342 项与本机微信工具包 Python 97 项测试通过。发布前发现的设置布局预览循环、终端解析回调同步更新问题均已修复，并加入可复现旧错误的专项回归；最终 Windows 完整桌面检查通过。

本机已安装并打开包含最终修复的 CShell `0.7.0.0`，安装后的 ASAR 与本机构建内容一致。本地安装包和 GitHub runner 生成的包分别构建，不以二者二进制摘要相同作为验证依据。

## 验证范围

通过构建、自动化检查和模拟器测试，不等同于所有设备实测完成。锁屏/UAC、虚拟显示驱动、Windows Server 无头场景、不同 GPU、长期公网视频、多台实际机器与实体显示器，以及用户 Android/macOS 设备仍有待验收项目。

macOS/Linux CAgent 尚无与 Windows 等价的原生桌面采集；Android 为连接客户端，不提供完整桌面工作台。平台差异见[平台能力表](PLATFORMS.md)，其余边界见[版本说明](RELEASE-0.7.0.md)。Windows 包未做商业代码签名，macOS 包未声明完成签名与公证。
