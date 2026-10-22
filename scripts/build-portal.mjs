import fs from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const root=path.resolve('services/portal'), github='https://github.com/Yeqi99/CShell';
const pages=[
['start','开始使用','入门',`# 从第一台机器开始

CShell 是连接机器、使用终端、管理文件与运行智能体的工作台。cagent 是安装在目标机器上的独立智能体，也为 CShell 提供机器连接能力。

## 选择产品

- **CShell 开源版**：MIT 许可，从 GitHub 下载，无需 Pro 账号即可使用本地工作台。
- **CShell Pro 免费版**：在共享核心上增加账号和云同步。Windows、Android 测试安装包可在官网获取。
- **Pro 会员版**：同一个 Pro 客户端，通过账号权益提供更大的配置空间与会员能力。目前处于内测，未开放付费购买。
- **cagent**：安装在希望管理的机器上；不需要安装完整 CShell。

## 第一次连接

1. 在[下载页](/#download)选择系统和版本，安装并打开 CShell。
2. 点击「新建连接」，选择实际需要的 SSH、Windows 远程桌面或 cagent 连接方式。
3. 填写目标地址和认证信息；连接 cagent 时核对目标设备身份。
4. 在左侧连接列表双击机器，进入所属工作区。文件、终端与应用始终操作这台机器。

## 使用 Pro 同步

从主页账号入口注册或登录。登录后连接、模型及支持的设置自动同步，不需要每次手动上传。运行中的终端会话属于当前设备，不会跨设备迁移。详见[账号与同步](cloud.html)。

## 找到适合你的指南

[Windows](windows.html) · [macOS](macos.html) · [Linux](linux.html) · [Android](android.html) · [扩展与应用](extensions.html)
`],
['connections','连接、终端与文件','功能',`# 连接、终端与文件

## 连接列表

SSH 和 cagent 机器共用左侧列表，可命名、分组、收藏和编辑。双击连接；修改配置或删除记录从菜单进入。删除分组保留连接。首次身份提示用于确认目标，不能因为名称相同就忽略指纹变化。

## 终端

终端绑定真实连接。切换工作区保留正在运行的会话、滚动历史与草稿。Windows 本机可使用 CMD、PowerShell；WSL 从扩展中进入真实检测到的发行版。远程 cagent 使用目标系统支持的终端。

命令联想只补全输入，不自动执行。Ctrl+C 保留终端中断语义。密码提示、全屏编辑器与断开状态不应继续显示普通 Shell 候选。

## 文件和编辑

从机器的「文件」进入上传、下载和目录浏览。SSH 文本编辑器与 Python 扩展按目标实际能力开放。保存发生冲突时先核对远端内容，不直接覆盖。Android 本机文件通过系统目录选择器授权，不等同于整个手机文件系统访问。

## 断开与恢复

连接失败时检查地址、认证与目标服务状态。未连接时监控不代表实时值；浏览器的远端网络断开后不会自动改用本机网络。关闭会话前先保存编辑内容。

协议和平台细节：[连接 Provider](https://github.com/Yeqi99/CShell/blob/main/docs/CONNECTION-PROVIDERS.md)。
`],
['desktop','机器桌面与浏览器','功能',`# 机器桌面与浏览器

cagent 连接面向整台机器。进入机器工作区后，按需打开终端、浏览器、文件、应用和智能体，而不是必须先选择一个 Shell。

## 浏览器的网络归属

CShell 在本机渲染浏览器，通过所选机器的网络出口请求网页。它不是远端浏览器截图。缓存和 Cookie 按机器隔离保存在本机；网络断开时不悄悄退回本机出口。

历史、收藏和标签与网站 Cookie 不同。Pro 的新同步功能正在联调，当前下载包不代表已经包含所有新增同步项目，见[发布与验证](releases.html)。

## 远程控制

远程桌面依赖目标系统实际提供的采集、输入和权限。Windows、Android 被控能力不等同于 macOS/Linux。Android 需要系统录屏授权；锁屏、后台限制及厂商系统可能终止投影。

## 原生应用

应用文件夹只应列出目标机器已适配的可启动应用。Linux 原生图形应用使用独立兼容入口，不把普通浏览器冒充完整 Linux 桌面。QQ、微信等能力须逐项满足版本、依赖和权限条件。

更多：[Linux 可视化工作区](https://github.com/Yeqi99/CShell/blob/main/docs/LINUX-VISUAL-WORKSPACE.md)、[桌面边界](https://github.com/Yeqi99/CShell/blob/main/docs/CAGENT-DESKTOP.md)。
`],
['ai','智能体、模型与记忆','功能',`# 智能体、模型与记忆

## 配置基座

在智能体的模型配置中添加服务地址、模型名称和密钥，选择会话实际使用的基座。密钥独立加密保存，不进入外观方案。会话绑定的目标机器和模型应始终可见。

## 授权与执行

按应用能力和机器范围授权。审核策略只决定已授权操作是否逐次询问，不会自动扩大机器范围。安装扩展或应用也不代表授予智能体调用权限。查看工具执行记录，可在当前任务中停止执行。

## 账号习惯记忆（联调中）

新的 Pro 版本正在加入账号习惯记忆：保存偏好、允许智能体在授权范围内读取和修改，用户可编辑或删除。习惯内容不应保存密码、令牌或私钥，也不能替代权限配置。当前下载包尚未交付此功能。

## 官方模型（联调中）

正在接入自建 Qwen3 8B 与 Qwen3.5 4B 视觉服务，通过账号网关调用。客户端不应取得服务端原始密钥。可用性、额度与具体客户端版本以正式发布说明为准。

更多：[智能体指南](https://github.com/Yeqi99/CShell/blob/main/docs/AI.md)、[事件工作流](https://github.com/Yeqi99/CShell/blob/main/docs/AI-EVENTS.md)、[MCP](https://github.com/Yeqi99/CShell/blob/main/docs/MCP.md)。
`],
['cloud','账号、云同步与会员','功能',`# 账号、云同步与会员

## 注册与登录

在 Pro 主页进入账号页面。使用邮箱验证码注册，可使用固定密码或邮箱验证码登录。收不到邮件时检查垃圾箱、邮箱地址与发送冷却时间。

## 自动同步

登录后自动同步支持的连接、模型和设置。连接凭据与模型密钥随加密配置保存。运行中的进程、终端内容、远端文件和浏览器缓存不属于配置同步。机器权限保持独立，恢复配置不会自动授权第三方扩展。

若当前测试版出现网络错误，先检查服务连接；存在本机与云端双向修改冲突时保留备份后再处理，不反复覆盖原有数据。新的多设备合并与扩展同步仍在联调。

## 内测权益

| 项目 | Pro 免费版 | Pro 会员内测 |
| --- | --- | --- |
| 云端配置空间 | 2 MiB | 64 MiB |
| 当前基础同步 | 支持 | 支持 |
| 同账号 cagent 无公网 IP 接入 | 不包含 | 联调中 |
| 机器间应用网络代理 | 不包含 | 联调中 |
| 账号习惯记忆、共享基座 | 新版联调中 | 新版联调中 |

配置空间不是文件网盘容量。会员购买尚未开放；未完成端到端验证的能力不作为当前安装包承诺。

## 应用代理的范围

首版目标是让 A 机器或本地 CShell 的受支持应用通过 B 机器上网。它不是全系统 VPN，不自动接管任意程序或 UDP。网络出口必须明确选择，出口离线时失败并提示，不能偷偷改为本地访问。
`],
['extensions','使用扩展与应用市场','功能',`# 使用扩展与应用市场

这两个市场解决不同问题：**扩展**增加工作台能力；**应用**安装到你选定的真实机器上。

## 扩展

从扩展市场搜索、安装和启用需要的插件。Vim、Nano、Shell 联想、Docker、Conda、Python 等按各自支持范围工作。插件的专属设置和视图从已启用插件条目进入。停用插件不应关闭已有普通终端；卸载插件不会卸载服务器的软件。

第三方声明式命令包只提供候选命令，选中后仍需审阅并执行。不要把插件发布者的文字名称当作身份认证。

## 应用

1. 先选择要安装的目标机器。
2. 检查真实包管理器、系统与已有依赖。
3. 阅读安装计划、目录和权限影响。
4. 确认后执行，在所属工作区查看进度和失败原因。

安装任务使用独立通道，不向当前终端注入命令。不自动提权或添加软件源；停止任务不保证已经安装的文件被回滚。

## cagent 能力包

能力包将已安装的软件包装成可授权的工具。系统安装、配置、版本核验和工具授权分别检查，只有全部满足才显示可用。

准备接入自己的功能？先阅读[开发者接入路线](developers.html)。
`],
['windows','Windows','平台',`# Windows

## 安装

[官网下载 Pro](/#download)，开源版前往 [GitHub Releases](https://github.com/Yeqi99/CShell/releases)。当前 Pro 提供 Windows x64 测试安装程序，可与开源版独立安装。升级前保存重要编辑内容。

## 本机与远端

Windows 本机终端支持 CMD / PowerShell。WSL 通过扩展使用检测到的真实发行版；Windows 主机与 WSL 是不同环境。修改 WSL 网络配置不应自动重启正在运行的发行版。

远程目标可使用 SSH 或 cagent。Windows cagent 使用独立运行时，不要求安装完整 CShell。安装程序、缓存与私有依赖应放在选择的专用目录，保留已有身份和授权。

## 已知边界

Windows 锁屏、UAC、无显示器与多显示器行为依赖原生能力和环境。软件包存在不等同于可信签名；按发行校验值核验下载，遇到身份变化先检查来源。

[Windows 发行与信任说明](https://github.com/Yeqi99/CShell/blob/main/docs/WINDOWS-RELEASE-TRUST.md)
`],
['macos','macOS','平台',`# macOS

## 获取对应架构

在 [GitHub Releases](https://github.com/Yeqi99/CShell/releases) 查找开源版 macOS 附件：Apple Silicon 选择 arm64，Intel 选择 x64。以该次发行实际附件为准；不要下载 Windows 安装程序。

Pro 的 macOS 安装包尚未发布。网站保留下载入口和平台文档，后续完成构建与核验后会提供站内下载。构建验证不等同于 Apple 公证或全部真机验收。

## 功能范围

桌面端共用连接、终端、文件、智能体与扩展核心。Windows 专属 CMD、PowerShell 和 WSL 入口不适用。cagent 的被控桌面采集能力不与 Windows 自动等同。

应用安装按目标真实 Homebrew 环境检查；没有包管理器时不会静默安装或改变系统环境。

## 问题反馈

请提供 macOS 版本、CPU 架构、下载版本和可复现步骤，移除日志中的密钥。不要通过关闭系统安全机制解决来源不明的软件包问题。
`],
['linux','Linux','平台',`# Linux

## 下载

从 [GitHub Releases](https://github.com/Yeqi99/CShell/releases) 选择开源版 Linux x64 或 ARM64 附件。格式以实际发行列表为准。Pro 的 Linux 安装包尚未发布，站内下载将在构建和核验完成后开放。

## 桌面客户端与 cagent

CShell 桌面客户端需要可用图形环境。cagent 独立运行，可提供已授权的终端、文件、HTTP 和管理能力，不依赖 Electron 或捆绑 Chromium。

Linux 的机器工作区、浏览器网络出口和原生图形应用是不同能力。不要将可视化工作区理解为已支持所有 Linux 原生桌面采集。

## 应用与系统依赖

应用目录按目标发行版实际检测到的 APT/DNF 等包管理器提供配方。不自动添加软件源、sudo 或替换系统依赖。不同 glibc、显示服务与发行版仍需对应环境验证。

[Linux 可视化工作区](https://github.com/Yeqi99/CShell/blob/main/docs/LINUX-VISUAL-WORKSPACE.md)
`],
['android','Android','平台',`# Android

## 安装与升级

从[官网下载](/#download)获取 Pro 签名 APK；开源版从 GitHub 下载。最低系统为 Android 10。允许本次下载来源安装后按系统提示完成；升级使用相同签名的同一产品安装包。Pro 与开源版的数据独立。

## 手机工作区

支持连接机器、终端、远端文件与按目标能力提供的桌面控制。触摸、拖动、滚轮和文本输入采用手机交互。桌面多显示器视图和完整桌面插件运行时不直接复制到手机。

## 手机作为被控端

Android cagent 能力在 CShell 扩展中按需启用，需要系统录屏授权；输入控制依赖单独的无障碍授权。不能绕过锁屏或受保护画面。系统结束投影后需在手机重新授权。

## 本机文件与后台

本机目录通过系统选择器授权。厂商省电、Doze、锁屏或网络切换可能影响后台连接。模拟器检查不能覆盖全部手机；反馈时提供 Android 版本和机型。

[Android 被控端说明](https://github.com/Yeqi99/CShell/blob/main/docs/ANDROID-CAGENT.md)
`],
['developers','开发者接入路线','开发者',`# 将你的功能加入 CShell

先判断功能需要在哪一侧运行，再选择接入方式。CShell 使用 MIT 许可证；源码、目录和发行附件通过 GitHub 管理。

| 你要做什么 | 接入方式 | 是否运行第三方代码 |
| --- | --- | --- |
| 分享一组 Shell 命令候选 | 声明式扩展包 | 不运行脚本，仅填入候选 |
| 安装目标机器上的软件 | 应用配方 / 可信 Provider | 审阅计划后在目标执行 |
| 为智能体加入可授权的应用工具 | cagent 能力包与可信适配器 | 需要主程序实现适配器 |
| 新工作台视图、协议或复杂交互 | 仓库源码贡献 | 随客户端审查、构建和发布 |

## 第一份扩展

跟随[声明式扩展教程](plugin-authoring.html)，从 JSON 清单开始。你可以独立托管包与目录；加入官方目录需提交 Pull Request。当前 v1 不是下载任意 JavaScript 就能运行的插件系统。

## 应用与工具

[应用与能力包接入](app-authoring.html)说明配方、安装计划、适配器、工具 schema 和授权的关系。安装成功不能直接显示工具可用，还需要配置、版本及权限检查。

## 源码贡献流程

1. Fork [源码仓库](https://github.com/Yeqi99/CShell)，阅读仓库 AGENTS.md 与相关协议。
2. 在独立分支实现，复用现有设计组件、Provider 与授权边界。
3. 为实际行为补充验证：目标绑定、断开、撤权、取消与失败。
4. 提交 PR，写明功能入口、支持系统、权限、副作用和测试结果。
5. 审核合入并随版本发布后，才能把新的可信 Provider 标记为可用。

不要把密钥放在渲染进程、清单或示例中；不得用静态演示数据冒充机器实时能力。
`],
['plugin-authoring','制作第一份扩展','开发者',`# 制作第一份声明式扩展

目标：提供两个只读运维命令候选。此扩展不会自动连接机器或执行命令。

## 1. 编写清单

保存为 operations.json：

\`\`\`json
{
  "protocol": 1,
  "id": "example.operations",
  "version": "1.0.0",
  "name": "Operations",
  "description": "常用只读运维命令",
  "publisher": "Example",
  "provider": "snippets",
  "permissions": ["terminal.input"],
  "commands": [
    {"label": "查看监听端口", "text": "ss -tulnp"},
    {"label": "查看磁盘容量", "text": "df -h"}
  ]
}
\`\`\`

ID 使用自己的命名空间，不能占用 cshell.*。provider 只能是 snippets，权限只能声明 terminal.input。命令需要由用户确认执行，示例命令适用于具备相应工具的 Linux 目标。

## 2. 校验并生成目录

在仓库安装开发依赖后运行下列命令。将 YOUR_NAME / YOUR_REPO 替换成自己的仓库，并先准备不可变的版本标签。

\`\`\`sh
pnpm exec tsx scripts/package-plugin.ts operations.json https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/v1.0.0/operations.json catalog.json
\`\`\`

脚本使用 src/shared/plugins.ts 校验协议，再为原始 UTF-8 文件计算 SHA-256。输出文件必须尚不存在，以免误覆盖已发布目录。生成结构为 protocol + plugins 数组，每项包含完整 manifest、url 与 sha256。

## 3. 发布与安装

将原始包和生成的 catalog.json 提交到 GitHub。下载地址应使用固定版本标签的 HTTPS URL，不能依赖会随时变化的文件。修改包内容后重新生成摘要并发布新版本。

在 CShell 插件市场使用外部目录入口加载目录，检查来源后安装、启用。目录读取失败、重定向、超大响应、摘要不符或目录清单与包清单不一致都会被拒绝。

## 4. 验证行为

- 插件启用后显示候选；选中仅补全，不发送 Enter。
- 停用后不再贡献候选，不中断已有终端。
- 修改一个字节后旧摘要应被拒绝。
- 测试密码提示、断开和全屏程序，不向错误上下文填入内容。

## 5. 加入官方目录

通过 Pull Request 提交功能说明、固定下载地址、清单和验证结果。官方目录位于 marketplace/plugins.json，由 scripts/marketplace.ts 生成。官方内置 Provider 不能被第三方清单借用。

[完整插件协议](https://github.com/Yeqi99/CShell/blob/main/docs/PLUGINS.md) · [校验脚本](https://github.com/Yeqi99/CShell/blob/main/scripts/package-plugin.ts)
`],
['app-authoring','应用配方与能力包','开发者',`# 应用配方与 cagent 能力包

## 选择正确层级

**应用配方**负责在明确的目标机器检查和安装系统软件。**能力包**将已经安装、配置并核验的软件包装成工具。两者都不是任意远程脚本上传入口。

## 添加应用配方

CShell 的 SSH 应用安装实现位于 src/core/applications.ts；cagent 对应 src/agent/applications.ts。先从已有配方了解目录、检测、计划与执行流程，再在源码中加入自己的受信任配方并提交 PR。

1. 约束平台、架构与包管理器；列出真实依赖与版本。
2. 实现只读检查；检测阶段不能安装软件。
3. 生成绑定真实连接的有限期计划，展示命令、目录、权限与网络影响。
4. 用户确认后，通过独立受管进程或连接执行；不向正在使用的终端注入命令。
5. 实现输出、退出码、取消和断开反馈，不自动 sudo、改软件源或覆盖环境。

测试至少覆盖缺少依赖、已有安装、权限不足、取消、断线和重复计划。不能把包管理器进程退出当作所有工具能力已可用。

## 能力包的文件与契约

| 源码 | 作用 |
| --- | --- |
| src/shared/agent-capability-packages.ts | 清单、平台、版本、权限、工具与事件契约 |
| src/agent/capability-packages.ts | 生命周期及可信主机接口 |
| src/agent/capability-catalog.ts | 可信目录 |
| src/agent/capability-installer.ts | 获取、暂存与文件核验 |
| src/agent/capability-runtime.ts | Vault、适配器与工具注册 |

清单包含包 ID、版本、平台/架构、cagent 版本区间、GitHub release 来源、文件大小与 SHA-256、adapterId、权限，以及工具输入/输出 object schema。以协议源码为准，不添加未知字段。

## 实现可信适配器

adapterId 必须对应主程序已实现的适配器；只写一个清单不能运行新代码。实现 register、invoke、quiesce、stop、unregister，管理真实资源与取消信号。新适配器随主程序审查构建，而不是在渲染进程动态加载第三方 JS。

只有文件、平台、版本、配置、授权和注册全部通过，状态才能为 available。未知适配器是 incompatible；安装不授予权限。升级仅保留旧权限与新清单的交集，新增权限需明确授权。

## 验证与提交

覆盖路径穿越、摘要变化、未知适配器、撤权、重启恢复及停止失败。卸载包不能误删用户系统软件和资料。PR 附上支持平台、工具副作用、实机结果和尚未验证的范围。

[能力包完整规范](https://github.com/Yeqi99/CShell/blob/main/docs/CAGENT-CAPABILITY-PACKAGES.md) · [应用安装协议](https://github.com/Yeqi99/CShell/blob/main/docs/AGENT-APPLICATIONS.md)
`],
['releases','版本与验证状态','入门',`# 版本与验证状态

## Pro 当前下载

官网目前提供 0.8.1 测试版 Windows x64 安装程序与签名 Android APK。下载包包含基础账号与云同步体验；不能将正在开发的新权益视为当前包已经交付。

macOS、Linux 的 Pro 安装包尚未发布。开源版各平台通过 [GitHub Releases](https://github.com/Yeqi99/CShell/releases) 获取实际已上传附件。构建通过、附件上传、签名/公证和真机验证是不同状态。

## 新版开发中

扩展设置与浏览器数据同步、共享基座、账号习惯记忆、同账号机器中继接入、应用网络代理与官方模型正在开发或联调。官网发布说明会随实际验证结果更新。

## 校验下载

官网下载的 Pro 包可使用 [SHA-256 清单](/downloads/SHA256SUMS.txt) 核验。Windows 可运行 Get-FileHash；Linux 使用 sha256sum；macOS 使用 shasum -a 256。摘要确认文件一致性，不等同于发行者数字签名。

## 反馈问题

在 [GitHub Issues](https://github.com/Yeqi99/CShell/issues) 附上版本、系统、CPU 架构与最小复现步骤。日志需移除邮箱验证码、账号令牌、连接密码和模型密钥。
`]
];
const header=`<header><a class="brand" href="/"><img src="/icon.svg" alt="">CShell</a><nav aria-label="主导航"><a href="/#editions">产品版本</a><a href="/#download">下载</a><a href="/docs/start.html">文档</a><a href="${github}">GitHub ↗</a></nav></header>`;
const footer=`<footer><span>CShell / CanpShell · MIT 开源核心</span><div><a href="/docs/releases.html">版本状态</a><a href="${github}/issues">问题反馈 ↗</a><a href="/docs/developers.html">开发者</a></div></footer>`;
const shell=(title,body,description)=>`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · CShell</title><meta name="description" content="${description}"><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/theme.css"><script src="/site.js" defer></script></head><body>${header}${body}${footer}</body></html>`;
pages.push(
['http','HTTP 请求工作区','功能',`# HTTP 请求工作区

先在插件市场安装并启用 HTTP，随后在「新建连接」中选择「HTTP 请求」。它是保存请求的工作区，不是持续在线的机器会话。

## 发出第一个请求

1. 保存基础地址或填写完整 URL。
2. 选择方法，编辑参数、请求头和请求体。
3. 选择实际发送方：本机、已连接的 SSH 或具有 HTTP 权限的 cagent。
4. 发送后查看状态码、耗时、响应头与正文；需要时取消。
5. 保存请求供后续使用。载入历史只创建草稿，不会自动重新发送。

支持 GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS，以及 JSON、文本与 URL 编码表单。HTML 响应只显示文本，不执行页面脚本。发送方不可用时不会自动回退本机。

## 智能体调用

勾选请求进入工具列表后，仍需单独授权 HTTP 工作区和发送方机器。人工操作与智能体操作共用记录。敏感认证头保存在后端，请优先使用保存的请求，不在对话里粘贴密钥。

文件上传、自动 OAuth 与响应脚本不属于当前请求工作区能力。详细限制见 [HTTP 协议说明](https://github.com/Yeqi99/CShell/blob/main/docs/HTTP.md)。
`],
['settings','设置、视图与监控','功能',`# 设置、视图与监控

## 外观与布局

偏好设置按分类组织，支持持久化和命名方案。明暗主题在状态栏快速切换，终端色板、光标与选区同步变化。切换布局或主题不应丢失会话和编辑草稿。

外观方案不携带模型密钥、连接凭据、扩展安装状态或访问授权。导入喜欢的外观不会自动启用 MCP 或其他对外服务。

## 多区域视图

桌面视图可以组织受支持的终端、桌面和智能体会话。绑定已有会话与创建新会话的生命周期不同，关闭视图前核对所属任务。保存布局后才会在下次恢复；Windows 专属本机环境在其他系统应显示不可用原因。

## 监控

CPU、内存、磁盘等监控必须来自当前真实连接。百分比结合核心数、已用和总量查看；断开、失败和采集中不应将旧值当作实时值。

## 扩展专属配置

Docker Socket、Python 解释器、Conda 环境等从对应已启用扩展进入。安装、启用和操作授权是不同状态。当前 Android 不提供与桌面完全相同的视图和多显示器功能。

[监控与视图说明](https://github.com/Yeqi99/CShell/blob/main/docs/MONITOR-VIEWS.md)
`],
['automation','事件订阅与 MCP','功能',`# 事件订阅与 MCP

## 事件订阅

将一个实际可用的扩展事件来源绑定到普通智能体会话，保存提示词、筛选条件与运行预算。先完成来源的配置和权限检查，再开启监听；新规则需明确启用并保存。

规则启用、来源监听与发送权限分别生效。接收消息不等于允许回复，重启后规则仍在也不意味着监听已恢复。任务沿用会话实际模型、机器与授权；外部事件内容不可以扩大权限。

配置冷却时间、运行次数与请求预算，检查跳过、失败和停止记录。离线消息不承诺自动补齐。详情见 [事件订阅指南](https://github.com/Yeqi99/CShell/blob/main/docs/AI-EVENTS.md)。

## MCP 连接

MCP 默认关闭。在 AI 与安全设置中选择明确允许的保存连接，为客户端配置访问令牌与能力范围，然后启用并保存。只有状态显示运行成功后才配置外部 MCP 客户端。

服务使用本机 Streamable HTTP，地址示例为 http://127.0.0.1:3777/mcp，请使用实际配置的端口。客户端通过 Authorization: Bearer 访问令牌认证；不要共享含令牌的配置文件。

先在 CShell 中连接目标、确认身份并保存凭据。MCP 只能使用已授权的连接，不能通过传入任意地址扩大范围。执行命令需对应授权；更换令牌会撤销旧访问。

[MCP 接入配置](https://github.com/Yeqi99/CShell/blob/main/docs/MCP.md) · [API 开发说明](https://github.com/Yeqi99/CShell/blob/main/docs/API.md)
`],
['cagent','安装与使用 cagent','入门',`# 安装与使用 cagent

cagent（Canp Agent）是独立运行的机器智能体，同时作为 CShell 的机器连接端和可授权委派的子智能体。它不依赖完整 CShell、Electron 或捆绑 Chromium。

## 获取与安装

从 [GitHub Releases](https://github.com/Yeqi99/CShell/releases) 选择目标系统和架构对应的 cagent 附件，按附件安装说明操作。程序、私有运行时和缓存放入选定专用目录；升级时保留身份、加密凭据和既有授权。

Windows 使用原生配置窗口，macOS/Linux 使用系统浏览器配置界面。Android 被控能力在 CShell 扩展内按需启用，不需要假设存在另一个独立桌面版 cagent 安装器。

## 连接到机器

在目标 cagent 配置连接地址、端口、密码与权限。复制连接信息后，在 CShell 新建连接中显式粘贴；复制内容不包含密码或私钥。首次核对目标身份后再认证。

机器连接建立后，按需进入终端、文件、应用、智能体或设置。只开放实际支持和需要的能力；已有明确关闭的权限不应被更新或同步重新打开。

## 模型与账号

独立智能体可自行配置基座。Pro 的 cagent 账号、共享基座与免公网 IP 接入正在新版联调，当前官网下载包不代表这些能力已经全部发布。相关状态见[账号与会员](cloud.html)。

## 应用能力

系统软件、配套工具包、配置与授权分别核验。未完成版本适配的微信、Clash 等不能因为已安装就显示为可调用。开发者可查看[能力包接入](app-authoring.html)。

[cagent 项目说明](https://github.com/Yeqi99/CShell/blob/main/docs/CAGENT.md)
`]
);
pages.sort((a,b)=>['入门','功能','平台','开发者'].indexOf(a[2])-['入门','功能','平台','开发者'].indexOf(b[2]));
await fs.mkdir(path.join(root,'docs'),{recursive:true});
for(const [id,title,group,body] of pages){let last='';const nav=pages.map(([key,label,g])=>{const heading=g!==last?`<div class="nav-group">${g}</div>`:'';last=g;return heading+`<a class="doc-link" href="/docs/${key}.html" ${key===id?'aria-current="page"':''}>${label}</a>`}).join('');const content=renderToStaticMarkup(React.createElement(Markdown,{remarkPlugins:[remarkGfm]},body));await fs.writeFile(path.join(root,'docs',id+'.html'),shell(title,`<main class="docs-layout"><aside class="docs-nav" aria-label="文档导航"><label for="doc-search" class="eyebrow">文档中心</label><input id="doc-search" type="search" placeholder="搜索文档标题" autocomplete="off"><p id="search-empty" hidden>没有匹配的标题。</p>${nav}</aside><article class="doc-content"><div class="doc-topline">文档 / ${group} · 2026-10-22</div>${content}<div class="doc-bottom"><a href="/docs/start.html">← 文档首页</a> · <a href="${github}/issues">反馈文档问题 ↗</a></div></article></main>`,title+'：CShell 与 cagent 使用和开发说明。'));}
const icons={windows:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',macos:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',linux:'<rect x="2" y="3" width="20" height="18" rx="3"/><path d="m6 8 4 4-4 4m7 0h5"/>',android:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>'};
const tabs=Object.entries(icons).map(([id,svg],i)=>`<button id="tab-${id}" role="tab" aria-selected="${i===0}" aria-controls="device-panel" tabindex="${i===0?0:-1}" data-system="${id}"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>${{windows:'Windows',macos:'macOS',linux:'Linux',android:'Android'}[id]}</button>`).join('');
const rows=[['终端、文件、机器工作区','支持','支持','支持'],['自定义模型与扩展','支持','支持','支持'],['基础账号云同步','本机保存','自动同步','自动同步'],['云端配置空间','—','2 MiB','64 MiB'],['开源获取方式','GitHub · MIT','共享开源核心','共享开源核心'],['扩展偏好 / 浏览器记录同步','本机保存','新版联调中','新版联调中'],['账号习惯记忆 / 共享基座','分别配置','新版联调中','新版联调中'],['官方自建模型','使用自有基座','接入联调中','接入联调中'],['同账号机器免公网 IP 接入','自行配置','自行配置','会员内测 · 联调中'],['应用网络代理 / 出口选择','自行配置','—','会员内测 · 联调中']].map(r=>`<tr><th scope="row">${r[0]}</th>${r.slice(1).map(c=>`<td>${c}</td>`).join('')}</tr>`).join('');
await fs.copyFile('assets/brand/cagent.svg',path.join(root,'cagent.svg'));
await fs.writeFile(path.join(root,'index.html'),shell('机器、终端与智能体工作台',`<main>
<section class="hero"><div><span class="eyebrow">CSHELL / YOUR CONNECTED WORKSPACE</span><h1>机器在远方，<br>工作在手边。</h1><p>连接服务器，管理文件，与智能体协作。<br>从桌面到手机，找到适合你的工作方式。</p><div class="actions"><a class="primary" href="#download">选择设备，下载 ↓</a><a class="secondary" href="/docs/start.html">开始使用 ↗</a></div><small>开源核心 · Windows / macOS / Linux / Android</small></div><div class="product-art" aria-label="工作区能力示意"><div class="mini-window"><div class="art-bar"><img src="/icon.svg" alt="">CShell<span>WORKSPACE</span></div><div class="mini-body"><aside><b>工作台</b><span>连接</span><span>文件</span><span>智能体</span><span>扩展</span></aside><article><span class="eyebrow">我的工作空间</span><h3>每台机器，各就其位。</h3><div class="machine"><i></i>开发环境<small>SSH</small></div><div class="machine"><i></i>远程工作站<small>cagent</small></div><div class="machine"><i></i>本机终端<small>LOCAL</small></div></article></div></div><div class="art-caption"><span>连接 · 终端 · 文件 · 智能体</span><span>能力示意</span></div></div></section>
<div class="feature-strip"><div><b>一台机器，一个工作区</b><p>终端、文件、浏览器与应用围绕当前连接展开。</p></div><div><b>账号延续你的配置</b><p>Pro 将连接、基座与支持的个人设置加密同步。</p></div><div><b>需要什么，再加入什么</b><p>扩展增强工作台，应用安装到明确选定的机器。</p></div></div>
<section id="download" class="section"><div class="section-head"><div><span class="eyebrow">DOWNLOAD CENTER</span><h2>为你的设备，选择合适的版本。</h2></div><p>Pro 安装包在本站下载。<br>开源版与 cagent 统一从 GitHub 获取。</p></div><div class="download-shell"><div class="device-tabs" role="tablist" aria-label="选择设备系统">${tabs}</div><div id="device-panel" class="device-panel" role="tabpanel" aria-labelledby="tab-windows"><div><span class="status" data-field="status">0.8.1 · 测试版</span><h3 data-field="name">Windows</h3><div class="device-meta"><span data-field="arch">x64 · Windows 10 / 11</span><span data-field="format">EXE 安装程序</span></div><p data-field="text">独立安装 CShell Pro，登录后同步连接、模型和设置。</p></div><div class="download-action"><a class="primary" data-field="download" href="/downloads/CShell-Pro-0.8.1-windows-x64.exe?build=20261022-account3">下载 Windows Pro</a><a data-field="guide" href="/docs/windows.html">安装与平台说明 →</a></div></div></div><div class="download-foot"><a href="${github}/releases">所有系统的开源版与 cagent · GitHub Releases ↗</a><a href="/downloads/SHA256SUMS.txt">Pro 文件校验值 ↗</a></div><noscript><p><a href="/downloads/CShell-Pro-0.8.1-android.apk?build=20261022-account3">Android Pro 下载</a> · <a href="${github}/releases">macOS / Linux 开源版下载</a></p></noscript></section>
<section id="editions" class="section"><div class="section-head"><div><span class="eyebrow">FIND YOUR EDITION</span><h2>同一个核心，三种选择。</h2></div><p>先从自己的工作方式出发。<br>会员当前为内测，尚未开放购买。</p></div><div class="edition-cards"><article class="edition-card"><span class="eyebrow">OPEN SOURCE</span><h3>CShell 开源版</h3><p>本地使用，自行配置连接和基座。适合希望掌握源码、独立部署与开发扩展的用户。</p><a href="${github}/releases">前往 GitHub 下载 ↗</a></article><article class="edition-card"><span class="eyebrow">PRO / FREE</span><h3>Pro 免费版</h3><p>保留工作台核心，增加邮箱账号和云同步。在不同设备上恢复支持的连接与配置。</p><a href="#download">下载 Pro，免费开始 →</a></article><article class="edition-card premium"><span class="eyebrow">PRO / MEMBERSHIP</span><h3>Pro 会员版</h3><p>扩大云端配置空间。免公网 IP 机器接入与应用网络代理正在联调，完成后随新版交付。</p><a href="/docs/cloud.html">了解内测权益 →</a></article></div><div class="comparison-scroll" tabindex="0" aria-label="版本对比，可横向滚动"><table><thead><tr><th scope="col">功能与权益</th><th scope="col">开源版</th><th scope="col">Pro 免费版</th><th scope="col">Pro 会员版</th></tr></thead><tbody>${rows}</tbody></table></div><p class="fineprint">配置空间不是网盘容量；远端文件、Cookie、缓存和设备授权不属于通用配置同步。联调中的功能不代表当前下载包已包含。<a href="/docs/releases.html">查看版本状态 →</a></p></section>
<section id="documentation" class="section"><div class="section-head"><div><span class="eyebrow">LEARN & BUILD</span><h2>从第一次连接，到自己的扩展。</h2></div><p>面向使用者和开发者的项目文档。<br>平台差异、功能边界与接入步骤都在这里。</p></div><div class="docs-cards">${[['01 / GET STARTED','开始使用','选择产品，安装客户端，连接第一台机器。','start'],['02 / WORKSPACE','功能指南','终端、文件、桌面、浏览器与智能体。','connections'],['03 / EXTENSIONS','扩展与应用','理解安装、配置、版本核验和权限。','extensions'],['04 / DEVELOPERS','加入你的功能','从 JSON 命令包到可信应用适配器。','developers']].map(([n,t,d,id])=>`<a class="docs-card" href="/docs/${id}.html"><span>${n}</span><h3>${t} ↗</h3><p>${d}</p></a>`).join('')}</div></section>
<section class="cagent-section"><img src="/cagent.svg" alt="cagent"><div><h3>认识 cagent</h3><p>独立、精简的机器智能体。既可独立运行，也可作为 CShell 的连接端与被授权的子智能体。</p></div><a class="secondary" href="${github}/releases">获取 cagent ↗</a></section></main>`,'CShell 官网：版本介绍、按设备下载、跨平台使用文档，以及扩展与 cagent 应用开发指南。'));
console.log(`Built portal and ${pages.length} documentation pages`);
