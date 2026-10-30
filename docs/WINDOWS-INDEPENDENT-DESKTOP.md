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

## 早期隔离验证

2026-10-30：Core/Pro 单元与现有桌面传输回归 31 项；原生 broker、带系统代理的 desktop helper 构建通过；隔离浏览器验证计划不执行、复选确认后执行一次、系统拒绝不重试。尚未在真实目标 Windows 执行会话转换，不能标为实机验收完成。测试没有操作用户当前 RDP 会话。


### 2026-10-30 Windows 独立首帧实机验收

Windows 测试机已升级 CAgent 0.8.16，受保护系统桌面服务的 broker、worker 与新包摘要一致。原身份、密钥保护材料、连接密码和访问权限文件与升级前备份逐文件比较一致，原控制端配对仍能使用。

在同 SID 的活跃、未锁定 RDP 会话以及空闲 console 条件下，显式转换返回 accepted=true、confirmed=true、errorCode=0；实际 console 会话随后与原用户会话一致。RDP 断开后，正式 MCP 桌面截图连续取得 1024×768 的真实桌面，独立首帧已通过。未安装虚拟显示驱动，未自动登录或解锁，也未扩大权限。这不代表所有 Windows/无头硬件或重启后场景均已通过。

早期键鼠验证未通过（已由下节复验更新）：交互工具返回完成，但右键和按键后未观察到对应画面变化，光标也未移动至请求位置。正在补充输入确认及连接关闭前的交付验证；不能把首帧成功等同完整控制成功。旧版窗口在后台退出后仍可能占用单实例锁，升级验收须核对真实运行版本，不能仅凭安装完成判断升级生效。

### 2026-10-30 Windows 画面与输入完整实机复验

在 Windows Server 2022 的已解锁 console 2 中，未重新连接 RDP，使用隔离主控源码 3e3435b 与受控候选 slot 0.8.16-6b543bd5a2a3726a 完成正式桌面工具验收：冷启动单次截图 frame 0 为真实 1024×768 画面；鼠标移动后独立 GetCursorPos 为 409,307；点击开始按钮出现开始菜单；文字“CShell input check 0816”完整出现在 Windows 搜索框，未发送 Enter；Escape 恢复原桌面。测试视图已停止。

修复包括已授权桌面句柄所需的 JOURNALPLAYBACK 访问位、初始视频配置与媒体乱序门禁，以及跳过 DXGI LastPresentTime 为 0 的未更新桌面样本。没有按黑色像素判断有效性，没有更改 ACL、令牌、锁屏或机器权限。受控端身份、密码、访问配置与密钥保护文件与升级前一致。

证据为 Pro 本地 .local/desktop-ack-acceptance-final.json 及其中四张截图的 SHA-256。此为指定 Windows Server 2022 未锁定控制台的真实结果；不代表所有 Windows、UAC 安全桌面、锁屏、无头硬件或重启后均可用。主控此次使用隔离开发构建，最终封装安装包仍需按最终源码和摘要验收；不表示公开发布。

## 2026-10-31 正式发布与成品复验

北京时间 2026-10-31 00:17 已公开发布：Core [v0.8.16](https://github.com/Yeqi99/CShell/releases/tag/v0.8.16)，release 429222483、源码 492fe7a6a9ee4f6a25d12c8ee2c31a81a82575e5；Pro [pro-v0.8.16](https://github.com/Yeqi99/CShell/releases/tag/pro-v0.8.16)，release 429222604、源码 cc9e9b7f2a23f10d6dc1daaa2159dec99256bff6。分别核验 16 / 14 个公开附件（含各自 SHA256SUMS），不移动旧标签。记录见 Pro 本地 .local/public-release-0816-receipt.json。

正式 Pro win-unpacked 主控与正式 CI CAgent Windows 安装包重新完成验收：受控安装包 SHA-256 为 84cca14038fb7f3108ea41e0149c83917822525cddb389ee34bce8ede7e66a43，slot 0.8.16-ee01cde571f0c078；系统服务摘要匹配，身份、密码、访问配置与密钥保护文件保留。console 2 未重新连接 RDP，冷启动 frame 0 取得真实 1024×768 画面；鼠标独立读回 409,307；开始菜单点击、Windows 搜索完整文字“CShell input check 0816”（未 Enter）及 Escape 恢复均有可见证据。测试视图与隔离主控已关闭。证据为 .local/desktop-ack-formal-package-acceptance.json 和四张 ack-formal 截图；这更新了此前仅开发构建通过的状态。

上述发布与指定目标成品验收不表示用户本机 Core/Pro 已完成升级，也不表示官网已经部署；安装与上线结果按对应收据另记。指定 Windows Server 2022 未锁定控制台的结果不外推锁屏、UAC、安全桌面或所有无头硬件。
