# CShell Android

独立移动客户端源码：Java 原生 SSH（维护版 JSch）＋本地打包的 xterm.js 界面，不需要中转服务器。提供密码/粘贴私钥连接、首次 SHA-256 指纹核验与变更拒绝、多个终端标签、中文输入、触屏 Ctrl/Esc/方向键、浅深色和带还原按钮的极简模式。凭据不落盘；主机指纹保存在应用私有目录，禁止系统备份。旋转屏幕保留 Activity 与会话，结束进程会断开。

0.4.0 加入独立文件页：通过当前 SSH 会话的 SFTP 通道浏览目录、预览最大 64 KiB UTF-8 文本、使用系统文件选择器上传和下载。上传拒绝同名目标，先写临时文件再重命名；文件操作与终端通道独立。移动端尚未包含桌面的插件执行器、应用安装器和 AI，真机 SSH/IME/旋转/后台切换仍需验收。

## 构建

候选版 0.5.1 起，Android 版本从根目录 package.json 统一读取，versionCode 使用 `major × 1000000 + minor × 1000 + patch`（各段不超过 999）。构建后必须核验 APK 内版本与发布文件名一致；旧包曾保留 0.4.0 / versionCode 6，不能仅重命名旧 APK 发布。

需要 JDK 17、Gradle 8.13、Android SDK 36 / Build Tools 35。根目录先执行：

```sh
pnpm install --frozen-lockfile
node scripts/build-android.mjs
gradle -p android assembleDebug lint
```

