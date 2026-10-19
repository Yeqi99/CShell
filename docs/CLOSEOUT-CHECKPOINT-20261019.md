# 2026-10-19 收口检查点

## 发布完成（优先于下方历史）

- 0.6.39 已公开为 GitHub 开源预览版：https://github.com/Yeqi99/CShell/releases/tag/v0.6.39 。共 15 个平台包及 SHA256SUMS.txt；上传后的大小和 SHA256 全部核对通过。
- 所有附件来自 run 39259563403 的同一源码 667f538560e5658b22282f9256b8d24a5cf5be9a。Windows 失败作业重跑后成功，macOS/Linux 双架构、Android API 29/35 均成功。旧发布清单误要求 CAgent ZIP，已修为实际 EXE 并通过测试；使用修正后的同等校验流程恢复发布，没有跳过平台验收或混用旧包。
- Windows 完整桌面烟测和 11 项专项最终通过；MCP 文件级进程异常未复现，单独 TAP 六次及 CI 重跑通过。AI 目标测试曾出现临时 fetch failed，后续原始传输两次及 CI 通过，未据此修改业务逻辑。
- 本机 CShell/CAgent 已安装 0.6.39 并打开，设备身份保留。真实锁屏输入、虚拟驱动加载、纯无屏/重启、Android/macOS 用户设备和实际用户 Key 验收仍按用户安排延后，不能用构建或模拟器结果代替。
- 发布回执与附件来源：.local/recovery-39259563403/provenance.json、published.json；本机安装回执见下方记录。

## 21:08 最新状态（优先于下方历史）

- CShell 与 CAgent 0.6.39 已安装本机并打开，安装摘要核对通过，CAgent 设备身份保持不变。记录见 test-results/closeout-0.6.39-installed.json 和 cagent-0.6.39-installed.json。
- 完整 Windows 桌面烟测、真实打包程序的身份/沙箱/SSH/SFTP 验证及 CAgent 安装包解出后的实际运行验证通过。
- 多平台单元测试、Android API 29/35 模拟器验证已通过；发布流水线发现旧 UI 测试步骤、macOS 全屏切换同步和 Linux 包验证清理无界问题，正在修正重跑。0.6.39 尚未公开发布，不把构建中或取消的作业记作成功。
- 锁屏输入、系统桌面服务与虚拟显示实际安装、纯无屏、重启以及 Android/macOS 真实设备验收仍按用户安排延后；本轮没有在本机安装或启用这些系统组件。

## 17:50 最新状态（优先于下方历史）

- 用户允许延后实机验收，要求锁屏与无屏源码收口后统一发布。0.6.38 已完成本机安装并打开，之前被删除的安装状态已经恢复。
- 0.6.39 新增可选系统桌面服务、受保护代理、有效输入租约下的 SAS 请求，以及签名虚拟显示驱动的计划、安装、拓扑验证与回滚管理。
- 系统桌面要求明确安装和管理员运行 CAgent；没有普通进程静默取得 SYSTEM 的通路。没有启动新系统服务、锁屏、触发 SAS 或安装虚拟驱动。
- 323 项测试与生产构建通过；原生输入 41 项断言、管道 4 项断言、虚拟显示 9 类断言和 WPF 夹具通过。普通与系统版本原生程序已经成功构建。
- 编译工具链使用已核对官方 SHA256 的原始归档恢复，保持 ESET 防护，未添加排除项、改变分类或改名规避。
- 正在生成最终安装包并准备 GitHub 多平台流水线；还没有 0.6.39 发布成功证据。锁屏/无屏、Android/macOS、真实用户 Key 验收仍明确待办。

下方为历史排查记录，不能据此判断当前安装或编译状态。

## 已完成、未统一安装的新改动

