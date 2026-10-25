# HTTP 请求工作区

[在线阅读与全文搜索](https://shell.canp.ai/docs/http.html)

<!-- Derived from services/portal/docs/http.html; edit the portal source then export. -->


<p>先在插件市场安装并启用 HTTP，随后在「新建连接」中选择「HTTP 请求」。它是保存请求的工作区，不是持续在线的机器会话。</p>



<h2 id="section-1">发出第一个请求</h2>

<ol>
<li>保存基础地址或填写完整 URL。</li>
<li>选择方法，编辑参数、请求头和请求体。</li>
<li>选择实际发送方：本机、已连接的 SSH 或具有 HTTP 权限的 CAgent。</li>
<li>发送后查看状态码、耗时、响应头与正文；需要时取消。</li>
<li>保存请求供后续使用。载入历史只创建草稿，不会自动重新发送。</li>
</ol>
<p>支持 GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS，以及 JSON、文本与 URL 编码表单。HTML 响应只显示文本，不执行页面脚本。发送方不可用时不会自动回退本机。</p>



<h2 id="section-2">智能体调用</h2>

<p>勾选请求进入工具列表后，仍需单独授权 HTTP 工作区和发送方机器。人工操作与智能体操作共用记录。敏感认证头保存在后端，请优先使用保存的请求，不在对话里粘贴密钥。</p>

<p>文件上传、自动 OAuth 与响应脚本不属于当前请求工作区能力。详细限制见 <a href="https://github.com/Yeqi99/CShell/blob/main/docs/HTTP.md">HTTP 协议说明</a>。</p>
