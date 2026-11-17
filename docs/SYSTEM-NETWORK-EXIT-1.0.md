# 系统网络出口执行层（尚未开放给用户）

现有机器身份代理继续保持 applications 范围。新增系统执行层不改变已有规则或设备网络，也未自动开放 UI。

已实现：
- `system-network-exit.ts` 生成 sing-box TUN 配置，唯一出口为现有机器代理的本机 CONNECT 入口；DNS 通过该出口 TCP 转发，其他 UDP 拒绝。
- `NativeSystemExitRuntime` 校验包摘要、检测已有 VPN、要求管理员与明确授权。先建立持久防漏规则，再启动 TUN；启动失败保留防漏，显式停用才移除。
- Windows 原生 WFP helper 原子提交独立 provider/sublayer；仅本机回环、所选 TUN、控制程序和引擎允许，其他新连接拦截。`pending` 可在接口建立前安装防漏，`allow-tun` 后续绑定真实接口。仅操作自己的 provider，不修改用户防火墙策略。
- Linux nft 独立表阻断物理出口，仅允许 TUN、loopback、专用控制服务 UID 的明确 TCP 对端和 DHCP/IPv6 邻居发现。要求专用服务 UID，不免除用户登录 UID。

验证：
- 官方 sing-box 1.14.4 Windows amd64 下载包 SHA256：`99185d75d314a07dbba4a130c8ad986cbeb629a07927975636b341ca61f991df`，与 GitHub Release digest 匹配；TUN 配置真实 `check` 通过。
- `scripts/system-network-engine-smoke.ts` 使用真实引擎、回环入站、实际 CONNECT 代理和 TCP 回显，出口断开后失败，不直连。没有开启 TUN、改路由或改防火墙。
- WFP helper 静态编译并运行 `describe`；未执行 apply/remove。
- 4 项生命周期/拒绝授权/UDP策略/防漏规则回归通过，TypeScript 检查通过。

尚未验收，不能称为完整系统网络出口：
- Windows WFP 在隔离虚拟机验证已有 TCP 流重授权、IPv6、接口重建和引擎崩溃持久防漏；控制程序例外须限制实际签名程序及其依赖，防止可写目录替换。
- Linux 专用服务 UID 与源机器控制通道安装、nft 真实 network namespace 验证。
- 完成 capability 安装包/依赖摘要和许可、持久服务生命周期、身份规则 system scope、远端权限、UI授权和恢复入口接线。
- 实际 DNS 查询与 Windows/Linux 系统流量、失败恢复验收，不可由配置检查代替。

参考官方协议：
https://sing-box.sagernet.org/configuration/inbound/tun/
https://sing-box.sagernet.org/configuration/outbound/http/
https://sing-box.sagernet.org/configuration/dns/server/tcp/
https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/fwpmu.h
