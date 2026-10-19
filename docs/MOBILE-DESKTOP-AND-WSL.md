# Android、macOS 客户端与 Windows Linux 安装（0.6.34）

## Android 连接 CAgent

Android 10 及以上沿用 AndroidKeyStore 身份、TLS 1.3 和首次证书指纹核对。连接 CAgent 后，只有目标已安装、启用且授权观看的远程桌面才显示入口；没有终端授权不再阻挡机器连接。终端和桌面使用独立通道，关闭桌面保留终端。

移动端桌面使用同一公网连接端口上的认证 TCP 通道，应用层仍验证临时票据、主机身份、AES-GCM 序号及会话绑定。密钥不进入 WebView。最多重组一帧，解码绘制后确认；超时请求关键帧，解码错误可恢复，后台关闭桌面并释放输入。当前 Android 没有独立 UDP/中继配置入口。

输入方式：单指轻点为左键；移动手指拖动；长按为右键；双指滑动滚轮。映射排除黑边，横竖屏保持坐标正确。支持外接鼠标键盘、常用组合键按钮、仅查看切换、实时帧率/码率调整。手机输入法通过文字区提交 Unicode 文本，需要目标更新到 0.6.34 并更新远程桌面包 0.1.2；旧端会明确提示，而不将中文猜成按键。离焦、取消触摸和断开释放按键。

需 Android System WebView 提供 VideoDecoder；缺少时显示更新提示。没有把 Windows 浏览器测试当作 Android 真机测试。

## macOS 客户端

CShell macOS 共用已保存 CAgent 连接、机器工作区、桌面能力查询、认证视频传输和 WebCodecs 渲染。Mac 可以控制具有已授权远程桌面能力的 Windows CAgent，并不要求 Mac 本机安装被控采集包。

本轮修正首次按下鼠标前的定位、横向滚轮及 Command 释放时的远端按键清理。按物理键映射：Command 对应 Windows 键，Control 对应 Ctrl，Option 对应 Alt。本机系统保留的快捷键不能保证转发。macOS arm64/x64 发布任务加入桌面状态与全屏回归。

当前开发主机是 Windows，尚未生成或验证本轮 macOS 安装包，不标记 macOS 已发布。用户暂缓实机验收，后续在 Mac 验证连接、画面、组合键和全屏。

## Windows CAgent 应用市场的 Linux 虚拟机

原生应用市场加入 WSL 卡片。先读取目标 Windows 的管理员、虚拟化、重启与真实发行版信息；用户选择发行版和下载方式，再点击安装。可使用系统支持的直接下载方式绕过 Microsoft Store，或执行 WSL 更新。明确选择管理员安装时才请求 Windows UAC；不静默提权，不自动重启、不删除或覆盖发行版。

安装命令正常退出后重新检查真实发行版。缺少发行版时提示重新检查与系统重启要求，不能将一个退出码等同于可用 Linux。记录安装日志和常见虚拟化、内核、网络、权限错误的处理方向。提升权限的安装由系统执行，普通进程不能保证取消；退出后标记结果待检查，不盲目重复安装。

CShell 的机器应用市场也可进入 WSL 设置。重新进入终端或点击刷新，重新检测真实 Linux 发行版。新配置预留 WSL 终端授权；已有明确权限不扩大，旧控制端若未获 WSL 权限，需要在设置中授权并重新配对。首次发行版初始化仍可能要求 Linux 用户名和密码。

WSL 是 Windows 上的 Linux 环境，不是通用虚拟机管理器。云服务商未提供嵌套虚拟化、BIOS 未开启虚拟化，以及 Windows 必须重启的情况，应用不能绕过。依据：[微软安装说明](https://learn.microsoft.com/windows/wsl/install)、[命令说明](https://learn.microsoft.com/windows/wsl/reference)、[故障排查](https://learn.microsoft.com/windows/wsl/troubleshooting)。

## 验证与待验收

- Android 隔离模拟器：真实 TLS/KeyStore 身份连接、加密分片重组、6 帧确认、输入消息、身份重连通过；测试载荷没有控制用户桌面。
- 移动 UI：真实 H.264 解码、文字桥接、仅查看阻断输入、横竖屏布局通过；触摸坐标、拖动取消、长按与双指滚动的自动测试通过。
- Windows 原生输入状态：37 项检查通过，包括文本授权、过期序号和超限拒绝；没有向用户程序注入测试文字。
- WSL：已构建实现并检查参数和错误分流；没有在用户主机新装发行版、请求提权或重启。全新 Windows、云主机嵌套虚拟化、UAC 和重启续接仍待实际安装验收。
- Android 真机与 Mac 实机由用户方便时统一验证；网络切换、移动端长时间视频、不同手机输入法及系统快捷键仍列为待验收。

回归入口：`scripts/mobile-desktop-smoke.ts`、`scripts/android-desktop-fixture.ts`、Android instrumentation 的 `desktopMode=true`、`tests/desktop-touch.test.ts`、`tests/wsl-diagnostics.test.ts`。`tests/fixtures/desktop-colors.h264` 是本项目原生色彩测试生成的图案，无用户画面。

本轮桌面/运行时组合回归 38 项中 37 项通过，实际 Ubuntu PTY 未及时出现提示符；单独重跑又出现 Client disconnected。关闭隔离 Android 模拟器、完成并行构建后，同一测试通过：Ubuntu PTY 出现真实提示符，独立命令确认 environment=wsl、kernel=Linux，证据 wsl-isolated-final.log。这支持负载相关超时的判断，但尚不能证明根因；保留前两次失败日志。没有修改用户代理、WSL 配置或重启发行版。全新 WSL 安装仍未实测。
