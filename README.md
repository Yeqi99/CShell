<p align="center"><img src="assets/icon-512.png" width="88" alt="CShell" /></p>

# CShell

**一个工作台，连接和管理你的电脑与服务器。**

简体中文 · [English](README.en.md) · [日本語](README.ja.md)

CShell 将终端、文件、远程桌面和智能体放在同一个机器工作区中。你可以连接一台服务器处理日常工作，也可以把多台机器的终端和桌面排列在同一视图里，保存布局，下次继续。

[下载安装](https://github.com/Yeqi99/CShell/releases) · [平台差异](docs/PLATFORMS.md) · [问题反馈](https://github.com/Yeqi99/CShell/issues) · [MIT License](LICENSE)

## CShell 和 CAgent 是什么？

| 产品 | 安装在哪里 | 用来做什么 |
| --- | --- | --- |
| **CShell** | 你正在使用的电脑或手机 | 连接机器，操作终端和文件，查看远程桌面，与智能体协作 |
| **CAgent** | 需要被管理的机器 | 向已认证的 CShell 提供该机器的终端、文件与可用应用能力；也可独立运行智能体 |

已有 SSH 服务的机器可以直接连接，**不必安装 CAgent**。需要 CAgent 的机器工作区或其远程桌面能力时，再在目标机器安装它。独立 CAgent 不依赖完整 CShell、Electron 或捆绑的浏览器；安卓通过 CShell 内的 CAgent 扩展提供受支持的被控能力。

基础连接不需要 CShell 产品账号。智能体使用你配置的模型服务，推理位置和费用由该服务决定。

## 可以做什么

- **管理连接与终端**：SSH 和 CAgent 共用分组、收藏、搜索与双击连接；桌面端提供多标签和极简窗口，切换页面保留会话。
- **处理文件**：浏览、传输和预览文件。桌面端可编辑 SSH 文本文件，选择保存后上传或实时同步，遇到冲突和断连时保留草稿。
- **远程操作电脑**：通过 CAgent 连接支持的桌面，调整画质、控制键鼠和传输文件。控制端与被控端的系统支持不同，见平台表。
- **组合工作视图**：把终端、远程桌面和智能体会话组合成平铺、主次或小窗预览布局；桌面端支持多显示器、单区域关闭及保存恢复。
- **让智能体协助工作**：连接模型服务后，在明确的机器范围内执行命令、处理文件和调用工具。可查看执行记录、审核操作、停止任务，并通过事件规则触发工作。
- **按需扩展**：通过插件使用 Python 补全、Docker、HTTP、OpenCode 模型接入或 Tavily 搜索；应用市场安装和配置所选机器上的能力。

模型密钥、机器授权和外观配置分别管理。智能体发送给模型服务的内容可能包括对话及已授权的工具结果。

## 快速开始

1. 从 [Releases](https://github.com/Yeqi99/CShell/releases) 下载对应系统和架构的安装包。
2. 打开 CShell，新建 SSH 连接；或在目标电脑安装 CAgent，配置地址、端口和密码，再从 CShell 连接并核对设备身份。
3. 在机器工作区打开终端、文件或可用远程桌面。安卓文件页可切换手机目录与远端文件。
4. 需要同时观察多台机器时，在桌面工作台创建视图；需要智能体时，先配置模型服务和访问范围。

## 平台支持

| 平台 | CShell | CAgent |
| --- | --- | --- |
| Windows x64 | 桌面工作台，`.exe` 安装包 | 独立原生小窗；终端、文件及 Windows 桌面能力 |
| macOS Apple Silicon / Intel | 桌面工作台，`.dmg` / `.zip` | 独立运行时及浏览器界面；终端、文件与管理 |
| Linux x64 / ARM64 | 桌面工作台，`.AppImage` / `.deb` | 独立运行时及浏览器界面；终端、文件与管理 |
| Android | 移动客户端，`.apk`；SSH、文件、CAgent 连接及远控 | 内置扩展；系统授权后的屏幕共享与受限输入 |

**平台支持不代表所有功能完全相同。** Android 不提供完整桌面多窗口工作台；macOS / Linux CAgent 尚无与 Windows 等价的原生桌面被控实现。安卓锁屏录屏、Windows 锁屏与无显示器控制也有系统和硬件限制。详细范围见 [平台能力表](docs/PLATFORMS.md) 和 [Android CAgent](docs/ANDROID-CAGENT.md)。

安装包是否已发布，以 Releases 实际附件为准；核对版本说明与 `SHA256SUMS.txt`。macOS 签名、公证及设备验收状态以对应发行说明为准。

## 文档

| 主题 | 入口 |
| --- | --- |
| 连接与机器管理 | [连接](docs/CONNECTION-PROVIDERS.md) · [CAgent](docs/CAGENT.md) |
| 工作区 | [多机器视图](docs/MONITOR-VIEWS.md) · [文件编辑](docs/TEXT-EDITOR.md) |
| 智能体 | [模型与任务](docs/AI.md) · [事件规则](docs/AI-EVENTS.md) · [OpenCode](docs/OPENCODE-EXTENSION.md) · [Tavily](docs/TAVILY-EXTENSION.md) |
| 扩展与集成 | [插件](docs/PLUGINS.md) · [HTTP API](docs/API.md) · [MCP](docs/MCP.md) |
| 平台与构建 | [平台能力](docs/PLATFORMS.md) · [Android](android/README.md) · [依赖](docs/DEPENDENCIES.md) |

详细技术文档目前主要使用中文；本页提供中文、英文和日文版本。

## 开发与维护

使用 Node.js 24 和 `package.json` 指定的 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
pnpm test
```

桌面安装包使用 `pnpm run dist`，独立 CAgent 使用 `node scripts/agent-build.mjs`。原生组件需要在对应系统与架构上构建；Android 另需 JDK、Gradle 和 Android SDK。

0.7 系列完成本轮功能收口后，开源版以错误修复、兼容性、稳定性和文档维护为主。新增产品功能主要在后续 CShell Pro 中开发；Pro 的能力与交付时间以实际发布为准。已有开源代码继续采用 MIT 许可证。

欢迎提交 [Issue](https://github.com/Yeqi99/CShell/issues) 或 Pull Request。请附版本、控制端与被控端系统、复现步骤及去除凭据的日志。随包第三方软件遵循各自许可证，见 [第三方声明](THIRD_PARTY_NOTICES.txt)。
