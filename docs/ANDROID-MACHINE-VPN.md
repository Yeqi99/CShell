# Android 机器网络出口

在 CShell 的网络与代理中先设置“此手机 → 出口机器”，保持控制端在线；手机设置中的“手机网络出口”再请求 Android VPN 授权。已有其他 VPN 时拒绝启动，不替用户切换 VPN。网络出口不能从远程 RPC 静默开启。

## 范围

- Android 10+，转发其他应用的 IPv4/IPv6 TCP；系统 DNS 经本地映射后把域名交给所选出口解析。普通 UDP、QUIC、ICMP 不转发。
- CShell 自身排除在 VPN 外，防止账号与中继控制连接递归。此模式不改变 CShell 模型和下载请求的网络设置；这些仍按应用已有的代理能力处理。
- 代理租约、授权或出口失效后，已选择的代理不退回手机直连，保留 TUN 拦截。Android 撤销授权、结束进程或用户关闭 VPN 后可能恢复系统网络；不支持始终开启 VPN，也不是系统永久断网保护。
- 未授权、未选择出口、缺少原生组件、Android 版本过低时不能宣称已开启。

## 构建及许可证

`scripts/prepare-android-vpn.mjs` 从固定 Git 提交构建 hev-socks5-tunnel，要求 Android NDK 27.3.13750724。源码及子模块固定提交并检查工作树修改；不使用可变 latest 二进制。输出四 ABI 的 `.so`、SHA-256 清单以及 APK 内的 `VPN_THIRD_PARTY_NOTICES.txt`。

引擎：`heiher/hev-socks5-tunnel@0c6885060c27134d1bf6a26b1132b6c90f80e4a4`，MIT；`src/core`、`hev-task-system`、`yaml` 为 MIT，`lwip` 为 BSD 3-Clause。完整上游许可证随包保留。JNI 类 `hev.htproxy.TProxyService` 保持上游所需名称。

```powershell
$env:ANDROID_NDK_HOME = '<SDK>/ndk/27.3.13750724'
node scripts/prepare-android-vpn.mjs
node scripts/test-android-vpn.mjs
node scripts/build-android.mjs
gradle -p android assembleDebug
```

## 验证记录与剩余验收

2026-11-04：四 ABI 原生编译成功；完整 Android Java 编译与 debug APK 构建成功；纯 JVM 真实套接字验证 TCP 往返、域名由出口解析、拒绝 UDP、拒绝头注入及租约失效不直连。没有开启用户手机 VPN，没有替换已有 VPN。

发布验收仍需在隔离 Android 设备上验证系统授权、其他应用 TCP/DNS、横跨两台机器的真实出口 IP、撤销和进程结束行为、失效时不外泄、既有 VPN 拒绝启动。当前不能把构建与桥接测试称为完整实机 VPN 验收。

隔离验证准备：官方 AOSP API 35 x86_64 镜像和 Emulator 已校验官方 SHA-1，在 E 盘创建独立 `CAgentVPN` AVD，AEHD 2.2 检查可用；主 APK、Instrumentation APK、独立 UID 的 HTTP probe APK 均成功安装。`AndroidVpnFixture` 只允许模拟器，使用真实 VpnService/native TUN 与受控反向 HTTP 出口，不接触用户账号和手机。执行工具策略拒绝 `adb shell am start`，因此尚未执行系统授权与跨 UID 请求。此项仍是发布验收缺口，不能记为通过。

自动审批记录（未绕过）：

1. 组合操作 `adb -s emulator-5580 shell am start -n org.canpshell.vpnprobe/.Probe --es url http://10.0.2.2:59996/baseline`，等待后读取测试 app 的 `files/result`，再运行 `am instrument -w -e vpnMode true org.canpshell.mobile.test/org.canpshell.mobile.AgentProtocolTest`；工具在执行前拒绝，原文 `blocked by policy`。
2. 去掉私有文件读取与 instrumentation，仅执行上面的 `am start`；同样执行前拒绝，原文 `blocked by policy`。没有更具体理由，没有改用包装命令或其他工具执行同一操作。

保留的测试状态：`E:/CShell-vpn-test/avd/CAgentVPN.avd`、模拟器序列 `emulator-5580`，三个 APK 已安装但 probe/fixture 未启动、VPN 未授权。独立 probe 工程保留在 `E:/CShell-vpn-test/probe`；受控 HTTP fixture 仅监听宿主 `127.0.0.1:59996`，不访问外站。
# 应用自身的数据请求（2026-11-04）

CShell 从 VPN 排除是为了避免账号/中继控制链路递归，但不代表应用数据请求应绕过选中的机器。更新清单、校验和、APK 下载、主动反馈、同步 vault 与分块请求现在显式使用已选机器的本地 HTTP 代理入口。入口失效、服务未启动、租约过期时返回失败，不改用直连。没有选中机器出口时沿用系统默认网络。

登录、设备注册、会员租约等控制链路保持独立，使选择机器出口本身不依赖尚未建立的出口。更新重定向每一跳仍受原先 HTTPS 和官方域名限制；不放宽证书验证。`test-android-app-network.mjs` 使用真实 HTTP origin/proxy 验证实际出口和失败不访问 origin；Android Release Java 编译通过。此项不是手机跨 UID VPN 实机验收。

