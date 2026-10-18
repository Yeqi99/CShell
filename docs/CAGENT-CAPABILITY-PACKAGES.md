# cagent 应用能力包基础

2026-10-17：本模块是应用能力包的清单验证和生命周期基础，尚未接入 cagent 运行时或应用市场 UI。不能据此宣称微信、Clash、自研远控已可在 cagent 安装使用。

## 当前缺口与本次范围

现有 `src/agent/applications.ts` 提供已知系统包管理器的目录、检查、安装计划与执行；它不负责应用的智能体工具包装。`docs/CAGENT.md` 中的长期契约要求把系统软件、配置、包装器和工具授权分开。

本次新增：

- `src/shared/agent-capability-packages.ts`：协议 1 声明式清单、版本范围和状态类型。
- `src/agent/capability-packages.ts`：可信清单摘要核验、本地文件核验、可信适配器主机接口和生命周期。
- `tests/agent-capability-packages.test.ts`：8 项隔离测试，未下载或执行外部软件。

## 清单与来源

清单只描述 ID、名称、版本、MIT 许可证、GitHub 仓库及对应 release 附件、平台、架构、cagent 版本区间、可选系统应用版本区间、文件大小及 SHA-256、适配器 ID、权限、工具与事件契约。工具包含完整输入输出 object schema、说明、权限与副作用标记；事件包含 payload schema 与权限。

版本范围采用 `min`（包含）与 `maxExclusive`（不包含），版本为明确三段数字，不猜测预发布版本或任意 semver 表达式。清单未知顶层字段会被拒绝，没有渲染脚本、任意安装命令或动态模块加载入口。

`parseCapabilityManifest(raw, expectedSha256)` 验证原始 UTF-8 清单内容的精确摘要；期望摘要必须来自主程序信任的目录或明确核验流程，不能从同一个未知包里取一个自报摘要充当来源认证。GitHub URL 绑定仓库、tag 与单个附件名，禁止跳转到任意外站。摘要校验不是代码签名，也不证明发布者可信；本模块未实现远端下载、签名链或 release 上传。

`verifyCapabilityFiles(root, manifest)` 检查清单文件的大小、SHA-256、相对路径边界和符号链接，拒绝路径穿越、Windows ADS、保留设备名与大小写重名。读取中再次核对文件状态。主机应使用自己管理、其他进程不可写的暂存目录，解包前另行做 zip-slip 与展开大小检查，并在启动适配器前完成最终验证。同用户恶意进程修改文件不属于该检查提供的安全隔离；本模块也不执行包中的任何文件。

## 可信主机接口

`new CapabilityPackages(host)` 后先 `await init()`，可调用 `list / stage / refresh / setPermissions / uninstall`。

Host 提供实际环境、已实现适配器查询、依赖与配置检查、工具注册、阻止新调用、停止任务及订阅、撤销注册，以及现有加密 Vault 的 load/save。`adapterId` 必须映射到主程序已经实现并信任的适配器；未知适配器直接显示“不兼容”，不创建占位工具。

`stage` 只接受已经准备好的本地文件和可信摘要，不安装系统应用。它不会自动新增授权。首次 grant 为空；升级只保留旧 grant 与新清单权限的交集，新增权限仍关闭。`setPermissions` 只供明确的本机权限保存处理程序调用，不作为模型自动授权工具。运行时仍须在每次工具调用、事件发布时复核权限和目标身份，不能仅依靠注册时检查。

## 状态与卸载

| 状态 | 含义 |
| --- | --- |
| `not-installed` | 系统依赖未安装，需要独立安装计划与授权 |
| `not-configured` | 配置未完成、重启待检查或注册尚未完成 |
| `authorization-required` | 已检查依赖和配置，但工具/事件权限不足 |
| `available` | 文件、平台、版本、配置、授权与真实适配器注册均成功 |
| `incompatible` | 平台/架构/版本不符或主机未实现适配器 |
| `fault` | 检查、持久化、注册、停止或清理失败 |

初始化不会自动恢复“可用”或重新运行任务；需要 `refresh` 检查真实环境。升级、撤权、刷新和卸载先调用 `quiesce` 阻止新调用，再停止任务/订阅，最后 `unregister`。任何停止失败都保留故障记录，不继续宣称卸载成功。适配器实现应保证这些操作幂等，并对自身停止和外部进程等待设置期限。

