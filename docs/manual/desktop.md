# 机器桌面与浏览器

[在线阅读与全文搜索](https://shell.canp.ai/docs/desktop.html)

<!-- Derived from services/portal/docs/desktop.html; edit the portal source then export. -->


<p>CAgent 连接面向整台机器。进入机器工作区后，按需打开终端、浏览器、文件、应用和智能体，而不是必须先选择一个 Shell。</p>



<h2 id="section-1">浏览器的网络归属</h2>

<p>CShell 在本机渲染浏览器，通过所选机器的网络出口请求网页。它不是远端浏览器截图。缓存和 Cookie 按机器隔离保存在本机；网络断开时不悄悄退回本机出口。</p>

<p>历史、收藏和标签与网站 Cookie 不同。Pro 同步支持的浏览器记录；Cookie 和网站登录状态保留在本机，不随通用配置同步。手机与桌面显示方式也不同，见<a href="https://shell.canp.ai/docs/android.html">Android 说明</a>。</p>



<h2 id="section-2">远程控制</h2>

<p>远程桌面依赖目标系统实际提供的采集、输入和权限。Windows、Android 被控能力不等同于 macOS/Linux。Android 需要系统录屏授权；锁屏、后台限制及厂商系统可能终止投影。</p>



<h2 id="section-3">原生应用</h2>

<p>应用文件夹只应列出目标机器已适配的可启动应用。Linux 原生图形应用使用独立兼容入口，不把普通浏览器冒充完整 Linux 桌面。QQ、微信等能力须逐项满足版本、依赖和权限条件。</p>

<p>更多：<a href="https://github.com/Yeqi99/CShell/blob/main/docs/LINUX-VISUAL-WORKSPACE.md">Linux 可视化工作区</a>、<a href="https://github.com/Yeqi99/CShell/blob/main/docs/CAGENT-DESKTOP.md">桌面边界</a>。</p>


<h2 id="section-4">统一机器桌面</h2>
<p>SSH 连接提供终端、文件与安装 CAgent 入口；CAgent 显示真实已安装的能力。RDP 连接进入桌面后再打开远程桌面应用，只有 RDP 凭据无法自动执行安装：需另外具备 SSH 等管理通道，或在目标机器手动安装。</p>


<h2 id="section-5">机器信息</h2>
<p>CAgent 桌面的“机器信息”提供概览、CPU、内存、磁盘、GPU 和网络。图表来自当前机器的采样；系统不提供温度或显存等信息时明确显示未提供。大文件扫描需要选择路径并显式开始，设有扫描上限并可取消。</p>


<h2 id="windows">窗口、任务栏与离线状态</h2>
<p>双击连接即可进入机器桌面，离线也可打开。右下角显示真实连接状态，点击可重试。桌面可打开不代表终端、文件或远控已连接；能力就绪后才可使用。</p>
<p>应用窗口可最小化并从机器任务栏恢复。切换工作区保留已打开任务和草稿。关闭浏览器、关闭远控窗口与关闭整台机器工作区是不同操作，操作前核对所属窗口。</p>


<h2 id="browser-steps">用目标机器浏览网页</h2>
<ol><li>进入目标机器桌面，打开「浏览器」，确认地址栏附近显示正确机器。</li><li>输入网址，按需新建标签；使用后退、前进、刷新、缩放、历史和收藏入口。</li><li>网络错误时查看当前机器连接状态和诊断，不自动改用本机网络。</li><li>同一机器已有浏览器窗口时优先恢复已有窗口；遇到不存在的占用见<a href="https://shell.canp.ai/docs/troubleshooting.html#browser">占用排查</a>。</li></ol><p>普通网页由本地客户端渲染；这里不是远端系统完整桌面。网站登录状态按机器隔离，切换机器不共享 Cookie。</p>


<h2 id="control">观看与控制远程桌面</h2>
<p>在机器桌面打开远程控制应用。先确认画面来自目标机器，再选择可用的画质与缩放。观看和输入控制分别受权限约束，能看到画面不代表能发送键鼠。</p>
<p>最小化后可从任务栏恢复。延迟同时受采集、编码、网络与显示影响，TCP 延迟不能直接代表操作延迟。断线后确认重新连接状态，不能把最后一帧当作当前画面。Android 录屏和系统控制必须保留系统授权流程。</p>