- OpenCode 多密钥、真实调用检测、模型选择、官方设备授权流程；真实用户账户仍需用户授权/Key 验收。
- 远端 CAgent 微信事件接入订阅来源，设备/账号/订阅游标隔离，断线及撤权停止；规则管理工具整链夹具通过。
- Tavily 多密钥搜索扩展及 SSH 文件重新打开已在此前 0.6.37 安装验证。
- 本轮全量 319 项测试和生产构建通过，另有 1 项远端微信规则工具整链测试通过。日志见 test-results/integration-opencode-events-tavily-*。
- API/SSH/SFTP 902 秒 71,208 次操作、52 次撤权重连，MCP 600 秒 12,605 次调用；17 项生命周期测试通过。不是小时级或多物理机器证明。详见 API-SOAK-CLOSEOUT-20261019.md。

## 当前安装阻断：ESET 检测

本机 ESET 检测 `@Trojan.GenScript.BBBX`，日志涉及实验采集程序、LLVM 编译器/链接器和已安装 CShell.exe，文件存在性核对确认这些文件已不在。没有恢复隔离文件、关闭杀毒软件或增加排除项。

实验服务 CAgentDesktopBroker 已停止且启动类型 Disabled；没有采集子进程运行。已安装的 CShell.exe 被删除，先前“已安装且运行”记录不再代表当前状态。

保留的 LLVM ZIP SHA256 与官方 20261006 release 完全一致：317492c456aa27ee607a5919f1d2d38dcdc1112516a24d0bf4b00d078f52d17a。此结论仅证明下载包一致，不能证明本次检测为误报。机器可读记录：test-results/eset-detection-20261019.json。尚未向第三方提交样本。

## 不可发布的实验桌面服务

新增 desktop-broker.cpp、desktop-broker-client.hpp、install-system-service.ps1 及 desktop.cpp 的 SYSTEM 分支仍为未交付实验代码。真实 SYSTEM 会话 DXGI/Intel 硬件编码首帧和单帧背压测试通过，但没有锁屏实机验收。

代码审查发现：同一用户任意进程可连接 broker 绕过 CAgent 权限；强制结束 worker 可能未释放按键；proxy EOF/取消竞态可能挂起。后续源码已采取以下措施，但尚未原生编译或实测：

- 普通发行构建禁用 broker 自动接入和 system-pipe，实验编译必须显式定义 CAGENT_EXPERIMENTAL_SYSTEM_BROKER。
- broker 拒绝未提权的客户端，暂时封闭普通用户进程取得 SYSTEM 桌面能力的通路。这只是实验限制，不等同于完成产品所需的 CAgent 会话授权；正常用户模式的锁屏能力仍未交付。
- 正常断连先断开 worker 管道，等待三秒正常清理，再使用强制结束兜底；服务停止不再立即终止整个 job。
- proxy 使用共享停止事件取消 overlapped IO，重复取消同步 stdio 直至复制线程结束，避免一次取消与下一次 IO 之间的竞态。

仍需压力/断线按键释放测试和完整服务授权设计，不能启用或发布实验服务，也不能将首帧成功等同于锁屏控制完成。

无显示器方案只有签名虚拟显示驱动的只读检查/计划，尚无可靠的次屏安装和显示拓扑回滚；Windows Server 2022 兼容性未证明。详见 CAGENT-VIRTUAL-DISPLAY.md。

## 恢复工作顺序

1. 先核对 ESET 检测记录与文件来源，按厂商流程处理检测；不通过换名、重编译、排除路径规避。
2. 修复实验服务授权和生命周期边界，补相关验证，再决定是否进入发行包。
3. 完成虚拟显示拓扑管理及锁屏/无屏实测。Android/macOS 实机验证仍按用户安排延后。
4. 重跑涉及最终改动的测试，重新打包、安装并核验版本。当前没有新统一发行包或 GitHub 发布。

## 检测报告后的源码推进

- 已获用户同意，发送脱敏说明到 ESET samples@eset.com；无附件和私人日志，发送回执 test-results/eset-review-sent.json。尚未取得分类结论。
- 事件触发上下文的规则管理工具目录和执行复核统一，保留只读查询、拒绝写操作；人工会话仍能创建/编辑规则。
- 最新针对测试 21/21 通过，TypeScript 检查通过：test-results/closeout-post-review-tests.log、closeout-post-review-types.log。此结果不包含未编译的 C++ 实验改动。
- 服务状态再次核对为 Stopped/Disabled；本轮未安装、恢复隔离文件或发布。
