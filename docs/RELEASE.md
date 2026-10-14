# CShell 0.6.0 开发预览

发布状态与下载附件以 GitHub Release 为准；本地构建不代表已发布。

## 工作台

- 新建连接先选择用途，各类型保留独立草稿；插件市场改为紧凑图标卡片，应用详情与执行反馈保留在可见工作区。
- WSL 网络与代理在插件内配置，保存时备份并保留其他配置；重启前明确提示对已有任务的影响。
- HTTP 扩展提供多目标请求工作区、保存与历史、取消和响应预览。本机、SSH、Agent 发送方按真实能力提供，人工与智能体共用后端授权。

## 独立 Agent

CShell Client 更名为 CShell Agent。Agent 独立安装，无 Electron 或 Chromium；CShell 插件用于发现和管理本机 Agent，或配置明确选择的远程 Agent。

- 原生终端协议支持 Windows CMD / PowerShell、Linux 与 macOS 的实际 Shell；不要求目标机安装 SSH。
- Windows Agent 可管理该机器上的 WSL 环境。安装、初始化和环境选择分别反馈实际状态；不会操作控制端电脑的 WSL。
- 可选 HTTP 服务托管与中继具有独立权限，默认关闭。自定义服务代码运行在单独进程中，进程隔离不等同于安全沙箱。
- 保留旧 Client 的连接、设备身份与已有授权。新能力不随迁移自动授予；复制普通连接信息不包含密码。

## Android

Android 预览加入 Agent 连接及真实终端环境选择，继续支持 SSH。Agent 需要 Android 10 或更新版本；较旧系统不降低 TLS 要求。Agent 暂不提供文件面板，不能将其当作已有 SFTP 支持。

## 发行附件

- 主程序：Windows x64 安装包；macOS arm64 / x64 DMG 和 ZIP；Linux x64 / arm64 AppImage 和 DEB。
- Android：`CShell-0.6.0-android-test.apk`，使用既有发行签名。
- 独立 Agent：Windows x64 ZIP；macOS 与 Linux 各 arm64 / x64 TAR.GZ。解压后使用所附命令行入口，当前不宣称已经注册为系统服务。
- `SHA256SUMS.txt`：本次所有附件的 SHA-256。

Windows 与 macOS 包未使用开发者代码签名，macOS 未公证。Android 使用持久签名并核对证书指纹；构建与测试不等同于全部真实设备和网络场景已验收。

WSL 安装与账号初始化具有计划、确认及状态反馈，但本轮未在真实系统执行安装、重启或账号修改；现有发行版连接验证不代表已完成这些系统变更的验收。

源码采用 MIT，依赖许可见所附第三方声明。验证记录与未完成项见 [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)。
