# 0.8.6 · 版本与验证状态

[在线阅读与全文搜索](https://shell.canp.ai/docs/releases.html)

<!-- Derived from services/portal/docs/releases.html; edit the portal source then export. -->




<h2 id="release-086">0.8.6 · 文档与可靠性</h2>
<p>使用手册按任务整理，支持正文搜索、章节直达、移动目录与示例复制；官网重新设计。CAgent 改善退出清理和启动期间关闭的处理。OpenCode 入口自动刷新模型目录，保留已有会话的选择；服务商拒绝的免费模型仍不能保证可用。Pro 修复旧配置导入时读取 OpenCode 扩展凭据的位置。</p>


<h2 id="section-1">0.8.5 · 升级与退出</h2>
<p>开源版与 Pro 同步修复三项问题：智能体任务运行时退出会提示，取消退出保留任务；CAgent 的 Windows 文件版本与发行版本一致；静默升级刷新已有快捷方式的图标，不重建已删除入口，也不修改其他安装的快捷方式。</p>


<h2 id="section-2">0.8.4 · 统一机器工作区</h2>
<p>开源版与 Pro 同步提供离线可打开的机器桌面、批量连接导入、机器信息、延迟测试、字体与侧栏定制、分组内拖动、终端快捷键和辅助配色。智能体会话独立运行，切换保留草稿，历史可恢复。</p>



<h2 id="section-3">Pro 账号与网络</h2>
<p>登录后自动同步账号配置；开源版和未登录数据先预览，再由你选择载入。新增权限配置恢复、未登录缓存清理、共享基座与习惯记忆。同账号 CAgent 自动发现，会员可使用免公网 IP 连接和应用机器出口。受控端权限仍由目标机器授权。</p>



<h2 id="section-4">浏览器与终端修复</h2>
<p>同一机器的多个工作区复用本机浏览器标签，失效占用自动释放；手机和电脑的本地浏览器互不占用。断线不回退本机网络，浏览器可重试；终端断线历史和独立小窗会话保留。</p>



<h2 id="section-5">平台验证</h2>
<p>Windows x64 已完成实际安装包启动、SSH、终端与文件流程验证；Android 提供签名 APK，并完成 Android 29/35 模拟器原生测试。macOS 与 Linux 提供已构建的 ARM64 / x64 包；实体设备和不同发行版仍需验证。macOS 未做 Apple 公证，Windows 安装器未做发行者代码签名。</p>



<h2 id="section-6">下载与校验</h2>
<p>在 <a href="https://shell.canp.ai/downloads.html">下载中心</a> 选择产品、系统与架构。使用 <a href="https://shell.canp.ai/downloads/pro/v0.8.6/SHA256SUMS.txt">Pro 摘要清单</a> 或 <a href="https://shell.canp.ai/downloads/opensource/v0.8.6/SHA256SUMS.txt">开源版摘要清单</a> 校验安装包。移动端安装仍需系统确认；不支持新更新源的旧客户端需首次手动升级。</p>



<h2 id="section-7">反馈问题</h2>
<p>向 <a href="https://github.com/Yeqi99/CShell/issues">GitHub Issues</a> 提供版本、系统、CPU 架构和复现步骤，请勿附带密码、令牌或模型密钥。</p>



<h2 id="install-flow">安装、升级与保留数据</h2>
<ol><li>在下载页选择开源版、Pro 或 CAgent，再选系统和处理器架构。会员与免费 Pro 使用同一客户端。</li><li>开源版前往 GitHub Release；Pro 和 CAgent 可使用香港下载源。核对包名、版本和 SHA-256 摘要。</li><li>升级前处理正在运行的任务，按对应安装程序执行。保留原安装路径与数据，不用另一版本覆盖当前渠道。</li><li>重新打开后核对关于页版本、账号、连接与模型。没有更新不等于安装失败，也可能是当前已为该渠道最新版。</li></ol><p>Windows 包未签名，macOS 包未签名 / 公证；macOS 与 Linux 仍有实机验证限制。Android 需要系统安装确认，不能声称所有设备已静默升级。</p>


<h2 id="remove">卸载与重装</h2>
<p>卸载客户端程序与删除用户数据是两件事。若希望重装后保留连接和身份，先确认安装器的数据选项并备份；不要手工删除 CAgent 身份目录或跨设备复制私钥来“恢复”。</p>
<p>清除 Pro 未登录缓存使用账号页专用入口，不把卸载程序作为清理云账号的方法。云端数据、远端文件和服务器上已安装的软件不会因卸载本机客户端自动消失。</p>

