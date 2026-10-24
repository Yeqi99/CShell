# 智能体输入快捷键修复

2026-10-24，0.8.6 发布后的本地修正版。

机器桌面智能体、CodingApp、CAgent 原生和浏览器输入统一为 Enter 发送、Shift+Enter 换行，保留 Ctrl+Enter。主智能体复用相同规则。中文组合输入、229 兼容事件、长按重复和 Alt 组合键不触发提交；空内容及运行中任务沿用原有检查，不扩大权限。

CAgent 使用 PreviewKeyDown，在 WPF TextBox 消费 Enter 换行前处理；IME 的 ImeProcessed 键不按 Enter 提交。发送不可用时不重复提交。输入框或发送按钮提供按需快捷键提示，不堆叠常驻说明。

验证：两版 TypeScript 与键盘规则测试；实际 React 机器智能体通过 Enter、Shift+Enter、IME、空内容及 Ctrl+Enter；隔离的 Windows 原生 CAgent 实测 Enter 进入模型配置校验而非换行，Shift+Enter 保留第二行。未向外部模型发送测试请求。

本次不移动 0.8.6 标签、不覆盖 GitHub/HK 的正式附件。本机修正与正式发行区别保留；后续递增版本应包含此修复。
