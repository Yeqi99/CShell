# Windows

[在线阅读与全文搜索](https://shell.canp.ai/docs/windows.html)

<!-- Derived from services/portal/docs/windows.html; edit the portal source then export. -->




<h2 id="section-1">安装</h2>

<p><a href="https://shell.canp.ai/#download">官网下载 Pro</a>，开源版前往 <a href="https://shell.canp.ai/downloads.html">香港下载中心</a>。当前 Pro 提供 Windows x64 测试安装程序，可与开源版独立安装。升级前保存重要编辑内容。</p>



<h2 id="section-2">本机与远端</h2>

<p>Windows 本机终端支持 CMD / PowerShell。WSL 通过扩展使用检测到的真实发行版；Windows 主机与 WSL 是不同环境。修改 WSL 网络配置不应自动重启正在运行的发行版。</p>

<p>远程目标可使用 SSH 或 CAgent。Windows CAgent 使用独立运行时，不要求安装完整 CShell。安装程序、缓存与私有依赖应放在选择的专用目录，保留已有身份和授权。</p>



<h2 id="section-3">已知边界</h2>

<p>Windows 锁屏、UAC、无显示器与多显示器行为依赖原生能力和环境。软件包存在不等同于可信签名；按发行校验值核验下载，遇到身份变化先检查来源。</p>

<p><a href="https://github.com/Yeqi99/CShell/blob/main/docs/WINDOWS-RELEASE-TRUST.md">Windows 发行与信任说明</a></p>

