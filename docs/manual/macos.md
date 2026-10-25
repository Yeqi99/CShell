# macOS

[在线阅读与全文搜索](https://shell.canp.ai/docs/macos.html)

<!-- Derived from services/portal/docs/macos.html; edit the portal source then export. -->




<h2 id="section-1">获取对应架构</h2>

<p>在 <a href="https://shell.canp.ai/downloads.html">香港下载中心</a> 查找开源版 macOS 附件：Apple Silicon 选择 arm64，Intel 选择 x64。以该次发行实际附件为准；不要下载 Windows 安装程序。</p>

<p>Pro 提供 Apple Silicon / Intel 实验版 DMG，可在官网下载区选择架构。CI 构建与协议测试已通过，但未完成实体设备验收，也未做 Apple 公证。</p>



<h2 id="section-2">功能范围</h2>

<p>桌面端共用连接、终端、文件、智能体与扩展核心。Windows 专属 CMD、PowerShell 和 WSL 入口不适用。CAgent 的被控桌面采集能力不与 Windows 自动等同。</p>

<p>应用安装按目标真实 Homebrew 环境检查；没有包管理器时不会静默安装或改变系统环境。</p>



<h2 id="section-3">问题反馈</h2>

<p>请提供 macOS 版本、CPU 架构、下载版本和可复现步骤，移除日志中的密钥。不要通过关闭系统安全机制解决来源不明的软件包问题。</p>


<h2 id="app-updates">应用内更新</h2>
<p>更新入口、各平台安装方式与旧版升级说明见<a href="https://shell.canp.ai/docs/releases.html#one-click-update">一键更新指南</a>。更新使用香港源，保留当前产品渠道与账号数据；安装前先保存工作。</p>
