# Android 实机验收进度

本记录区分已实现、编译通过和实机通过，不作为发布完成声明。

- USB 设备为 Android 16，型号 23113RKC6C。用户已确认 USB 调试，ADB 状态为 device。
- 使用仓库私有 JDK 17、Gradle 8.13、SDK 36 构建 Pro debug APK成功，不更改全局 PATH。调试包不是发行签名包。
- 首次安装返回 `INSTALL_FAILED_USER_RESTRICTED`，需要手机允许 USB 安装；未通过 ADB 绕过系统授权。
- 新增 `cagent.android/android_ui_read` 固定能力契约，读取当前屏幕可访问性节点、像素边界及状态。最多300节点、深度24、单段文字2000字符；密码节点及其子树不输出。
- 工具仅在屏幕共享有效、手机已解锁且辅助控制开启时出现；每次调用重新检查。CShell使用实际绑定设备调用，仍经过 `desktop.view` 授权。屏幕文本是非可信内容。
- 桌面端工具契约及连接前探测6项回归通过，Android Java及 TypeScript 编译通过。

## 未完成验收

实机已正常安装且实际共享画面已验证（见下方最新记录）；触控/输入、旋转、锁屏、断连与恢复仍需最终候选实机确认。没有发送短信或拨号。不能把编译或模拟测试当作这些能力已在手机通过。

## 电话与短信接口

已实现 `android_sms_read`、`android_sms_send`、`android_call`、`android_call_answer`，只向已认证控制端展示系统已授予权限的能力；手机设置分别提供短信、电话授权入口。CShell 工具仍经过机器范围和读取/执行权限审核。

发送和拨号要求 UUID 操作编号，设备私有记录先落盘再执行；同一控制端重试相同编号仅返回既有结果，不重复执行。API 返回 submitted 仅表示请求交给系统，不表示送达或接通。默认短信 SIM 未指定时拒绝发送，紧急号码需手机上直接拨打。

验证：3项远端工具契约测试通过；Android构建与lint通过（存在既有warning）；移动工作台导航/草稿/旋转布局模拟回归通过。新增 `phonePermissionsMode` 仪器测试只验证拒绝权限，不发送短信、不拨号，仍待设备安装后执行。

## Android 16 正式签名候选已安装

用户确认该手机要求插SIM卡才能开启USB安装。未绕过厂商限制：经ADB把已核验的正式签名0.8.18 APK复制到Download，由用户使用手机文件管理器完成系统安装。实际包org.canpshell.mobile.pro已存在并成功启动到首页，UI截图留在test-results/android-real-screen.png。

此手机同样禁止ADB注入点击；后续通过手机手动开启CAgent、系统屏幕共享和无障碍授权，再走产品真实TLS远控验收。没有把ADB控制当作CAgent能力。手机未插SIM，电话/短信的实际运营商收发无法在此设备上验证，不能以权限接口成功宣称接通或送达。

## 真实共享与输入诊断

用户已真正开启屏幕共享和无障碍服务。配对使用产品真实 TLS 与设备身份，控制凭据仅保存在测试控制端的加密存储；不记录连接密码。CShell 已收到并解码 1080×2400 硬件 H264 画面。触控事件到达系统，但已知按钮没有预期变化，因此输入验收仍未通过。

最初诊断候选 run 41283404193、SHA-256 `02e508e36683b23d9926e65225803ee5b00c76c513aa8e26cc1e11bdb57cccf2` 已被下面的新候选替换，不再按旧摘要安装。

诊断仅返回输入阶段、队列状态与坐标尺寸，不返回输入文字。后续单次可观察按钮测试不重放未知操作，不发送短信或拨号。

## 最新手机候选与模拟器实证

- 手机 Download/CShell-Pro-0.8.18-input-check.apk 已替换为 run **41288247568**、artifact **13075439046** 的正式签名 APK；生产输入实现对应 **0b05da1**，候选源码249f4b5c210c2a25a01de1d5cb0f4299f9fcf312。
- APK SHA-256：`413a09acc5a20a0c63fea49bda2f625fc046bb7650911ab00b3470f9bd461a44`，下载清单、本地计算、手机sha256sum三者一致。ZIP digest：`6fcaaaf8d1cfcfc73adc3b1552edb6d2046d43c81b642ace20e70984d0af44c0`。
- apksigner verify通过；发行证书SHA-256：`34cc1c9a0eacafc512a0837c3d286081879822f047e5637a65cdbc5b525914c5`，与原正式包一致。未卸载、未清除数据、未变更手机权限。最新只读lastUpdateTime仍为2026-11-01 14:42:40，等待用户系统覆盖安装。
- 真实API35模拟器 run **41287649599** 与 **41288701215** 全部通过，包括TLS原生输入、真实native控件、重复点击、Unicode/选区删除、中间光标、Shift、失败停止、屏幕编码/解码、旋转与重连。不是物理手机输入通过。
- API29 run **41288701215** 仍失败：中间光标13:13而非7:7；首验证轮query8ms但排队总5012ms。独立采样明确主线程阻塞在系统 `AccessibilityCache.onAccessibilityEvent` 的cache锁，尚未完成光标定位。下一轮采样锁持有者，不扩大期限、不重放文字、不放宽结果断言。
- 单次API35 `CONTROL_CLOSED` 位于宿主互操作而非输入阶段；后续两API宿主互操作通过。已保留宿主fixture输出与隔离模拟器crash buffer以便再次发生时查真实原因。

签名/复制验收凭据：`test-results/unified-ui/android-input-candidate-receipt.json`。物理手机无SIM，不声明运营商短信或电话收发通过。
