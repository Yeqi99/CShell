# Windows 独立远控恢复

远程桌面工具栏中的“转为独立远控”先生成只读计划。它用于 CAgent 运行在 Windows RDP 会话、关闭或最小化 RDP 后画面采集失败的情形。

计划展示 CAgent 所属 Windows 会话、RDP/控制台类型、锁定状态、控制台是否有人登录，以及是否检测到显示设备（尚未验证画面）。勾选确认后，才尝试把该 CAgent 同一用户、同一会话的输出路由到空闲控制台。RDP 会断开，程序不注销；原用户桌面可能出现在机器实体显示器上。

只在 Windows 10 / Server 2016 或更新版本能够核对全部条件时提供执行：CAgent 以管理员身份运行，已安装并运行系统桌面服务，调用方拥有该机器管理和桌面控制权限，源会话是活跃且未锁定的 RDP 会话，目标是当前空闲控制台。控制台已有用户、会话已锁定/断开、状态未知或旧组件不支持时拒绝。不会选择其他用户，不解锁、自动登录、输入密码、安装驱动或静默提权。

执行使用 Windows WTSConnectSessionW API。服务端保护管道核对已安装代理程序、父 CAgent 运行时、进程创建时间、SID 和 Windows session；在原用户身份下调用 API，不用 SYSTEM 身份获取其他用户会话。计划按调用方绑定、两分钟有效、单次使用，执行前重新核对状态。API 拒绝或结果未确认时不会回退到 tscon、其他用户或自动重试。

显示探测 `--probe` 只初始化捕获源，不获取首帧。即使 GDI 回退初始化成功，也可能在实际 BitBlt 时失败；计划始终返回 `actualFrameVerified: false`，不会据此宣称可采集。

成功调用 API 不等于成功采集。只有 Windows 报告当前控制台已成为原 session 才显示转换确认，然后重新建立原生画面连接；新连接没有画面时仍显示真实错误。没有可用显示设备的机器可能仍需虚拟显示，沿现有独立安装计划/签名摘要校验流程处理，本功能不安装驱动。

## 官方依据与边界

- [WTSConnectSessionW](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsconnectsessionw)：路由源会话到目标会话，同账号调用者可以使用空密码。
- [WTSINFOEX_LEVEL1_W](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ns-wtsapi32-wtsinfoex_level1_w)：核对锁定与活动状态；Windows 7 / Server 2008 R2 锁定标志存在反转问题，因此不支持这些系统。
- [tscon](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/tscon) 文档注明不能连接到 console。本实现不使用该命令，也不把控制台转换宣称为每个 Windows 系统都保证可用；以 WTS API 实际返回和后续控制台核验为准。

## 当前验证

2026-10-30：Core/Pro 单元与现有桌面传输回归 31 项；原生 broker、带系统代理的 desktop helper 构建通过；隔离浏览器验证计划不执行、复选确认后执行一次、系统拒绝不重试。尚未在真实目标 Windows 执行会话转换，不能标为实机验收完成。测试没有操作用户当前 RDP 会话。