卸载本模块记录不会卸载用户的系统软件、删除配置秘密或用户文件；这些需要另一份明确的删除计划。若主程序在保存或执行结果未知时崩溃，不得自动重新执行系统安装或其他副作用。

## 已验证与未完成

8 项测试覆盖来源和摘要、路径非法输入、文件篡改、安装/配置/授权分离、兼容性、升级权限交集、重启状态、卸载顺序和部分注册失败清理。测试只调用隔离的 Host fixture，没有声明任何真实应用可用。

待主程序集成：GitHub 目录信任根与下载/解包、Vault、原子目录切换、实际工具注册表及逐次权限复核、运行中适配器进程隔离和退出期限、事件来源注册、配置 UI、安装/卸载计划、实际 Windows/macOS/Linux 包构建验收。微信、Clash、远控仍各自需要完整适配器；现有 CShell 微信扩展不等于 cagent 能力包。

## 本机目录与运行时接入模块

后续实现新增 `capability-catalog.ts`、`capability-installer.ts`、`capability-runtime.ts`，提供真正落盘、核验、注册和卸载的本机能力包流程。`CapabilityRuntime` 使用现有加密 `ClientVault` 保存记录，重启后重新检查文件与兼容性才恢复原有授权下的工具；退出不会清空用户保存的授权。

首包 `cagent.system-apps` 随运行时内置，安装后只是核验声明与 NOTICE 文件，不下载第三方程序。工具委托现有 `AgentApplicationService` 的目录、计划、状态、安装和取消接口。它的 `applications.read / applications.plan / applications.install` 与系统安装服务的 `enabled/controllers` 分开；仅授权 read 时只注册目录和状态工具，安装工具仍拒绝。具有至少一个已授权具体能力时包可显示“可用”，不表示所有权限已开放。模型调用仍需在主机层对 `sideEffect` 执行人工审核。

当前没有宣称该内置包的 GitHub release 附件已经上传；清单的 release 地址是发布来源约定，目录标记 `source: bundled`，本地安装不访问它。当前目录没有未发布的外部下载项。

外部包格式为带 `protocol/manifest/files` 的单个 JSON，文件以 base64 编码，拒绝清单以外文件，避免 ZIP 解压与任意启动脚本。显式 `install({id,confirm:true})` 只能选择可信目录内的 ID。下载最多 64 MiB、120 秒，精确检查目录给出的 bundle 字节数和 SHA-256，然后核验清单摘要及每个文件；只接受 GitHub release 地址和一次 `release-assets.githubusercontent.com` 签名附件跳转。包内文件不会被动态 import，能力只能由已实现可信 adapter 提供。

`extraPackages` 可注入主机已实现的 adapter 与 `createBundledCapabilityEntry(manifest,files)` 生成的本地包。例如只有发现真实编译的原生 helper 后，主程序才应提供远控包；安装不能顺带开放监听端口。adapter 的 `register/quiesce/stop/unregister` 管理真实资源，`invoke` 获得调用方和取消信号。运行时严格匹配工具 ID，校验其 JSON schema，并在执行时再次检查已注册权限，最多 8 个并发调用。

新增三项运行时测试验证实际临时目录安装文件、Vault 与重启恢复、只读授权、停止后拒绝调用、真实适配器 fixture 的取消顺序，以及受控下载 fixture 的摘要/路径/跳转拒绝。合计 11 项测试通过；未安装真实系统软件，也未访问用户微信或网络控制服务。真实运行时路由、原生市场 UI 和额外远控包由主程序集成；这组测试不能代替实际第三方应用验收。

运行时已接入 `packages.catalog/list/tools/invoke/install/grant/uninstall/refresh`，本机应用网关使用相同白名单。安装、授权、卸载与刷新仅允许本机；远端调用和元数据读取必须具有已有管理授权，调用期间持续复核。智能体通过动态 `capability_call` 获取当前真实工具契约，具体工具的副作用始终需要本机批准，并在批准后重新核对工具与授权；模型不能通过此入口安装能力包或授予权限。

系统安装任务的能力包卸载使用内部 `cancelAndWait`：核对任务 owner，即使原授权已撤销也可清理其已拥有任务，等待真实子进程 close 后才撤销注册。10 秒仍未退出则报告失败并保留故障记录，不宣称卸载已完成。该清理方法不对远程或模型开放。新增隔离子进程测试和动态模型审批/撤权测试已通过。
