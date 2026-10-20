# Android CAgent 验证记录

日期：2026-10-20。版本：0.7.1 本地构建。

## 已执行

- Android debug 与 androidTest APK 构建，Android lint。
- TypeScript、桌面构建、移动端网页回归；Android、Windows 及仅有终端权限三种机器工作区回归。
- Android 15 / API 35 隔离模拟器，实际 TLS 1.3 配对、错误密码拒绝、证书核对、分片视频、背压、输入转发、重连、旧票据失效、重放拒绝与密码轮换撤权。
- 真正的 TypeScript `ClientProvider`、`DesktopClient`、`DesktopSession` 连接 Android 受控端：10 个分片视频帧、4 次输入；UDP 偏好正确回退 TCP，不支持的输入不再导致视频断开。
- 系统录屏确认 → MediaProjection → MediaCodec H.264 → TLS → 原生解码：480×800 画面 9 帧；旋转后同授权重连及尺寸调整，320×192 画面 4 帧。检查解码像素亮度差异，避免把全黑帧当作成功。
- 实际无障碍服务点击测试按钮、普通文本输入、字母按键及退格；共享停止后端口关闭。测试后恢复模拟器无障碍设置。
- Windows 0.7.1 安装包构建、安装、版本与 ASAR 哈希核对、窗口重新打开。

原始输出保存于本地 `test-results/android-host-node-interop.json`、`android-host-final-device.log`、`android-capture-input-device.log`、`closeout-0.7.1-installed.json`。测试使用隔离身份，不复用用户连接。

## 尚未证明的范围

- 实体手机厂商后台保活、长时间温度与耗电、蜂窝公网入站，以及 macOS / Linux 实机控制手机。
- 本次全量 Node 回归为 340 / 342 通过；HTTP 工作进程停止耗时阈值与本机 WSL 提示符测试失败。HTTP 单独复测仍超过阈值。这两项不属于 Android 新增链路，未将其掩盖为通过，也未修改阈值。
- Android 新增回归已接入 CI 脚本，但本地 API 35 结果不代表其他 API 的新增用例已经运行。

本记录不等同于 GitHub 全平台发布记录。实际发行以经过构建和核验的附件为准。
