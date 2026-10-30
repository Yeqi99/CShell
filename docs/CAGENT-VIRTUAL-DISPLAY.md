# CAgent 可选虚拟显示后端核查

2026-10-19：完成固定发行附件核验、原生安装/拓扑事务源码、CAgent 管理接口和自动化测试。**真实驱动安装、无显示器采集及重启恢复尚未实机验收**。本次开发未安装驱动、导入证书、关闭 Secure Boot、开启测试签名或修改本机显示拓扑。普通桌面采集与 SYSTEM 锁屏采集不能代替虚拟显示设备。

## 固定候选

候选是独立显示驱动，不是远程桌面引擎；CAgent 继续自行负责采集、编码、传输、输入和渲染。

- 上游：[VirtualDrivers/Virtual-Display-Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver)，[MIT 许可证](https://github.com/VirtualDrivers/Virtual-Display-Driver/blob/master/LICENSE)，分发时保留版权与许可证。
- [25.7.23 发行页](https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/tag/25.7.23)。发行标题含 Beta，不能因 GitHub prerelease=false 宣称生产稳定。
- [精确驱动附件](https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip)，132118 bytes。
- SHA256：`e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a`。
- 虽然附件名含 x86，INF 是 NTamd64，硬件 ID 为 `Root\MttVDD`，目标为 Windows x64。
- CAT 与 DLL 均通过本机 Authenticode 检查；签名主体 `CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, S=Delaware, C=US`；证书指纹 `3CF8CF26D8BA266C3A483AB7D26D4A818E317D76`。这不是 WHQL、Windows 信任策略下实际加载成功或 Secure Boot 兼容性的实测证明。

只读复核（需先下载上述固定附件）：

```powershell
& ./scripts/check-virtual-display.ps1 -Archive <driver.zip绝对路径>
```

脚本校验摘要后仅在临时目录解包并检查 CAT/DLL 签名；返回结构化计划状态，始终 `installAllowed=false`。不执行附件中的程序或上游脚本。临时解包文件会清理。

## 安装实现与限制

[官方社区 silent-install.ps1](https://github.com/VirtualDrivers/Virtual-Display-Driver/blob/master/Community%20Scripts/silent-install.ps1) 使用 NefCon 创建根枚举显示设备，并导入发布者证书；它未保存显示拓扑，也没有保证新设备是次显示器。另一个 community manager 使用 DevCon，仍没有拓扑事务。上游 README 提醒显卡更新可能改变主屏。不能把这些脚本直接包装成“一键安全新增次屏”。仅 PnPUtil `/add-driver /install` 也不负责创建所需根设备。

因此没有复用上游安装脚本。`tools/cagent-desktop/VirtualDisplay.cs` 使用 SetupAPI 创建唯一 `ROOT\CAGENTVDD\<任务 UUID>`，指定固定 INF 构建单驱动列表，再调用 Windows 安装器。四个附件文件均固定摘要，复制到管理员保护的任务目录后重验；Windows 签名策略仍由系统执行，失败不导入证书或绕过策略。发现既有 VDD 设备/全局配置时拒绝接管。

原生事务已实现：

1. QueryDisplayConfig 保存活动路径/模式到持久任务日志；原路径、位置、分辨率、旋转、缩放及刷新率都校验。
2. 通过显示适配器路径匹配唯一自建设备；只新增一个目标，放在现有最右侧，纯无头时坐标为原点。不使用允许任意修改已有模式的 `SDC_ALLOW_CHANGES`。系统无法满足完整拓扑时失败。
3. 失败移除自建设备并恢复原拓扑；失败回滚会记录 `recovery-required`，不能报成功。正常卸载保留用户安装后调整的布局和新接入的物理屏；只移除匹配任务日志、硬件 ID 和所有权名称的设备，不删共享驱动存储包。
4. 不自动提权/重启。安装需在目标机器已提升权限的交互会话中执行；RDP 会话、无 WDDM 或系统拒绝显示配置时可能失败。服务中的会话切换不由该模块偷偷处理。

无活动显示器的起始状态：QueryDisplayConfig 成功返回零活动路径时可直接创建新显示；查询返回 GEN_FAILURE/NOT_SUPPORTED 时，仅在当前进程属于活动控制台、输入桌面可读取、完整显示器枚举成功且为零、SM_CMONITORS 为零并且无桌面附着设备时允许建立空快照，并在日志记录原错误和证据。ACCESS_DENIED、RDP/非控制台会话、枚举失败或任何活动屏证据均不伪装为空桌面。首次驱动就绪前按同样规则等待，无法证明时保留真实错误。

待实机验收：物理屏存在/移除、纯无头、锁屏/解锁、重启、GPU 重置、安装失败与卸载。安装过程中 Windows 驱动枚举可能短暂改变画面，当前源码保证最终验证及回滚路径，不能宣称已经证实所有硬件无闪屏或不中断。

## CAgent 接口

入口位于已安装远程桌面应用的管理上下文，沿用其本机/远端管理授权。`CAgentVirtualDisplay.exe` 与 `cagent-desktop.exe` 同目录，不提供远端可输入的可执行文件或包路径。

- `desktop.virtual-display.plan({width:1920,height:1080,experimentalServer:false})` 返回 `{id,expires,compatible,experimental,helperAvailable,executable,release,warning}`。计划绑定控制端身份，10 分钟过期。
- `desktop.virtual-display.install({planId,confirm:true})` 消费一次计划，固定官方地址下载、最多 1 MiB、校验 ZIP 摘要后解包，执行原生 helper。返回任务 `{id,device,phase,before,error}`；`phase=active` 才表示原生拓扑验证成功。
- `desktop.virtual-display.status({})` 返回 `{plan,probe,tasks,busy}`；`status({id})` 查询管理员保护的任务日志。
- `desktop.virtual-display.remove({id,confirm:true})` 只移除本任务设备；`recover({id,confirm:true})` 明确恢复安装前布局，适用于中断后的人工恢复。

超时/进程崩溃属于未知结果，不自动重试；先查看任务状态与实际设备。上游驱动实际可用后还需远程桌面采集验证，不能仅凭 `active` 宣称流畅度已验收。

构建：`node scripts/build-virtual-display.mjs <输出exe路径>`。只读原生测试：`CAgentVirtualDisplay.exe self-test`、`CAgentVirtualDisplay.exe probe`。本机已通过 C# x64 构建、9 类 ABI/空状态/拓扑断言及真实只读屏幕查询；TypeScript 平台/确认/任务 ID/并发/不盲重试测试与现有 desktop-capability 测试通过，`tsc --noEmit` 通过。非管理员读取安装记录返回明确的 `ADMINISTRATOR_REQUIRED`，不会把无法读取伪装成没有安装。

## 平台范围

候选仅针对 Windows 10/11 x64；检测脚本将客户端 build >=19041 标为候选，并不代表通过功能验收。ARM64、32 位、macOS、Linux 均不适用此附件。

Windows Server 2022 仅实验候选，不能承诺可用；上游有未解决的 [无头 D3D 创建设备失败 #416](https://github.com/VirtualDrivers/Virtual-Display-Driver/issues/416) 与 [无 GPU 驱动重启 #354](https://github.com/VirtualDrivers/Virtual-Display-Driver/issues/354)。[IddCx 版本表](https://github.com/VirtualDrivers/Virtual-Display-Driver/wiki/IddCx-Info) 也不等于真实硬件兼容验证。

[SetDisplayConfig](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setdisplayconfig) 管理已有路径，不能通用地创建虚拟显示适配器；通用纯无头支持仍需 [IddCx 驱动](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/indirect-display-driver-model-overview) 或目标机器已有的虚拟显示硬件。


### 2026-10-30 安装前检查补充

安装计划现在读取原生预检：管理员状态、CAgent 所属会话是否为 console、输入桌面可访问性及显示拓扑。缺少或旧版辅助程序一律不可执行；执行前及原生安装入口再次检查，避免计划生成后会话改变。预检不安装驱动、不切换会话、不解锁，也不证明已经能采集首帧。RDP 已断开时先恢复原用户会话，虚拟显示不能替代会话恢复。

系统桌面服务状态比较当前包与 Program Files 中 broker、worker 的 SHA-256；不一致或文件缺失不再显示就绪，需显式更新系统桌面服务。主程序升级不能自动当作受保护系统服务已更新。
