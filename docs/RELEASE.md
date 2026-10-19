# CShell / CAgent 0.6.36 开源预览

## 本次更新

- 新的统一品牌图标：CShell 蓝色终端、CAgent 薄荷绿智能体，应用到窗口、托盘和安装包。包含未来 Pro 的金色设计素材；本次仍为开源版。
- 智能体补充语义上下文压缩、持久检查点、后台任务、恢复前核查与可配置执行预算。
- OpenCode 作为可选扩展接入，支持模型发现及官方可用额度信息；不读取浏览器登录凭据。
- 汇总此前本地版本的远程桌面恢复、全屏与界面修复、Windows CAgent 微信应用、WSL 检查和 Android 桌面触控适配。

## 验证与限制

Windows 安装包在本机构建并核验；发布附件与 SHA256SUMS.txt 为准。Windows 包未做商业代码签名。

Android / macOS 的新增远控能力仍待用户实机验收。无附带对应平台构建产物时，不表示该平台已发布。远控长时间视频、弱网、锁屏、RDP 会话切换及公网中继的完整验收仍未完成；微信桥接限支持的 Windows 微信版本。OpenCode 真正账号额度与调用依赖用户配置 Key。

本版本不宣称消除所有商业化前风险，详见 docs/OPEN-SOURCE-CLOSEOUT-0.6.33.md 与 docs/AGENT-RELIABILITY-0.6.35.md。
