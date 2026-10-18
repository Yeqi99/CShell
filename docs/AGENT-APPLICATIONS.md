# Agent 应用安装

2026-10-16：新增原生 Agent 后端与 CLI / API / MCP 管理契约，无 Electron 依赖。当前提供 Windows WinGet、macOS Homebrew、Linux APT/DNF 配方。目录只返回检测到的包管理器对应配方，计划阶段查询真实包元数据；缺包、缺包管理器或权限不足会失败，不回退到控制端。

Windows 配方：Git、Node.js LTS、Python 3.13、VS Code、7-Zip、curl、jq、ripgrep、FFmpeg。macOS 使用对应 formula/cask；Linux 以发行版已配置软件源为准，未提供的配方不会出现。不自动新增软件源、安装包管理器、sudo、重启或启动安装后的应用。包管理器可能处理依赖或更新已有包；Windows 使用 no-upgrade。

## 授权与调用

所有安装默认关闭。目标 Agent 本机 CLI 的 `call applications.configure` 从标准输入接收：

```json
{"enabled":true,"controllers":[]}
```

空 controllers 仅允许本机调用。远端需要同时具备既有 agent.manage 权限与这里明确列出的控制端证书指纹。不能通过远程 applications.configure 自行扩大权限。授权独立加密持久化，不混入外观配置。

通过 `cshell-agent call METHOD` 的标准输入传参；远端通过 Agent 管理 API/MCP 的 method/params 调用：

| Method | 参数 | 结果 |
|---|---|---|
| applications.list | `{}` | 当前主机平台、真实包管理器、配方与调用方授权状态 |
| applications.plan | `{"app":"git"}` | 包元数据、可审阅的程序及参数、15 分钟计划 |
| applications.install | `{"id":"计划 UUID","confirm":true}` | 启动独立安装进程，立即返回任务 |
| applications.status | `{"id":"计划 UUID"}` | 状态、退出码、最多 32768 字符输出 |
| applications.cancel | `{"id":"计划 UUID"}` | 停止受管进程；部分安装不会回滚 |

运行中的任务断线后继续，结果按控制端身份隔离。执行前重新检查权限，运行时每秒检查撤权。单个 Agent 同时只运行一个包管理器任务；不能重复执行同一计划。最多保留 50 个任务，Agent 重启后的运行中任务标记 interrupted，不自动重试。取消、超时和撤权只能停止受管进程，安装器独立子进程可能保留；不承诺事务或回滚。15 分钟执行上限，后台不无限排队。

目前尚未新增应用市场图形入口。macOS/Linux 配方已做参数级测试，未在真实 macOS/Linux 机器上执行安装；不能宣称跨平台实际安装全部验收完成。

## 个人微信接入核查

**2026-10-17 最新进展覆盖下文早期状态：** 已完成 4.1.15.50 单次私聊文本收发实测和只读联系人缓存研究，但群聊探针随后发生 `frida-agent.dll` 崩溃。独立实验工具包已建立，实时收发入口封锁，不作为 Agent 正式可用能力。完整覆盖矩阵、未完成项与升级步骤见 [WECHAT-ADAPTER.md](WECHAT-ADAPTER.md)。下文“未注入、未发送”仅描述最初核查阶段。

本机运行的是 Weixin 4.1.15.50。用户要求沿用当前已登录个人微信，不采用 UI 自动化，允许向明确指定的测试联系人发送测试消息。

- [WeChatFerry](https://github.com/lich0821/WeChatFerry)：公开版本适配 3.9.12.51，仓库已归档，不能用于本机 4.x。
- [aixed/WeChat-Hook](https://github.com/aixed/WeChat-Hook)：公开说明目标 4.1.10.27，不等于支持 4.1.15.50。
- [miloira/wxhook](https://github.com/miloira/wxhook)：简介声称支持 4.1.15.50，但公开框架为 3.9.5.81；新版 pywechat 要求通过 QQ 群获取，说明还要求 4.x 首次使用重新扫码。未获得可核验的对应 SDK，也未验证接管已登录会话。

因此尚未加入可调用微信收发能力、未注入/降级/重启微信、未读取联系人或发送测试消息。获取对应版本且可核验的 SDK 后，仍需验证登录身份、联系人唯一匹配、收发结果和版本变化时拒绝执行；不能用占位接口或伪成功代替真实适配。

参考：[WinGet install](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)、[Homebrew 安装](https://docs.brew.sh/Installation)。
