# 远端 CAgent 自动化

连接真实 CAgent 后，智能体、MCP 和 CLI 使用同一连接能力目录：

- `agent_automation_list`：当前控制端拥有的任务、事件订阅、执行记录以及实际事件源契约。
- `agent_automation_create`：创建一次性、间隔或事件规则，默认不启用。`enabled: true` 才开始后续调度。
- `agent_automation_change`：暂停、启用、删除、取消或更新目标记忆与检查间隔。

需要目标机器管理授权；创建与修改还需要命令执行授权并经过当前审核策略。远端按照认证控制端绑定所有者，参数不能指定或冒充其他 owner。WSL 子环境不显示宿主自动化工具。旧版或不支持自动化的目标不会显示这些工具。未知执行结果不能自动重放。

命令台先 `connect <连接ID>`，再 `use <返回的会话ID>`：

```text
tools automation
call agent_automation_list {}
call agent_automation_create {"name":"定时检查","prompt":"检查磁盘剩余空间并记录结果","trigger":{"kind":"interval","everyMs":60000},"enabled":false}
call agent_automation_change {"id":"<返回的规则ID>","action":"enable"}
```

独立 CLI 使用 `--session <会话ID>` 选择同一授权会话；MCP 使用 `describe_connection` 获取动态契约，再通过 `invoke_connection` 调用相同工具。事件订阅应先读取列表中的 `sources`，使用准确的 `source` 与 `type`，`filter` 为标量字段精确匹配，不执行外部条件代码。事件注入仍仅限 CAgent 本机，未向远端或 MCP 开放。

验证：真实 CagentAutomation 持久化引擎上的控制端归属隔离、事件过滤规则、记忆更新、权限撤销、禁止 owner 注入、取消前无发送及返回体大小边界；协议输入覆盖检查通过。未向用户机器新建自动化。
