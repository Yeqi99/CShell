# CShell Android

独立移动客户端源码：Java 原生 SSH（维护版 JSch）＋本地打包的 xterm.js 界面，不需要中转服务器。提供密码/粘贴私钥连接、首次 SHA-256 指纹核验与变更拒绝、多个终端标签、中文输入、触屏 Ctrl/Esc/方向键、浅深色和带还原按钮的极简模式。凭据不落盘；主机指纹保存在应用私有目录，禁止系统备份。旋转屏幕保留 Activity 与会话，结束进程会断开。

移动端尚未包含桌面的文件管理、插件执行器、应用安装器和 AI。必须完成真实 APK 编译、安装、SSH/IME/旋转/后台切换验证后才可对外标记发布版，不能以 Web 资源构建成功替代设备验证。

## 构建

需要 JDK 17、Gradle 8.13、Android SDK 36 / Build Tools 35。根目录先执行：

```sh
pnpm install --frozen-lockfile
node scripts/build-android.mjs
gradle -p android assembleDebug lint
```

发行构建使用持久化私有签名，环境变量 `ANDROID_KEYSTORE`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`，随后 `gradle -p android assembleRelease`。签名文件不得提交 Git；不能每次生成临时发行密钥，否则用户无法覆盖升级。

SSH 输入每连接顺序写入；输出最多 8 个待渲染数据块，xterm 回调确认后继续读取。WebView 仅加载内置资源，拒绝导航、远程脚本、文件/内容协议和额外 Android 权限。

参考：JSch 2.28.8（BSD-style license）、Bouncy Castle 1.86（MIT）、xterm.js 6.0.0（MIT）。发行前须随 APK 包含各依赖许可证。
