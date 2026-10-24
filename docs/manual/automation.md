# 事件订阅与 MCP

[在线阅读与全文搜索](https://shell.canp.ai/docs/automation.html)

<!-- Derived from services/portal/docs/automation.html; edit the portal source then export. -->




<h2 id="section-1">事件订阅</h2>

<p>将一个实际可用的扩展事件来源绑定到普通智能体会话，保存提示词、筛选条件与运行预算。先完成来源的配置和权限检查，再开启监听；新规则需明确启用并保存。</p>

<p>规则启用、来源监听与发送权限分别生效。接收消息不等于允许回复，重启后规则仍在也不意味着监听已恢复。任务沿用会话实际模型、机器与授权；外部事件内容不可以扩大权限。</p>

<p>配置冷却时间、运行次数与请求预算，检查跳过、失败和停止记录。离线消息不承诺自动补齐。详情见 <a href="https://github.com/Yeqi99/CShell/blob/main/docs/AI-EVENTS.md">事件订阅指南</a>。</p>



<h2 id="section-2">MCP 连接</h2>

<p>MCP 默认关闭。在 AI 与安全设置中选择明确允许的保存连接，为客户端配置访问令牌与能力范围，然后启用并保存。只有状态显示运行成功后才配置外部 MCP 客户端。</p>

<p>服务使用本机 Streamable HTTP，地址示例为 <a href="http://127.0.0.1:3777/mcp%EF%BC%8C%E8%AF%B7%E4%BD%BF%E7%94%A8%E5%AE%9E%E9%99%85%E9%85%8D%E7%BD%AE%E7%9A%84%E7%AB%AF%E5%8F%A3%E3%80%82%E5%AE%A2%E6%88%B7%E7%AB%AF%E9%80%9A%E8%BF%87">http://127.0.0.1:3777/mcp，请使用实际配置的端口。客户端通过</a> Authorization: Bearer 访问令牌认证；不要共享含令牌的配置文件。</p>

<p>先在 CShell 中连接目标、确认身份并保存凭据。MCP 只能使用已授权的连接，不能通过传入任意地址扩大范围。执行命令需对应授权；更换令牌会撤销旧访问。</p>

<p><a href="https://github.com/Yeqi99/CShell/blob/main/docs/MCP.md">MCP 接入配置</a> · <a href="https://github.com/Yeqi99/CShell/blob/main/docs/API.md">API 开发说明</a></p>

