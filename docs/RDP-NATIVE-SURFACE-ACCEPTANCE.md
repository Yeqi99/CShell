# RDP 原生表面验收

2026-10-30，0.8.16 候选版本，尚不代表已发布。

## 实现与修复

RDP 使用 Microsoft ActiveX，在 CShell 标签区域内呈现原生表面，不启动 mstsc。宿主为 Electron 所属的无边框窗口，无独立任务栏入口；按标签区域计算屏幕坐标，随主窗口移动。标签隐藏、菜单遮挡和最小化时隐藏原生表面，恢复时复用原会话，关闭标签销毁宿主。

此前跨进程 WS_CHILD 在窗口激活后出现 Chromium 背景覆盖原生画面，虽然连接状态和 Win32 可见性均为正常，仍不能视为可用。改为 owned surface 后实际远端桌面稳定可见。初始远端尺寸和控件尺寸不再从 1×1 宿主推导，避免约 200×200 的远端桌面。同样的布局心跳不再重复 SetWindowPos，只有位置或尺寸改变时更新。

## 已通过

- 实际连接授权的 Windows Server 目标，显示完整桌面和 CAgent 窗口。
- 真实鼠标打开远端 Windows Server 开始菜单，键盘 Escape 关闭，画面继续可见。
- 自动化工具不枚举无任务栏 owned window；键鼠验收仅在隔离测试 bundle 把 ShowInTaskbar 改为 true，以获得可操作的原生窗口对象。产品保持 false，不交付外部独立任务栏窗口。
- 产品 false 配置下的 `rdp-surface-smoke.ts` 验证实际 Win32 HWND：owner 正确、没有 APPWINDOW 任务栏样式、标签/菜单隐藏、同一 HWND 恢复、尺寸调整、最小化恢复、关闭后宿主消失。
- 该 HWND 测试仅在隔离 bundle 省略 Connect()，避免未完成网络握手阻塞 STA。它不是远端登录测试；真实目标键鼠验收与 `rdp-embedded-smoke.ts` 分别覆盖实际连接及断线、构建重试、并发复用、取消和输入边界。

## 边界

不将 ActiveX connected 状态单独作为画面成功证据。CAgent 在 RDP 断开后的独立采集/会话恢复属于另一条验收链，未由此记录宣称完成。多显示器跨 DPI 的实机组合仍需补充验证。
