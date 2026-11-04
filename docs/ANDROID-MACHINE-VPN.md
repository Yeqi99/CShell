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