发行构建使用持久化私有签名，环境变量 `ANDROID_KEYSTORE`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`，随后 `gradle -p android assembleRelease`。签名文件不得提交 Git；不能每次生成临时发行密钥，否则用户无法覆盖升级。

SSH 输入每连接顺序写入；输出最多 8 个待渲染数据块，xterm 回调确认后继续读取。WebView 仅加载内置资源，拒绝导航、远程脚本和文件/内容协议。录屏与无障碍权限由 Android 系统单独控制。

参考：JSch 2.28.8（BSD-style license）、Bouncy Castle 1.86（MIT）、xterm.js 6.0.0（MIT）。发行前须随 APK 包含各依赖许可证。

## 移动工作台与应用更新（开发分支）

首页提供真实连接数、在线会话及常用入口；连接列表独立支持搜索和分组。连接表单是独立页；底部导航切换首页、连接、终端、文件、设置，终端实例与草稿保留。仅连接元数据持久化，密码、私钥、口令留在内存。连接按钮固定在独立操作区，不覆盖滚动字段。系统返回键先回工作台，首页返回只将应用移到后台。

设置中可手动检查 GitHub Releases（包含预览版），下载后核对 SHA256、包名、递增 versionCode 和签名，再交给 Android 安装程序。仅该操作请求“安装未知应用”权限；不会静默安装。0.3.1 的临时调试签名不能保证覆盖升级，新版签名不同会明确报错。安装和进程终止会结束当前 SSH 会话。

AndroidX Core 1.17.0（Apache-2.0）提供仅暴露私有更新目录的 FileProvider。移动网页回归：`pnpm exec tsx scripts/mobile-smoke.ts`（需要 Edge）。它使用本地测试桥验证页面行为，不能替代真机 SSH、IME、后台生命周期和系统安装验收。

发行工作流现在强制使用 GitHub Actions 加密 Secrets 中的持久化 PKCS#12 签名，不再自动发布临时调试签名。须备份原始密钥；不能在后续发行中重新生成密钥。发布包从 0.3.2 起沿用这套签名。调试构建仅用于开发验证。

返回导航在 Android 13+ 使用系统 OnBackInvokedDispatcher，旧系统处理返回键；首页返回将应用切到后台，不隐式关闭现有终端。

## Agent 原生终端（0.6.0 开发分支）

Android 10+ 可直接连接独立 CShell Agent，不依赖 SSH。Android 8/9 仍可使用 SSH；Agent 要求 TLS 1.3，不降级加密协议。

- 与 SSH 共用连接列表、名称、分组、收藏与编辑；新建先选择 SSH 或 Agent，各自认证草稿保留在内存。
- 首次连接核对 Agent 的 SHA-256 证书指纹后才发送密码；后续证书变化拒绝连接。控制端 EC 私钥由 AndroidKeyStore 生成且不可导出，不把密码或私钥保存到网页、配置或日志。
- 认证后读取真实 `agent.shells`，在所属会话选择 CMD、PowerShell、Linux Shell 或具体 WSL 发行版；旧版 Agent 无环境查询接口时仅使用已授权的非 WSL Shell，不猜测发行版。
- 已授权并保存的 Agent 可从列表直接重新连接。撤权、退出、取消和网络断开会释放通道；端到端保持 TLS 1.3 客户端证书认证。终端输入使用有界异步队列，输出按渲染完成发送字符确认。
- 0.6.34 增加 Windows CAgent 远程桌面观看和触摸键鼠控制，详见 [移动远控与 WSL](../docs/MOBILE-DESKTOP-AND-WSL.md)。移动端其余管理功能尚未对齐；不会把它列入 SSH 文件会话，不伪装支持文件浏览、远程配置或环境安装。桌面端管理能力不自动等同于 Android 已实现。

验证入口：`pnpm exec node scripts/build-android.mjs`、`pnpm exec tsc -p android/web/tsconfig.json --noEmit`、`pnpm exec tsx scripts/mobile-smoke.ts`，以及 Gradle `assembleDebug assembleDebugAndroidTest lint`。移动网页回归使用模拟桥，不能替代原生协议测试。

原生集成测试使用 `scripts/android-agent-fixture.ts` 启动隔离的真实 Agent TLS 服务及原生 PTY，不读取用户配置。主机先用匹配当前 Node ABI 的 node-pty 构建运行该脚本；默认生成 `test-results/android-agent-fixture.json`。安装 debug APK 与 androidTest APK 到 Android 10+ 模拟器，运行：

```sh
adb shell am instrument -w \
  -e agentHost 10.0.2.2 -e agentPort 47839 \
  -e agentPassword "$FIXTURE_PASSWORD" -e agentFingerprint "$FIXTURE_FINGERPRINT" \
  org.canpshell.mobile.test/org.canpshell.mobile.AgentProtocolTest
```

测试覆盖指纹拒绝、连接前取消、真实 Shell 执行、KeyStore 身份无密码重连、撤权断开与撤权后的拒绝重连。必须检查输出 `OK (3 tests)` 且无 `FAILURES!!!`，不能只依据 adb 退出码；仪器测试使用临时凭据，不得上传 fixture JSON。移动真机 IME、旋转与后台生命周期仍需独立验收。

Agent 连接编辑页的「设备身份」提供「重新核对设备身份」。经原生安全确认后只清除该地址的已记住指纹、断开该地址旧 Agent 会话；其他连接、收藏、分组及系统私钥保留。下一次连接仍需手动核对新指纹，并提供必要凭证，不自动接受身份变化。已取消的握手不能重新写回清除的 pin。

## 内置 CAgent 受控扩展（0.7.1）

Android 10+ 从「扩展」启用 CAgent，设置密码、监听端口、对外地址及映射端口。系统录屏授权启动前台共享服务，无障碍服务提供可选输入；无需另装 CAgent APK。配置、输入映射及网络边界见 [Android CAgent](../docs/ANDROID-CAGENT.md)。

隔离模拟器安装 debug 与 androidTest APK 后，可以用同一 runner 的 `-e hostMode true` 验证受控端 TLS、配对、视频分片、重连和撤权。该测试会修改测试应用的配对记录，不能在用户手机上执行。必须检查输出中的 `OK (Android host`，不能只依据 adb 退出码。
