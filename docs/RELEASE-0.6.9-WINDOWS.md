# CShell 0.6.9 / cagent 第一阶段

本地交付，未发布 GitHub。Windows x64 构建未做 Authenticode 签名，使用构建摘要和安装后资源摘要核验。

- Windows 远程桌面连接可保存主机、端口、账号、加密密码、名称、分组和收藏，进入统一左侧列表，双击启动系统远程桌面客户端。未做真实远端登录验收；证书和系统策略仍可能要求确认。
- 手动规则提取和 AI 填入支持已实现的 SSH、RDP、cagent、HTTP 连接。按所选类型校验，仅填入草稿，不自动连接或发请求。
- cagent 取代 CShell Agent 显示名，保留旧身份和协议；独立运行时、Windows 原生极简小窗、加密基座配置、任务审核、受控委派及本机应用市场见 [CAGENT.md](CAGENT.md)。这是第一阶段，不包含 RDP 控制、Clash、微信能力包自动注册或原生托盘应用。
- 微信工具包 0.1.4 增加独立授权的纯文字朋友圈发布，必填幂等键，未知结果不自动重试。已按用户授权完成一次真实发布并独立读回确认。支持精确客户端版本，不能声称支持任意最新版。

验证：27 项后端针对测试、6 项规则与提取测试、RDP 隔离桌面保存/重启/编辑/双击路由、cagent 独立界面审核/草稿/应用计划、独立打包运行时真实 PTY/TLS/授权隔离。微信 wheel 与源码逐文件一致，离线包摘要检查通过。

安装结果和摘要以 `test-results/cagent-release-build.json`、`test-results/cagent-release-install.json`、`test-results/cagent-standalone-install.json` 为准。测试夹具不访问用户远端机器，不安装真实市场应用，不额外发送微信消息或朋友圈。
