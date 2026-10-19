# Windows 系统桌面 Broker 接入

此实现保留 Windows 正常登录和密码验证。它不修改锁屏、自动登录、RDP 会话、SAS 组策略或防火墙；也不提供无显示器的虚拟显示驱动。

## 安装与调用约定

安装需要用户明确同意 UAC。固定安装位置是 `%ProgramFiles%\CAgentDesktopService`，仅 SYSTEM 与管理员可写；普通用户只读执行。安装脚本校验传入的两个 SHA256、拒绝目标重解析点、停止旧服务并等待其退出后才替换文件，然后写入受保护的 HKLM 配置并重置 SCM 服务权限。旧服务目录如有两个固定二进制之外的内容则拒绝继续，避免保留潜在的 DLL 搜索路径注入内容。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install-system-service.ps1 `
  -Action Install -SourceDirectory <已核验的原生工具目录> `
  -OwnerSid <当前账户SID> -RuntimeImagePath <当前CAgent版本的node.exe绝对路径> `
  -WorkerSha256 <worker摘要> -BrokerSha256 <broker摘要>
```

`-ExecutionPolicy Bypass` 只作用于该子进程，用于运行摘要已核验的固定安装脚本；不修改机器执行策略或安全产品设置。调用端必须先核验脚本和附件来源，不允许把任意用户文本拼接进命令。

只读状态，不需要提权：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install-system-service.ps1 -Action Status
```

返回 JSON：`{installed,running,runtimeImagePath,proxyPath,requiresElevation:true,protocol:1}`。只显示已安装并不代表当前普通 CAgent 已获得系统桌面访问。

启用系统桌面时，CAgent 必须经明确的 UAC 同意重新以管理员运行；随后直接以私有 stdin/stdout 启动 `proxyPath --stream`。用户可读写的旧 capability helper 路径不能充当系统代理。当前版本 node.exe 路径须与安装时写入的 RuntimeImagePath 一致；版本更新后需刷新系统支持安装配置。未提升时继续普通采集并提示需要管理员运行，不能悄悄扩大权限。

## 授权边界

- 公共管道仅本机可访问。Broker 实际模拟客户端身份，核对 OwnerSid 与真实 token session；客户端不能提供任意目标 session、程序或命令。
- stream 请求必须来自固定受保护 proxy，并且 proxy 与其真实父运行时都已提升、属于相同 SID/session。父进程仍存活、创建时间不晚于 proxy，镜像路径与受保护 HKLM 配置匹配。
- **提升 token 是信任边界。** LocalAppData 中的运行时路径可写，路径匹配只用于绑定配置，不被当作抵抗恶意本地代码的安全隔离。用户明确选择管理员运行 CAgent 即信任该 CAgent 运行时和已授权的远程操作。此方案不声称能够对抗已经获得管理员权限的进程。
- 普通同用户进程不能通过启动固定 proxy 静默获取 SYSTEM 桌面，因为自身及父运行时均没有提升 token。没有普通用户可读取的长期 SYSTEM 授权秘密，也没有尚未接入的未来票据协议。
- 每个 Windows session 同时只运行一个桌面 worker，避免独立键鼠状态互相释放；多个不同 session 可分别运行，工作进程总数上限 4。控制请求另有管道容量，不会在四个视频 worker 活跃时完全失去控制通道。

## 安全注意序列（Ctrl+Alt+Delete）

`desktop-broker-client.hpp` 提供 `bool brokerSecureAttentionAvailable()` 与 `void brokerSecureAttention()`。只允许 Broker 亲自创建、PID/创建时间/session/镜像与仍存活进程句柄匹配的 SYSTEM worker 访问；普通 proxy 不能直接提交 SAS。主端先通过 NativeInput 的输入授权、generation/sequence 检查并释放已持有按键，再调用此函数。

服务动态从 System32 加载 Sas.dll，检查本机 `SoftwareSASGeneration` 明确为 1（services）或 3（services + accessibility）。未配置、禁止、仅 accessibility 或 DLL 不存在时能力为 false；不会静默改策略。服务模拟该 worker 的 session token 调用 SendSAS(FALSE)，每个 worker 最短间隔 2 秒。控制请求/回应每段最多 5 秒，回应有客户端 ACK，避免立即断管道丢弃未读响应。

SendSAS 返回 void，成功返回只表示**已提交**，不证明登录界面已经出现，更不表示已经登录。仍须观察画面并输入正常 Windows 凭据。官方依据：[SendSAS](https://learn.microsoft.com/en-us/windows/win32/api/sas/nf-sas-sendsas)；策略值同时核对了本机 Windows 的 WinLogon.admx。

## 生命周期

双向代理使用共享停止事件。EOF、输出关闭、服务停止会阻止新 IO，取消已有 overlapped IO，并重复取消同步 stdio 直到线程退出。服务先断开 worker 管道，让 NativeInput 正常撤销持有的键鼠；3 秒仍未退出才强制终止，再等待最多 3 秒。异常路径同样优先正常断管道。服务退出最后关闭 kill-on-close Job，避免遗留 SYSTEM 子进程。

桌面正在切换、驱动阻塞或进程被外部强杀时，不能保证旧桌面上的 key-up 注入成功；本实现不把有界强制回收描述成绝对无粘键。SAS 前主动释放用于避免这一常见切换情形。

## 本轮验证及边界

- broker.cpp 与独立 header 的 LLVM-MinGW C++17 `-fsyntax-only` 均通过。
- `tests/desktop-broker-io.cpp` 在普通用户态命名管道上验证预取消、pending overlapped 取消、正常读取、对端 EOF，全部通过；没有启动服务或操作桌面。
- 安装脚本 AST 检查及只读 Status 调用通过；当前输出 installed=false/running=false。
- 未运行新 SYSTEM 服务、未锁屏、未调用 SAS、未安装/替换系统支持、未恢复安全软件删除的文件。真实锁屏密码输入、UAC 场景、服务升级/停止与多 session 验收仍需后续实机进行。无显示器问题属于独立显示驱动能力，不能用本服务冒充已完成。
