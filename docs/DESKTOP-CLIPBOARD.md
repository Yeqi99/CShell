# 远程桌面剪贴板（2026-11-01）

使用用户触发的 Ctrl+C / Ctrl+V，当前真实桌面会话、控制授权、owner 和 generation 共同绑定；不后台监控剪贴板、不接受任意机器ID绕过视图。远端必须同时具有设备管理和桌面控制权限。

- 文字和 PNG：begin/chunk/commit 事务；控制 RPC 每块64KiB，native命令再拆成2KiB，保持既有8KiB控制行上限。PNG在Windows交互worker内解码验证，并提供PNG及系统位图两种格式；位图剪贴板可转PNG读取。
- 文件：最多64个普通文件、总512MiB。读取返回一次性进程内token与名称/大小，不暴露本地或远端路径；上传到独立会话临时目录，完成后设置Windows CF_HDROP，保留原文件名。读期间文件发生变化即停止；写有偏移顺序检查，不覆盖用户文件。会话结束删除自己的临时目录。
- 原生操作在采集worker所属的交互桌面内执行，支持系统broker启动的worker；不使用Session0 PowerShell冒充用户剪贴板。撤销控制会清除native事务；每个chunk都重新检查授权。

验证：TypeScript及6项API/分块/文件token测试通过；Windows原生worker编译通过。另创建隔离Window Station和Desktop（与用户WinSta0剪贴板完全分开），完成真实Unicode文字、有效PNG、CF_HDROP往返，未读取或修改用户剪贴板。

尚待最终构建的双机UI验收。快捷键后读取剪贴板的时机由前端控制，不能以隔离测试声称所有应用复制行为一致。Linux/macOS远端未加入此Windows原生能力，不伪装支持。

安全加固：文件路径和文件句柄全部保留在 Windows worker，Node不再直接open用户剪贴板路径。SYSTEM worker先获取所属交互会话的用户令牌并模拟该用户；无法取得令牌时拒绝，不以SYSTEM权限回退。普通进程以当前用户访问。复制文件只接受普通磁盘文件，拒绝目录与reparse point；固定句柄读取前后检查大小和mtime，避免路径替换读取别的文件。上传在该用户LocalAppData下创建专用目录，禁止路径分隔符、控制字符及Windows非法文件名。管理授权是当前 files.* 的统一后端门禁，剪贴板另加view/control和owner检查，每个IPC返回前再次确认。
