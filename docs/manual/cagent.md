# 安装与使用 CAgent

[在线阅读与全文搜索](https://shell.canp.ai/docs/cagent.html)

<!-- Derived from services/portal/docs/cagent.html; edit the portal source then export. -->


<p>CAgent（Canp Agent）是独立运行的机器智能体，同时作为 CShell 的机器连接端和可授权委派的子智能体。它不依赖完整 CShell、Electron 或捆绑 Chromium。</p>



<h2 id="section-1">获取与安装</h2>

<p>从 <a href="https://shell.canp.ai/downloads.html">香港下载中心</a> 选择目标系统和架构对应的 CAgent 附件，按附件安装说明操作。程序、私有运行时和缓存放入选定专用目录；升级时保留身份、加密凭据和既有授权。</p>

<p>Windows 使用原生配置窗口，macOS/Linux 使用系统浏览器配置界面。Android 被控能力在 CShell 扩展内按需启用，不需要假设存在另一个独立桌面版 CAgent 安装器。</p>



<h2 id="linux-command">Linux 快速安装</h2>
<pre><code>curl -fsSL https://shell.canp.ai/install.sh | sh -s -- cagent</code></pre><p>账号版追加 <code>--channel pro</code>。自动匹配 x64 / ARM64，校验香港发行附件，不修改系统软件源、全局 PATH、监听端口和权限。安装完成后按打印的命令启动 CAgent 配置界面；新安装数据位于专用目录，已有身份和配置保持原路径。需要 Python 3.9+、curl。<a href="https://shell.canp.ai/docs/linux.html#command-install">数据盘安装、预检和更新说明</a> · <a href="https://shell.canp.ai/downloads.html?product=cagent&amp;system=linux">下载安装包</a></p>


<h2 id="section-2">连接到机器</h2>

<p>在目标 CAgent 配置连接地址、端口、密码与权限。复制连接信息后，在 CShell 新建连接中显式粘贴；复制内容不包含密码或私钥。首次核对目标身份后再认证。</p>

<p>机器连接建立后，按需进入终端、文件、应用、智能体或设置。只开放实际支持和需要的能力；已有明确关闭的权限不应被更新或同步重新打开。</p>



<h2 id="section-3">模型与账号</h2>

<p>独立智能体可自行配置基座，也可登录 Pro 账号共享支持的基座配置。登录后出现 Pro 身份标识，同账号 CShell 自动发现设备；会员可通过中继接入在线机器，无需公网 IP，仍核验身份与权限。登录标识不代表付费状态，详见<a href="https://shell.canp.ai/docs/cloud.html">账号与会员</a>。</p>



<h2 id="section-4">应用能力</h2>

<p>系统软件、配套工具包、配置与授权分别核验。未完成版本适配的微信、Clash 等不能因为已安装就显示为可调用。开发者可查看<a href="https://shell.canp.ai/docs/app-authoring.html">能力包接入</a>。</p>

<p><a href="https://github.com/Yeqi99/CShell/blob/main/docs/CAGENT.md">CAgent 项目说明</a></p>


<h2 id="app-updates">应用内更新</h2>
<p>更新入口、各平台安装方式与旧版升级说明见<a href="https://shell.canp.ai/docs/releases.html#one-click-update">一键更新指南</a>。更新使用香港源，保留当前产品渠道与账号数据；安装前先保存工作。</p>


<h2 id="safe-updates">自动更新何时执行</h2>
<p>支持安全更新协议的 CAgent 会先检查真实版本、目标架构和附件摘要，把新程序放入独立版本目录。终端、管理调用、浏览器连接、远控和后台任务仍在运行时等待，不为更新强行打断会话。新进程完成版本与设备身份核验后才确认切换，原数据和权限保留。</p>
<p>更新失败保留可恢复版本；同一个失败版本自动冷却 6 小时，避免反复尝试。用户可显式重试，新版本也可重新检查。结果未知时先核对状态，不盲目重放安装或回滚。旧版不支持该协议时不能保证无中断自动切换，按界面更新入口或安装指南完成一次升级。</p>


<h2 id="rdp-install">Windows 只有 RDP 信息</h2>
<p>在 RDP 可视化工作区打开「安装 CAgent」，查看 Windows 安装步骤并下载已发布附件。在远程桌面中运行安装器，保留系统必需确认，然后复制不含密码的 CAgent 连接信息回到 CShell 添加连接。RDP 凭据本身不等于远程命令执行权限，因此该入口不会要求你选择 SSH，也不绕过 UAC。</p>

<h2 id="headless-windows-session">没有显示器的 Windows 机器</h2>
<p>在这台机器的 CAgent 工作区打开「远程控制」，选择「打开 Windows 会话」，再选中这台机器已保存的 RDP 连接。如果出现「核验并打开」，点击后即可在 CShell 内操作 Windows 桌面。目标机器可以不接显示器，也无需事先打开系统远程桌面窗口。请确认 Windows 已开启远程桌面，所选地址和端口可达，并使用有权远程登录的 Windows 账号。CAgent 的设备密码和 Windows 登录密码分别管理。</p>
<h2 id="wechat-contacts">查看目标机器的微信通讯录</h2>
<p>在运行微信的机器上安装「微信工具」，启用通讯录读取。从 CShell 连接这台 CAgent 后，可以直接告诉智能体「列出这台机器的前 20 条微信联系人」或「在德威云的通讯录里查西红柿」。可以按昵称、备注、微信号或内部 ID 查询。多人同名时，先用备注或微信号区分，再指定收件人。</p>
<p>要接着浏览，说「继续看下一页」。刚给机器安装工具时，可以让智能体刷新当前连接的工具列表。查看最近聊天和浏览通讯录是两个独立操作，分别需要对应的读取权限。</p>
<h2 id="wechat-listener-reconnect">微信重启后的消息订阅</h2>
<p>在运行微信的 Windows 机器安装「微信工具」，设置要监听的账号和会话，再启用事件订阅。监听过程中退出微信会产生消息空档，恢复后接收新消息。自动化规则可以按会话筛选入站消息；微信离线期间的历史记录不会作为新事件重放。</p>
