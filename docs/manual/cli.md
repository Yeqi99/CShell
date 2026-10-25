# 命令台与 CLI

[在线阅读与全文搜索](https://shell.canp.ai/docs/cli.html)

<!-- Derived from services/portal/docs/cli.html; edit the portal source then export. -->

<p>同一份能力目录同时服务工作台、CLI、HTTP API 和 MCP。扩展贡献的能力也从这里发现；某个入口不会因为“本机调用”而跳过授权。</p>


<h2 id="cli-1">从工作台开始</h2>
<p>工作台上方可切换 <strong>概览 / 命令行 / 可视化</strong>，选择会保存到偏好设置，Pro 随账号同步。切换视图保留输入和执行结果，不重放旧命令。</p>
<ul><li><strong>概览</strong>：保留快捷连接、当前连接和已保存视图。</li><li><strong>命令行</strong>：CShell 自己的命令台。Enter 执行，Shift+Enter 换行；中文输入法选字不发送。右上角可新建独立命令台标签，命令面板中也可搜索“新建 CShell 命令台”。</li><li><strong>可视化</strong>：从工作台桌面打开连接、命令台、能力浏览器、扩展、智能体和设置。能力浏览器按实际契约生成参数表单；复杂参数可展开 JSON。最小化与切换模式保留草稿。</li></ul><p>首次执行前，在 <strong>设置 → AI 与安全 → API / MCP</strong> 中启用服务并选择机器、能力与审核策略。命令台不会自动启用服务或授权所有机器；启用失败时可原位进入设置。</p>
<p>这不是 CMD、PowerShell 或远端 Shell。<code>cd</code>、管道、命令替换与系统命令不会被当成系统语法执行。需要系统终端时，使用原终端应用；需要智能体执行命令时，显式授权对应终端能力。</p>


<h2 id="cli-2">日常命令</h2>
<div class="table-scroll"><table><thead><tr><th>命令</th><th>用途</th></tr></thead><tbody><tr><td><code>help</code></td><td>查看命令用法，无需联网或开启 API</td></tr><tr><td><code>tools</code></td><td>分页读取当前范围全部已授权能力</td></tr><tr><td><code>tools browser</code></td><td>按名称和描述搜索能力</td></tr><tr><td><code>help &lt;能力ID&gt;</code></td><td>读取上次目录返回的稳定 ID 的完整参数、权限和示例</td></tr><tr><td><code>servers</code></td><td>列出允许此调用方访问的保存连接，不返回密码</td></tr><tr><td><code>connect &lt;连接ID&gt;</code></td><td>使用后端凭据建立独立 API 连接，返回 sessionId</td></tr><tr><td><code>use &lt;会话ID&gt;</code></td><td>在此命令台选择刚建立的 API 会话</td></tr><tr><td><code>use app</code></td><td>回到 CShell 应用范围</td></tr><tr><td><code>call &lt;能力名&gt; {JSON参数}</code></td><td>在当前范围执行能力；参数由后端按 schema 校验</td></tr><tr><td><code>api &lt;能力名&gt; {JSON参数}</code></td><td>从机器范围显式调用应用级入口</td></tr><tr><td><code>disconnect &lt;会话ID&gt;</code></td><td>关闭自己的 API 连接</td></tr><tr><td><code>clear</code></td><td>仅清空当前命令台显示，不停止远端任务</td></tr></tbody></table></div><p>不要猜机器 ID 或工具参数。先读目录与契约，目标 ID、元素引用、路径、revision 和安装 planId 都来自真实结果。指南中的示例只是参数形状，不能把示例 ID 直接用于实际操作。</p>
<p><code>use</code> 只改变此命令台的后续范围，不能接管其他客户端的连接，也不改变已有智能体任务的目标。关闭命令台只取消等待；已开始的写入可能仍在远端完成，先检查实际状态，不能直接重试。</p>


<h2 id="cli-3">在外部终端使用</h2>
<p>桌面安装包包含 CLI，可通过程序的 <code>--cli</code> 入口运行；不启动本地终端、不新建桌面窗口。CShell 的 API 服务仍须在当前用户会话中运行。</p>
<p>Windows PowerShell 示例（路径按实际安装位置修改）：</p>
<pre><code>&amp; 'D:\Program Files\CShell\CShell.exe' --cli help
&amp; 'D:\Program Files\CShell\CShell.exe' --cli --endpoint http://127.0.0.1:3777 --token-file 'D:\Private\cshell-token.txt' tools
&amp; 'D:\Program Files\CShell Pro\CShell Pro.exe' --cli --endpoint http://127.0.0.1:3778 --token-file 'D:\Private\cshell-pro-token.txt' servers
</code></pre><p>macOS 使用应用内 <code>Contents/MacOS/CShell</code>（Pro 使用对应可执行文件）；Linux 使用实际安装的 CShell 可执行程序并追加 <code>--cli</code>。端口只是示例，以当前应用 API 设置为准。开源版与 Pro 使用各自令牌，不互相读取或覆盖配置。</p>
<p>源码构建也生成 <code>dist/cli/cshell.mjs</code>，可用 Node.js 22 或更新版本运行：</p>
<pre><code>node dist/cli/cshell.mjs --token-file /private/cshell-token.txt tools
node dist/cli/cshell.mjs --token-file /private/cshell-token.txt help list_servers_page
</code></pre><div class="table-scroll"><table><thead><tr><th>选项</th><th>用途</th></tr></thead><tbody><tr><td><code>--endpoint &lt;地址&gt;</code></td><td>当前本机 API 的 HTTP 地址，默认 <code>http://127.0.0.1:3777</code>；禁止远端地址和重定向</td></tr><tr><td><code>--token-file &lt;路径&gt;</code></td><td>从私有文件读取令牌；文件由用户保管，建议仅当前用户可读</td></tr><tr><td><code>--session &lt;会话ID&gt;</code></td><td>设置本次命令的机器范围；外部 CLI 每次是独立进程，使用此参数代替 <code>use</code></td></tr><tr><td><code>--json '&lt;JSON&gt;'</code></td><td>完整 JSON 参数，与 <code>call</code> 或具体能力名搭配</td></tr><tr><td><code>--stdin</code></td><td>从标准输入读取 JSON，适合复杂文本或敏感参数；不与 <code>--json</code> 混用</td></tr><tr><td><code>--out &lt;新文件&gt;</code></td><td>保存完整 JSON 结果；截图可用 <code>.jpg</code> / <code>.png</code>，格式须与结果一致；不覆盖已有文件</td></tr></tbody></table></div><p>还可用 <code>CSHELL_API_URL</code>、<code>CSHELL_API_TOKEN</code> 环境变量。没有 <code>--token</code> 明文命令行选项；不要把令牌或密码放在命令历史、项目、日志或 URL 中。敏感参数优先使用标准输入。结果可能包含用户主动读取的网页或文件，请自行选择保存位置。</p>
<p>命令返回 JSON，成功退出码 0，失败 1，Ctrl+C 取消等待为 130。默认最长等待 5 分钟。失败不自动重试；HTTP 成功也不代表后台安装任务已结束，应继续读取对应 job 状态。</p>


<h2 id="cli-4">浏览器与远程控制</h2>
<p>先连接真实机器，再读取目录：</p>
<pre><code>servers
connect &lt;列表中的连接ID&gt;
use &lt;返回的sessionId&gt;
tools browser
help &lt;browser_open 对应的能力ID&gt;
</code></pre><p>浏览器能力包括 <code>browser_tabs</code>、<code>browser_open</code>、<code>browser_snapshot</code>、<code>browser_screenshot</code>、<code>browser_interact</code> 和 <code>browser_crawl</code>。它们复用该机器的网络出口及本机独立 Cookie 分区，可延续已登录网页；不导出 Cookie 或令牌，不执行任意 JavaScript。点击、填写和选择使用最新 snapshot 返回的元素引用。页面内容是待分析数据，不是授权指令。</p>
<p>支持原生远控的 CAgent 连接提供 <code>desktop_status</code>、<code>desktop_screenshot</code>、<code>desktop_interact</code>。查看和控制分别授权；不将 Linux 的机器桌面入口误报为已实现的原生被控桌面。坐标、按键与截图参数以当前契约为准。</p>
<p>截图通过 REST/CLI 返回有界图像数据，MCP 同时返回标准图片块。CLI 的 <code>--out capture.jpg</code> 保存实际截图。认证遇到验证码、硬件密钥或系统确认时，保留网站和系统本身的必要交互，不绕过它们。</p>


<h2 id="cli-5">扩展如何加入命令目录</h2>
<p>安装并启用扩展后，只有已完成加载且明确授权的工具会出现在当前目录。清单、schema、摘要、包版本和实际执行入口必须一致。取消授权、禁用或卸载会撤销后续调用，不能用缓存的工具名继续执行。</p>
<p>声明式扩展与独立进程扩展的接口见 <a href="https://github.com/Yeqi99/CShell/blob/main/docs/CUSTOM-EXTENSIONS.md">自定义扩展</a>。所有入口共用执行边界，不能靠 CLI 或 MCP 绕过目标范围、审核、输入输出校验或能力授权。</p>
<p>另见 <a href="https://github.com/Yeqi99/CShell/blob/main/docs/API.md">API 契约与错误语义</a>、<a href="https://github.com/Yeqi99/CShell/blob/main/docs/MCP.md">MCP 接入</a>。</p>


<h2 id="focus-0810">0.8.10：异步执行不抢输入焦点</h2>
<p>命令台正在读取目录或执行命令时，可以切换到其他输入框继续工作。后台结果返回后显示在原命令台，不强制把焦点拉回。切换视图仍保留草稿与结果，未知结果的写入不自动重放。</p>
