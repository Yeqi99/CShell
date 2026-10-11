# CShell Android

独立移动客户端源码：Java 原生 SSH（维护版 JSch）＋本地打包的 xterm.js 界面，不需要中转服务器。提供密码/粘贴私钥连接、首次 SHA-256 指纹核验与变更拒绝、多个终端标签、中文输入、触屏 Ctrl/Esc/方向键、浅深色和带还原按钮的极简模式。凭据不落盘；主机指纹保存在应用私有目录，禁止系统备份。旋转屏幕保留 Activity 与会话，结束进程会断开。

移动端尚未包含桌面的文件管理、插件执行器、应用安装器和 AI。0.3.1 按用户要求提供调试签名的测试 APK，已通过云端编译与 lint；安装、SSH/IME/旋转/后台切换仍待真机验证。后续更换签名可能需要卸载后重装，当前不标记为稳定版。

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

## 移动工作台与应用更新（开发分支）

首页现在是可搜索、按组显示的服务器列表。连接表单是独立页；底部导航切换服务器、会话、设置，终端实例与草稿保留。仅连接元数据持久化，密码、私钥、口令留在内存。连接按钮固定在独立操作区，不覆盖滚动字段。系统返回键先回工作台，首页返回只将应用移到后台。

设置中可手动检查 GitHub Releases（包含预览版），下载后核对 SHA256、包名、递增 versionCode 和签名，再交给 Android 安装程序。仅该操作请求“安装未知应用”权限；不会静默安装。0.3.1 的临时调试签名不能保证覆盖升级，新版签名不同会明确报错。安装和进程终止会结束当前 SSH 会话。

AndroidX Core 1.17.0（Apache-2.0）提供仅暴露私有更新目录的 FileProvider。移动网页回归：`pnpm exec tsx scripts/mobile-smoke.ts`（需要 Edge）。它使用本地测试桥验证页面行为，不能替代真机 SSH、IME、后台生命周期和系统安装验收。
