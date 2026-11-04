# 0.8.21 发布记录

新增 Cloudflare 扩展：安装后通过官方 OAuth 授权，智能体可查询并执行已授权范围的 Cloudflare API。凭据在本机加密保存，不能复用其他客户端的授权。

修复 Android CAgent 已启用时重回前台无法恢复连接的问题；连接服务不依赖录屏，屏幕查看仍遵守系统授权。远控使用真实解码尺寸并等比显示。

通用 Cloudflare、Android 连接服务和远控比例修复与 Pro 同步。

验证记录：TypeScript、Cloudflare OAuth 回调校验/加密持久化/工具调用测试通过。Pro 签名候选包在小米 USB 覆盖安装成功，回到前台后连接服务运行，未要求录屏授权。

发布包与更新源仍在构建核验，尚未标记公开发布。Cloudflare 扩展真实账号建站未实测；Mac/Linux 无实机验收、签名公证限制沿用。
