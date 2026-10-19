# 通用 API / MCP 实施与验收状态

更新时间：2026-10-15。接口说明见 [API.md](API.md)。此文件以当前代码与实际验证为准，不把历史增量检查点当作交付结果。

## 覆盖矩阵

| 能力 | 共用服务 | 外部 API 与 MCP | 边界 |
| --- | --- | --- | --- |
| 保存的 SSH / Agent 连接 | Store、ConnectionManager、Provider Registry | 授权列表、连接、断开、目标描述 | API 会话独占；不接管用户终端 |
| 本机 CMD / PowerShell / WSL | LocalTerminalProvider | 独立本机范围、实际目标发现、终端连接 | WSL 需插件及真实发行版；不借用主机文件能力 |
| 终端 | 各真实 Provider | 字节游标输出、缺口、输入序号、resize | 非屏幕快照；输入提交不等于命令成功 |
| SSH 命令与监控 | RemoteJobs / SshService | 同步、异步任务、真实指标 | 任意命令冲突不能靠字符串推断；终止不保证杀死后代 |
| SSH 文件 | 共享 SFTP | 分页目录、文本读取、字节续读、独占创建、条件分块修改、单级目录创建、普通文件重命名与删除、目录树检查/移动/删除 | 元数据条件是 best effort；非原子发布；目录创建、重命名与删除分别授权 |
| 本机文件 | LocalFiles / ApiLocalFiles | 独立根目录、分页/分块读取、stat、逐项授权的异步普通文件变更与单级目录操作 | 旧根只读；32 KiB 写入、metadata revision、多路径冲突域；独立目录树移动与分块组合复制；非整树事务，路径检查不是 OS 沙箱 |
| Agent 管理 / HTTP 托管 / 中继 | 原生 Agent 协议 | 按实际 Provider 工具与独立能力授权 | 不宣称 Agent 具有 SSH SFTP 能力 |
| HTTP 工作区 | HttpWorkspaces | 请求与历史、实际发送方、同步/异步发送 | 工作区与发送目标双重授权；断线不回退本机 |
| Docker | 共享 DockerService | 快照、详情、统计、操作 | 插件显式启用；绑定 SSH Unix socket |
| Conda / 应用安装 | 共享 EnvironmentService / ApplicationService | 环境、包、修改、目录、计划、安装 | 独立通道；安装计划绑定会话；不自动提权 |
| 环境终端 / Jupyter | 共享 EnvironmentService / SshService | 自有父会话创建 Conda 终端；Jupyter 状态、启动与停止 | 不接管桌面实例，不导出 token/URL；终端环境不冒充主机文件环境 |
| Python | 共享语义分析 / PythonFiles | 实际解释器分析、文件读取与条件保存 | Python 插件；保存需明确接受非原子 CAS 限制 |
| 插件 | 共享 PluginService | 安装状态、内置管理、目录验证、下载校验 | 应用级授权；外部包仅支持已实现贡献点；不扩大机器授权 |
| 异步任务 | ApiTasks | 归属、幂等、状态、事件续读、取消、释放 | 进程内有限保留；不支持重启恢复，不自动重放 |

## 授权、并发与披露

服务与新能力默认关闭。后端保管凭据，根令牌和命名客户端独立授权。应用能力、保存连接、本机环境、目标覆盖与审核策略分别处理；目标覆盖不扩大允许列表。执行前及审批后复核，配置变化撤销 API 自有连接，保留桌面会话。插件排队写入在出队时检查取消。审计有界、执行前必须落盘；失败关闭入口，执行后落盘失败报告未知结果。

内置 AI、AI HTTP 工作区与 API/MCP 的应用能力、机器/组/本机环境范围及目标操作覆盖，统一使用 connections/authorization.ts 的 CallerPolicy 与判断函数。旧存储通过只读适配接入，保持独立调用方授权，不合并令牌权限；空覆盖仍拒绝，AI 重复覆盖保留历史首项语义，API 命令布尔授权不新增其他能力。本机环境必须显式允许；目录展示判断不能用于执行。权限视图只用于当前同步判断，不作为审批缓存。17 项权限、AI、HTTP、MCP、真实 ConPTY 和扩展回归通过，构建通过（test-results/api-shared-authorization.log、api-shared-authorization-build.log）。

旧 list_files / monitor 已补齐全提示审核，拒绝后不读取；审批后与读取完成后均复核权限、连接与配置代次，迟到批准不能恢复撤权。相关拒绝、审批期间配置撤权、原生 Agent、审计背压集成回归 3/3 通过（test-results/api-read-review.log），构建通过（test-results/api-read-review-build.log）。隔离测试数据的 Electron 启停、握手、设置保存、草稿、重启和二次启动唤起均通过（test-results/api-read-review-desktop.log）。此修复尚未替换当前运行的本机安装实例。

统一注册表同时服务原生版本化 API、旧 MCP 入口与渐进发现。名称/摘要/契约/指南只改变信息粒度。先授权过滤再搜索/计数/分页，游标绑定身份与目录修订；预算不足明确报错，不截断 schema。插件状态变化也使连接目录失效。

各级目录新增每项契约 version：客户端可读取完整 names 索引，对比版本后只获取变化项契约，并移除消失项。版本不代替权限，授权变化仍改变目录 revision；不得拼接不同修订的分页。变更、撤权、跨级版本一致性、分页和真实 MCP/HTTP 集成测试 16/16 通过，构建通过（test-results/api-version-regression.log、api-version-build.log）。带多余段的游标明确拒绝。

调度全局 16 / 客户端 4 / 目标 4，队列 64 / 客户端 16，按客户端公平轮转，独立目标并行，声明冲突域的操作串行。连接 32 / 客户端 8。任务控制留独立容量，事件、终端环形缓存、结果与审计均有界；慢读者获得明确 gap。幂等键绑定客户端和参数，在有限保留期内有效；释放结果不删除去重记录。

文件冲突域已统一消除 `.` 和重复分隔符，创建、分块写入及 Python 保存共享该规则；保留 `..` 的远端符号链接语义，不改变实际操作路径。`api-path-conflicts.log` 的 9 项测试覆盖跨调用方同文件等待、独立文件/目标并行和文件/扩展回归。远端链接、大小写及相对/绝对别名身份尚未统一，不能声称全部文件别名已安全协调。该改动尚未更新到已运行的本机应用。

权限热路径只在一次同步判断内复用配置副本，不跨审批或异步边界缓存授权。连接目录过滤改用本次调用的授权 ID 集合，避免每个服务器重复复制全部客户端权限。`api-policy-read-regression.log` 的 6 项协议/权限回归通过，包含增加 1,000 条未授权连接后权限读取次数保持有界且无目录泄露的检查，以及既有撤权、审批、HTTP 和扩展范围测试；`api-policy-read-build.log` 构建通过。此改动尚未安装，不能仅凭减少复制次数声称吞吐验收达标。

该改动后的无采样混合复测保存于 `test-results/api-policy-read-benchmark.json`：三轮 17.63 / 19.80 / 27.11 次/秒，p95 1088.53 / 990.40 / 691.89 ms，事件循环 p99 39.29 / 32.98 / 25.51 ms，结束后连接数 [0,0]。结果进一步低于历史基线，性能验收失败，不能宣称本次优化提升整体吞吐。运行期间发现多个其他 Node 进程，但没有同机资源竞争的定量对照，不能据此归因；未终止这些进程或用户应用。下一步须隔离测量应用执行、审计落盘、网络夹具及机器负载的耗时来源。

已增加仅用于独立测试实例的分阶段诊断：`CSHELL_BENCH_STAGES=1 pnpm exec tsx scripts/api-protocol-benchmark.ts`，单独写入 `test-results/api-protocol-stages.json`，不覆盖无钩子基线。测量调度等待、含权限复核的 Provider 执行、含排队与文件系统的审计等待；这些时段相互重叠，不能求和冒充总墙钟时间。三轮诊断吞吐 101.98 / 98.94 / 111.38 次/秒，p95 156.91 / 169.30 / 143.59 ms；审计 attempt p95 41.54–49.14 ms，result p95 40.08–43.66 ms，调度等待 p95 52.66–63.53 ms，Provider 各操作 p95 7.08–24.87 ms。未改变生产授权、审计或调度逻辑。

紧接着的无钩子对照 `test-results/api-stage-control.json` 为 99.29 / 91.09 / 86.33 次/秒，p95 158.53 / 182.03 / 239.43 ms，两次测量均结束于 [0,0] 连接。无需生产代码变化即出现明显恢复，说明上轮极慢结果不稳定，尚不能确定根因；第三轮尾延迟仍高于历史范围，不能宣布完整性能验收通过。此后应优先补齐剩余功能及终端响应验收，避免用重复跑同一基准替代交付。

## 已取得的验证证据

- 完整串行回归：146/146，通过；日志 `test-results/final-api-regression.log`。
- 后续 Python / 插件撤权增量：4/4，通过；日志 `test-results/final-extensions.log`。插件目录下载取消改动和真实 MCP 回归已通过；后续 3 项出口回归也通过。
- 工作台全回归通过：SSH 终端、文件传输、监控、插件/环境/Python、草稿、主题、分组、布局与窗口；`test-results/final-workbench.log`。
- 真实 Electron MCP 启停、端口绑定、复制令牌、协议握手、跨分类草稿、重启持久化、窗口唤起通过；`test-results/final-api-desktop.log`。
- 元数据 API 负载下界面帧检查：4 路并发、120 次带审计 list_servers，帧间隔 p95 空载 16.9 ms / 负载 16.8 ms；`test-results/api-desktop-frames.json`。这不是远端终端输入延迟测试。
- 真实 SSH/SFTP 协议夹具、3 客户端、2 目标、审计落盘、852 次预热与混合调用完成。最新无采样复测三轮吞吐 65.8–69.6 次/秒，p95 255.8–385.1 ms，关闭后连接数 [0,0]；test-results/api-shared-authorization-unprofiled.json。低于先前记录的 88.7–105.5 次/秒，尚不能声称性能验收通过。静态列表输出 schema 已移至启动时转换，未减少权限复核或审计。
- 后续 CPU 采样见 test-results/api-shared-authorization.cpuprofile.summary.json：样本包括启动、网络客户端、SSH/SFTP 服务器、空闲及采样自身开销；writeBuffer、密钥准备和 Zod 初始化均出现，不能据此把吞吐差异归因于某一权限函数。采样运行覆盖了 api-protocol-benchmark.json，故性能比较使用上面的无采样副本；不可外推公网或真实多机性能。
- 追加每项契约版本后的 200 能力本机合成目录基线：names 24,958 B / 2 页，summary 47,962 B / 2 页，contract 131,317 B / 5 页，guide 146,702 B / 5 页；详见 test-results/api-foundation-benchmark.json。该测量不代表网络或远端吞吐；版本字段增加初始索引体积，使客户端能按项刷新契约。
- 原生 Windows ConPTY API 测试通过；node-pty 关闭辅助进程偶有 AttachConsole stderr，不能声称已消除所有原生清理告警。
- 构建通过；保留既有大 chunk 提示。Windows 安装包生成成功（按项目配置未签名，已计算 SHA-256）。打包应用使用仓库既有测试启动门控后，MCP、持久化、重启及二次启动唤起均通过；见 final-packaged-desktop-gated.log。

## 尚未满足的完整范围

以下不是可用占位工具：单调用本机目录树复制、通用原子替换、Jupyter 内容访问外部接口仍未接通。Agent 管理/中继/托管逐方法返回契约已接入，其他 Provider 指南仍需最终逐项核对。AI 与外部调用已共用后端范围、能力和审核判断，存储格式及生命周期策略仍有差异，尚未完成全配置模型收口。

本机只读出口已接通 local_file_roots / local_files_list / local_file_read。根调用方与命名客户端分别通过原生目录选择并保存授权，默认空；API 只能得到根 ID/名称及相对路径，不能自行选择根或继承桌面/终端范围。保存目录设备/文件身份，拒绝观察到的链接与 junction，读取前后及审批后复核权限，配置变更清空分页状态。每块最多 64 KiB，目录每页最多 200 项/64 KiB，扫描最多 50,000 项；元数据 revision 不构成原子快照，外部恶意路径替换不是用户态路径检查能保证隔离的场景。10/10 API/核心/协议回归通过（api-local-file-regression.log）；新增真实 MCP SDK 读取、完整输入契约、跨调用方根/游标拒绝、链接拒绝及撤权测试通过（api-local-file-mcp.log）。构建通过（api-local-file-final-build.log）。隔离 Electron 的目录选择 IPC、设置保存、真实 API 读取、UI 撤权、协议握手、服务启停、草稿和重启持久化全部通过（api-local-file-desktop-retry.log）。原生选择与批准对话框在隔离实例中注入了测试答复，未自动操作用户实例。首轮二次启动超过 10 秒失败；测试窗口放宽到 30 秒后通过，不声称启动性能改善。尚未安装。

普通文件 `rename_file` / `delete_file` 已使用真实 SFTP 接通，分别要求新增且默认关闭的 `files.rename` / `files.delete`。都要求准确路径的读取 revision 和显式 acceptNonAtomic；拒绝非普通文件，保留外部替换竞态限制。调度器支持最多 8 个冲突域的同步全有或全无预约，重命名同时覆盖源和目标，避免反向顺序死锁及部分持锁等待。取消和失败释放全部预约；不减少权限复核或审计。`api-file-mutations-regression.log` 25/25 通过，包含真实 MCP 重命名、真实 SFTP 删除、过期版本/链接拒绝、取消、多锁竞争及任务回归。夹具 LSTAT 已修正为真实 lstat，而非跟随链接的 stat。新增能力仍未安装到运行中的应用。

Python 分析/文件读写、环境列表/包/动作、应用列表/计划/安装和 Docker 清单/详情/指标/动作，共 13 个扩展入口已声明严格 JSON 输出契约和完整指南示例，复用同一 Provider 注册表运行时验证。计划输出包含绑定 sessionId 与过期时间；安装/环境动作返回实际任务状态，output 明确为有界尾部而非完整记录。示例中的解释器、文件 revision、计划 ID、容器 ID 明确要求替换为当前目标实际发现值。`api-extension-contracts.log` 8/8 回归通过（真实 SSH 扩展与 Docker 协议返回、示例输入校验、结果契约拒绝及既有权限隔离）；`api-extension-contracts-build.log` 构建通过。尚未更新本机运行实例。

已接通 SSH 单级目录创建 `create_directory`，新增独立且默认关闭的 `directories.create` 授权，根调用方、命名客户端及按目标覆盖均可配置；旧文件创建授权不扩大。沿用真实 SFTP、路径冲突域、审核、执行前复核、任务幂等机制及共享注册表输入输出契约。取消后确认及模糊失败返回未知结果，不自动重试或清理。`api-mkdir-regression.log` 8/8 通过（含真实协议调用、已有目录不冒充新建、取消及独立权限）；`api-mkdir-build.log` 构建通过。尚未安装到用户当前运行实例。

已补齐 list_servers_page，保留旧列表兼容入口；授权过滤后搜索、计数和预算分页，游标绑定调用方、授权和可见内容。连接、文件列表、监控、命令、终端、任务及连接描述的出口补充运行时输出校验。新增分页单测及真实 MCP/HTTP 回归通过，SSH、原生 Agent、HTTP、ConPTY 和扩展五项集成回归通过；增量构建见 test-results/api-directory-build.log。此增量晚于下述本机安装，尚未替换正在运行的安装实例。

没有持久任务恢复、原子文件 CAS、任意远端后代进程必杀等保证。真实多物理机器混合负载、桌面终端输入延迟与全部平台/Provider 的长时泄漏验收尚未完成。用户正常退出后已安装到 D:/Program Files/CShell，安装器退出码 0；安装后的 exe 与 app.asar SHA-256 均与测试构建一致，已主动打开，主窗口有有效句柄且 Responding=True。自动化不得因阶段测试通过而标记全部完成。

本机更新：2026-10-14，安装包 SHA-256 F24876AC1C2CE8AE7646567722828B6F06D1ED5696AFFEDE4F999E766A538916；旧 exe/asar 备份位于 test-results/installed-before-api-*。未发布到 GitHub。下载完成后撤权的附加测试 2/2 通过，见 final-plugin-revocation.log。

本机安装后的真实 Codex CShell MCP 连接器已完成 names 发现调用，返回 12 项当前授权入口、目录修订与 null 末页游标。未执行远端命令或扩大权限。分页与输出契约增量的独立回归 5/5 通过，日志 test-results/api-directory-regression.log。

插件目录、下载、状态列表和管理四项应用工具已补充真实 JSON 输出契约；状态/管理/目录指南使用实际清单与可信 URL。3/3 扩展与插件撤权测试通过（api-plugin-contracts-final.log），包含示例输入校验与真实列表输出校验。下载必须使用已验证目录的完整 entry，不猜摘要。此增量尚未安装。

Jupyter 外部生命周期已接通 environment_jupyter_status/start/stop，绑定 API 自有 SSH 会话和明确解释器，复用桌面 EnvironmentService。API 仅返回 readiness/远端端口，不返回 token 或隧道 URL，不接管桌面或外部 Jupyter；浏览器/内容访问接口尚未提供。启动可取消并受 45 秒总期限约束，16 个全局/每会话 4 个实例、每实例 16 个转发连接；停止覆盖启动中状态，迟到的通道立即关闭，旧清理回调不能删除重启后的记录。插件禁用/移除清理 Jupyter，断连关闭所属隧道。远端 TERM/关闭通道不保证全部后代退出，不宣称持久恢复。3/3 共享服务回归通过（api-jupyter-regression.log），含启动取消后重启、相同端口重复调用、不同端口冲突与真实转发；真实 API 的启动/状态/停止、跨目标授权拒绝及结果无 token 检查通过（api-jupyter-protocol.log）。环境终端外部出口、目录树变更、全模型收口、最终性能/桌面验收及本机更新仍未完成。

环境终端已复用 EnvironmentService.openTerminal 接入 connect 的可选 environment 参数。必须是同调用方、同 profile 的自有 SSH 父会话，实际 Conda 环境需检查通过，并同时具备 environments.read 与 terminal.input；审核后再次复核。子通道在首个输出前绑定 API 归属与 Provider，30 秒启动期限及取消会清理迟到通道。共享原有每客户端/全局连接额度；关闭子终端保留父连接，父连接断开关闭子通道。describe_connection 的 terminalEnvironment 明确记录父会话、conda 和 prefix，只有交互终端属于该 Conda 环境，文件/监控仍是 SSH 主机。5/5 目标隔离、早期输出归属与 Provider 回归通过（api-env-terminal-final.log）。剩余目录树变更、全模型收口、最终负载与桌面验收及安全更新仍未完成。

SFTP 目录树已增加 directory_tree_inspect 与 directory_tree_mutate（独立默认关闭的 directories.manage）。仅绝对非根路径、无点段，检查最多 1000 项/32 层，拒绝观察到的链接/特殊文件；先检查 metadata revision，再标准 rename 到不存在且不重叠的路径，或逐项由叶到根永久删除。删除取消/失败可能部分完成，返回 OUTCOME_UNKNOWN 和已确认数量，不自动重试或回滚。调度器树域与词法子路径文件域冲突，兄弟路径/其他目标可并发；相对/绝对别名、硬链接及外部进程竞态仍不保证原子隔离。7/7 真实 SFTP、跨调用方树锁、多域锁及 MCP 回归通过（api-tree-regression.log），追加真实删除中取消只提交一次、不伪称回滚测试通过（api-tree-partial.log）。测试夹具补齐 LSTAT 链接 mode。构建通过（api-tree-build.log）。最新源码尚未安装；完整模型收口和最终性能/桌面验收仍未完成。

包含本机文件、Jupyter、环境终端和目录树的当前源码全量串行回归 166/166 通过（api-complete-source-regression.log，249287 ms）；不是最终真实多机性能验收，也不表示已更新本机。

## 当前收尾清单（以前文增量记录为历史证据）

- [x] 本机只读根目录授权出口、SSH 文件与目录树变更、环境终端及 Jupyter 所有权生命周期。
- [x] AI/API 共用权限判断和审核决策；保留旧存储字段，通过只读适配器解释，不迁移或扩大授权。
- [x] API 设置草稿使用内容 revision 条件保存。桌面 IPC 必须携带打开草稿时的 revision；检查位于串行配置事务内，过期草稿拒绝且不重启服务，不覆盖最新权限。此 revision 仅描述 API 设置，不声称全应用配置已支持条件保存。
- [ ] 全应用配置/生命周期模型剩余差异、剩余 Provider 指南及本机写入范围核对。
- [ ] 最终混合负载、撤权、桌面终端输入响应验收；真实多物理机器与长期泄漏测试仍没有证据。
- [x] 本轮最新构建已安全安装并打开（见末尾 2026-10-15 安装证据）；后续若继续修改，需再次验证和安全更新，不能强杀已打开的会话。

审核及配置增量验证：api-config-review-tests.log 5/5 通过，涵盖相同基线的并发配置只能一项成功、拒绝过期权限覆盖、落盘重载，以及 AI/API 三种审核模式等价且不授予能力。api-shared-review.log 的 AI 与真实 MCP 集成均通过；该轮新增审核单测因测试数据缺必填字段失败，已修正并在上述 5/5 中通过，不能把初轮报告称作全绿。api-shared-policy-build.log 构建通过。桌面复测另见 api-policy-desktop.log，未完成前不视为验收通过。

审核/设置条件保存后的隔离桌面验收最终通过：api-policy-desktop-diagnostic.log 包含真实 IPC 保存、API/MCP 握手、目录授权读取/撤销、服务启停、跨分类草稿、错误/重试、重启持久化和第二进程显示窗口。前两次在首次保存后等待面板关闭超过 15 秒失败（api-policy-desktop.log、api-policy-desktop-retry.log），没有错误提示；增加失败现场诊断后复测通过，不能据此宣称消除了偶发慢响应。最终类型检查通过。用户运行实例未替换，未强制结束。

Agent 外部管理/中继输入从任意 params 改为按 method 的具体契约，复用中继与 WSL 网络配置 schema，保留禁止秘密导出的操作范围。新增契约完整性测试核对所有实际导出 method、缺参数/缺确认拒绝与凭据出口排除；api-agent-inputs.log 1/1 通过，api-agent-contract-regression.log 6/6 原生 TLS/管理/撤权/真实 MCP 通过。Agent 命令补充实际 JSON 输出校验，SSH 文件写入/命令/监控/兼容读取补充指南；api-provider-final-contracts.log 6/6 通过。最新构建 api-provider-final-build.log 通过。一次打包前 Vite 子进程以 3221226356 异常退出，顺序重跑恢复（api-agent-input-build-retry.log），没有把异常归因于未经证实的原因。

新增实际桌面终端响应测试脚本 api-terminal-response.ts：隔离 Electron 原生窗口，真实 SSH 夹具回显，4 个审计 API 并发工作混合元数据与 SFTP；16 个键盘输入样本，基线 p95 166.94 ms，负载 p95 215.83 ms，期间完成 71 次调用，低于事先定义的 max(250 ms, 基线 p95×3) 门限。包括 Playwright 开销，不等于网络 RTT 或真实多机保证。结果 api-desktop-terminal-response.json；api-terminal-response-retry.log 通过。初版调用了错误的直接工具名和占用中的默认端口，已改为 invoke_connection 与独立空闲端口。

全工作台增量回归首轮到新测项前均通过，第二轮在既有 Python 环境选择等待超时，当前重跑日志 api-final-workbench-latest.log；不能将失败轮当作完整验收通过。源码尚未安装。

最新完整工作台回归已通过（api-final-workbench-latest.log，退出码 0）：包含新增真实终端输入负载、文件传输、监控、插件、环境、编辑器、设置、MCP、重启与布局保持。该轮终端负载覆盖 75 次 API 请求，基线 p95 149.16 ms、负载 p95 214.72 ms；api-desktop-terminal-response.json 当前保存这一轮，前述 166.94/215.83 ms 是独立定向运行的历史读数。全部 SSH 指南示例输入校验 4/4 通过（api-provider-examples.log）。完整源码回归与最终安装包正在生成，结果未出前不视为通过。


## 2026-10-15 本轮安装交付（不等于完整范围完成）

当前完整源码 169/169 测试通过，334335 ms，见 api-final-source-suite.log。完整桌面工作台通过 api-final-workbench-latest.log；安装包中的 MCP、持久化、错误重试、重启与二次启动通过 api-final-packaged-mcp.log。pnpm dist 成功，未签名（项目配置），未发布 GitHub。安装前确认没有 CShell 进程；安装器退出码 0，备份 installed-before-api-final-20261015-013434。安装包 SHA256 EC994131D58CA84E6D858B367D0E39BA978D11A7696D583E625039046BD54FBA。

D:/Program Files/CShell 的 exe 与 app.asar 均和测试构建哈希一致，见 api-final-installed-hashes.json：exe 1E5092B5DDED579AF1BA9A261E4AC8A8508E3C9C8D1E9BB62ED9D2ACE0534975，asar 41C0004B631BBB92833D8EB173E656D330FE46C73E17981746788B2C92F1C962。已主动打开，主进程 43536、窗口句柄 50072342、Responding=True。真实 Codex MCP 连接器 names 发现成功，当前授权 13 项，包含新 list_servers_page；未扩大权限或调用远端命令。此前所有“尚未安装”段落仅为历史状态。

自动化已更新为从本次交付继续，不再反复实现/安装已完成内容；保留尚未完成的本机写入独立授权、剩余完整 Provider 契约/生命周期及真实多机/长期验收范围。全部完成前不能停止为已交付。

## 2026-10-15 本机修改出口及 Agent 返回契约（本轮源码，尚未安装）

本机根目录新增独立 create/write/rename/delete/mkdir/rmdir 授权，旧记录和新选根保持只读；设置中按根逐项启用。local_file_stat 提供 metadata revision；local_file_task_start 使用现有有界任务、幂等记录、归属、取消与审计，按绝对路径协调重叠授权根和多个路径。写入最多 32 KiB，不稀疏写入、不隐式截断；rename/delete 仅普通文件，rmdir 仅空目录。授权变化在审批后与 IO 前后复核；未知副作用不回滚、不盲重试。外部进程与硬链接仍不受词法锁保护。目录树复制/重命名尚未提供外部出口。

验证 api-local-mutations-tests.log 4/4：真实 HTTP 调用完成六类变更、幂等去重/冲突、客户端隔离、过期 revision 拒绝、审批撤权未创建文件、路径校验、稀疏写入拒绝、重叠根锁身份，以及配置/树锁回归。api-local-mutations-mcp.log 增加真实 MCP SDK 调用同一变更任务，确认跨协议幂等不重复执行。api-local-mutations-build.log 构建通过；api-local-mutations-desktop.log 隔离原生工作台授权默认值、保存、真实握手/读取与重启通过。

Agent 管理/托管/中继增加逐方法返回 schema 与执行后的验证；hosting.remove 的无返回值统一成 JSON null，client.info 保留 JSON 字符串兼容格式。反向中继 schema 禁止 credential。api-agent-outputs-tests.log 8/8，含真实 TLS 原生 Agent、实际状态结果、旧授权、托管 revision、撤权与 MCP。指南已明确 API 设置、WSL、托管、中继及环境的配置/恢复差异，中继仍没有 revision 条件保存，不能宣称所有配置具备 CAS。

当前全量源码回归 api-local-output-full-suite.log、打包 api-local-output-package.log 运行中，尚不能视为通过。本机用户实例 PID 43536 仍在运行，未结束或替换。已询问真实多物理机器测试目标及临时目录/断连撤权范围，未收到回答；不得以回环夹具替代该验收。

最新收尾结果：api-local-output-full-suite.log 全量 171/171 通过（210000.7212 ms）。日志包含 node-pty 子辅助进程 AttachConsole failed 输出，但该轮测试退出 0；不据此宣称所有 ConPTY 辅助进程竞态均消除。随后修复“本机变更已完成但收尾复核失败”必须返回 OUTCOME_UNKNOWN 的时序，api-local-completion-tests.log 2/2 通过，api-local-partial-cancel.log 验证创建后取消保留真实部分副作用且不回滚。Agent 输出契约预算检查 api-agent-output-budget.log 通过。

最终 pnpm dist 通过 api-local-completion-package.log；最终打包后的真实 MCP/桌面设置/重启验证 api-local-completion-packaged-mcp.log 退出 0。最终 installer SHA256 7334A3A5D8F161DD91CE64A11494A53FAA41B17965C6639517BFE5C32349B448，exe 97FA7575242C5984AB0E51EE46A6D3A6FD278AB69A3F6EF1EC50FB86E5979C47，asar A4689A3DB1C9408736FF4EFDD35069D29F28DB8ABB1B8467945E365FC215C8A3，见 api-local-completion-hashes.json。前一个 api-local-output-package.log 安装包已被最后时序修复后的构建取代。

尚未安装：再次确认 D:/Program Files/CShell 的用户主实例 PID 43536 仍打开，已请求保存并正常退出，未强杀、未复用旧退出确认。最终多物理机器/长时压力验收已询问至少两个已保存真实连接名称、可用临时目录与断连/撤权范围，尚待用户提供。剩余独立代码核对包括本机目录树复制/重命名外部出口、配置 CAS/生命周期差异；不能把这些未完成项写作已交付，不能重复实现上述已完成写入和契约。

## 本机目录树与中继配置条件保存增量

新增独立 renameDirectory 根授权，不继承文件 rename；旧根记录不扩权。目录 stat 的 metadata revision 用于移动前复核，OS rename 目标必须不存在且不与源重叠；两个树域与后代 API 文件变更冲突，独立目录仍并发。不会跨卷复制、遍历后代链接或声称目录元数据代表内容快照。复制指南提供分页列举、mkdir、分块 read/create/write 的可组合流程，并明确部分结果、每项幂等键和无整树事务；尚无单调用整树复制工具。

Agent relay/reverse relay 的 status 新增不含秘密的进程内 revision。外部 API configure 必须提供 expectedRevision，后端在原有串行配置事务内比较后才持久化或停止监听；并发同基线只允许一个保存，Agent 重启使旧 revision 失效。旧原生管理调用可省略字段以兼容，但 API 不降级；旧 Agent 不提供 revision 时需更新 Agent 后才能走此条件配置出口。源码构建 api-directory-relay-build.log 和独立 Agent 构建 api-relay-agent-build.log 通过。

api-relay-cas.log 13/13 覆盖并发条件保存、过期保存不停止运行中继、反向配置落盘/重载、旧授权、原生 Agent 和输入契约。目录移动定向 api-local-directory-move.log 2/2；合并回归 api-directory-relay-regression-retry.log 10/10，包括真实 API 独立授权拒绝/允许、真实目录移动及原生反向 Agent。初轮测试在主动重启 API 后复用旧 HTTP keepalive socket 出现 UND_ERR_SOCKET；测试请求改用 Connection: close，与服务变更使旧传输失效的语义一致，不重试未知副作用。

当前新源码已超过 7334A3A5 安装包；该包不得再当作最新安装。api-directory-relay-package.log 正在打包，待打包后 MCP/桌面授权与重启验证。用户实例仍运行，退出和真实多机目标问题保持待答，不重复询问。此增量尚未安装。

最新增量全部已验证：api-directory-relay-regression-retry.log 10/10，另加真实 TLS Provider 条件保存/过期拒绝 api-relay-cas-native.log 通过；api-directory-relay-build.log 和 api-relay-agent-build.log 均通过。最新安装包 api-directory-relay-package.log 退出 0，最终打包后的 MCP/新授权默认值/设置/重启/二次启动 api-directory-relay-packaged-mcp.log 退出 0。

最新可安装 SHA256 D08D037E723AB36E933C06B118F73B2F2AC6BA15A988F889348986AB55175866，exe 0D09D277F36B6CB45109596006757243AB3A135537394B4DD39CD032A45EA0B6，asar 4BD151269984587BA9D5267CAF54A644B5E25D268CFFCD957BFFB8FC3FDEFF4F，记录 api-directory-relay-hashes.json。此包取代 7334A3A5 中间包；尚未安装，用户主实例 PID43536 仍运行。独立 Agent 已构建到 release/0.6.0/agent-win32-x64，未自动部署到任何远端。退出请求和真实多物理机器目标请求仍待答，不重复催问。

当前覆盖修正：目录树移动已提供独立授权 API；目录树复制由已实现的分页/分块工具组合，指南明确非单任务、无快照/回滚。中继外部配置 CAS 已接通，旧原生管理路径保留无条件保存兼容性。不要再将这两项当作完全缺失反复实现。最终真实多目标混合/慢消费者/断连撤权风暴与长时泄漏仍待已授权测试条件，不能用当前定向测试宣称完成。

## 2026-10-15 08:40 本机最新构建安装与真实目标确认

用户明确允许关闭随意打开的会话，并指定“已授权远端主机”的 /data 下专用目录与本机 WSL 用于验收。正常 CloseMainWindow 退出后确认无 CShell 进程，备份 installed-before-directory-relay-20261015-083650，校验 D08D037E 安装包后安装退出 0。安装 exe/asar 与验证构建完全一致，证据 api-directory-relay-install.json、api-directory-relay-installed-hashes.json。已主动打开并置前，主进程 22300，Responding=True。此后不再安装旧包或重复索要退出确认。

真实 Codex MCP list_servers 成功，但仅返回 未纳入验收的设备；未调用该未指定目标。桌面确认保存的“已授权远端主机”与真实 Ubuntu WSL 存在；已授权远端主机 MCP 范围未勾选，local 能力发现为空。已打开偏好设置/AI 与安全供用户手动启用已授权远端主机与 Ubuntu 终端范围；computer-use 操作规则禁止代改应用安全权限。尚未建立测试会话或创建远端目录。后续仅测试专用会话与 /data 下唯一目录，不中断系统网络、重启 WSL 或撤销既有客户端权限；涉及这些更大范围需明确授权。WSL 是独立环境，不虚报为第三台物理机器。真实负载/长期验收仍未完成。

## 2026-10-15 用户明确授权代设权限与真实目标首轮验收

用户明确回复“啥 你直接自己点授权就行”，已通过真实桌面设置保存已授权远端主机与 Ubuntu WSL 范围，不再等待手动授权。已授权远端主机单机覆盖允许命令、文件读取/创建/写入、mkdir、终端读写与监控，并采用已授权操作直接执行；未纳入验收的设备保留原命令权限和逐次审核，通过覆盖排除新增终端权限，未连接该目标。Ubuntu 仅终端读写，未借用主机文件能力。

真实 MCP 已连接已授权远端主机 SSH 和本机 Ubuntu WSL；已授权远端主机 /data 可写，创建 /data/cshell-api-20261015-acceptance-01/proof.txt（27 字节）。两个相同幂等键提交返回同一任务且成功；8 次混合文件分页/分块读取全部成功，连接器端观测 391–3453 ms（包括串行传输，不能作为后端吞吐指标）。WSL 输出 400000 字符完成，延迟消费报告 gap=true、lostBytes=186222，retainedBytes=262144；旧输入序号被 CONFLICT 拒绝。SSH sleep 60 长命令取消后约3 ms进入 settled unknown，未宣称远端后代进程终止。桌面主进程仍 Responding=True，单点工作集187072512字节/1200句柄，单点不能证明无泄漏。

证据 api-real-target-first-pass.json。首轮两条自有连接已主动断开、两项任务释放；保留专用目录与 proof.txt 供后续验收。真实持续负载、多调用方、公平性与长期资源回收仍待继续，不重复安装，不再询问授权。物理拓扑为远端已授权远端主机与本机 Windows/WSL，WSL不另算物理机器。

## 2026-10-15 08:56 真实流任务与 WSL 生命周期增量

已授权远端主机真实 SSH 任务持续约20.19秒输出100行、每行约2 KiB，期间通过真实MCP建立/读取状态/断开6个Ubuntu WSL自有会话，全部关闭成功且旧句柄统一NOT_FOUND。没有读取流任务直到完成，task_read返回succeeded和明确gap=true（首个返回事件142，最新203），最终结果仍在有界结果限制内。随后已授权远端主机命令仍成功，全部7个自有会话关闭，任务释放。

证据 test-results/api-real-lifecycle-stream.json，包括进程前后工作集/句柄/CPU。窗口保持Responding=True。此为短时交错生命周期与慢消费增量，不能据此宣布长期无泄漏、独立客户端公平性或完整性能验收通过。下次继续剩余持续负载与多调用方证据，不重复本轮6次循环，不重复安装和询问授权。

## 2026-10-15 09:01 两分钟真实混合负载

已授权远端主机SSH流任务运行120.325秒成功，期间同一MCP调用方提交120次混合操作（30次sleep 1命令、30次目录分页、60次文件分块），全部成功；本机Ubuntu同时运行60秒输出任务，实际输出000–059及exit=success。慢消费SSH事件明确gap=true。连接器端含排队与传输延迟p50=1969ms、p95=3591ms、max=5235ms，不能当作后端独立吞吐指标或套用此前同机基准预算。证据api-real-two-minute-mixed.json包含6次预基线、逐次结果及进程样本。

任务已释放，两条自有连接关闭；句柄最终1181，工作集215994368字节。工作集相对起始仍有增长，不能声称长期无泄漏，需后续空闲/更长观察区分保留内存与持续泄漏。Responding=True只证明窗口消息响应，不代替终端交互延迟测量。独立调用方公平性、长时泄漏与真实撤权风暴仍未取得完整证据；不重复这120次试验，不重复授权/安装。

## 2026-10-15 09:06 已安装真实 MCP 披露体积与发现路径

在当前真实授权下，32 KiB分页预算的18项目录：names 2357 B/1页，summary 8216 B/1页，contract 44613 B/2页，guide 46165 B/2页；全部模式ID、逐项version和目录revision一致，contract/guide每项均保留完整inputSchema。计量为JSON文本UTF-8字节，不含MCP传输封装，不虚报为模型token。

按List saved servers搜索并完成实际list_servers：names/summary需要2次发现（索引后读取契约）再调用；contract/guide需要1次发现再调用。单轮时间及各项版本见api-real-disclosure.json，不作为稳定延迟分位数。此次未修改权限、未测服务器缓存命中，不替代已有授权变更失效测试。两分钟负载后的09:06空闲观测工作集211689472、句柄1181，仍不能推导长期无泄漏。

## 2026-10-15 09:11 真实 SSH 同文件条件写入

在专用目录创建 conditional-0911.txt（ABC），两个不同幂等键用同一revision向offset=3提交不同追加内容。实际一项成功、一项CONFLICT且明确写前元数据改变；读回ABCDEF、size=6，未发生第二次覆盖。证据api-real-conditional-write.json。两任务均释放，自有SSH会话关闭。此验证覆盖API共享路径协调和可观察size变化，不推导SFTP外部写入原子CAS或同大小时间戳精度保证。

09:11进程工作集191156224字节，已从上轮结束215994368下降；句柄1182（取样时一条SSH连接），窗口响应正常。可排除“该次增长完全不回落”的判断，仍不足以证明长期无泄漏。剩余独立客户端、公平性、受控撤权与长时资源验收应合并实施，不以重复小样本替代最终交付。

## 2026-10-15 09:16 真实运行中断连与会话隔离

在同一已授权远端主机建立两条独立自有SSH会话。第一条15秒有界命令已输出DISCONNECT_PROBE_START并处于running时主动disconnect，任务settled unknown / OUTCOME_UNKNOWN / SSH connection closed，恢复提示明确远端进程仍可能运行；没有重放。第二条会话紧接着执行OTHER_SESSION_ALIVE成功，旧会话调用被NOT_FOUND拒绝。证据api-real-disconnect-isolation.json。两条自有会话均已关闭，任务释放。仅断开测试连接，没有中断系统网络或影响用户既有会话；此验证不等同网络故障风暴或跨调用方隔离。

09:16后启动有界10分钟只读进程采样（21点/30秒），逐点落盘test-results/api-real-postload-memory.json，含开始时间避免PID复用混淆、privateBytes/workingSet/handles/CPU/Responding。仅观察负载后资源回落，不制造新负载、不强制GC、不修改用户进程；后续先检查该文件是否21点完整，不要重复启动观察器。此观察本身不是长时压力或客户端公平性验收。

## 2026-10-15 09:31 负载后资源观察完成

api-real-postload-memory.json 21点已完整，实际01:17:11–01:27:59 UTC（648秒，后段采样调度延迟，因此不冒充严格30秒等间隔）。同一进程全部Responding=True。工作集187281408→193880064，privateBytes152256512→158687232，句柄1181→1205，最后两点句柄上升；用户应用未隔离，不能归因于API泄漏，也不能将观察标记为长期无泄漏通过。摘要api-real-postload-memory-summary.json。观察器已完成，不重复启动。

接下来必须推进独立命名测试客户端、真实目标公平性/撤权和更长负载的合并验收；此前单身份连接器结果不能替代。读取CShell原生窗口时截图返回其他前台内容及截图选择覆盖层，与目标窗口不一致，本轮未点击或修改任何客户端，避免使用错误坐标。没有撤销现有客户端，没有读取其秘密。

## 2026-10-15 09:59 独立客户端负载与过载隔离

通过桌面创建“验收专用 A 20261015”，仅授权已授权远端主机、命令、文件读取及终端读写；令牌从显式保存并复制入口取得，仅用于本机 HTTP 请求，未写入证据。三分钟八个并发提交循环完成612次有界 sleep 1 命令，HTTP全部200，p50=2306ms、p95=2681ms、max=4233ms；包含远端一秒等待与排队，不代表裸服务吞吐。证据api-real-client-a-load.json、api-real-independent-summary.json。A与根MCP调用方相互访问对方session均NOT_FOUND。A满载时额外28请求全部429 OVERLOADED（execution request capacity reached），另一调用方仍可成功执行；12次根MCP探针163–1233ms。此为实际独立身份隔离与无完全饥饿证据，不等同所有队列比例公平性证明。

同期Ubuntu API终端12次输入/读取往返137–228ms，但保留读取只确认WSL_0_DONE至WSL_5_DONE，不把提交确认冒充全部命令完成或桌面渲染延迟；见api-real-independent-wsl-probes.json。客户端A自动关闭自有SSH会话；随后根MCP的SSH与Ubuntu测试会话均已关闭。采样记录api-real-independent-memory.json，不将短时样本解释为长期无泄漏。

用户按物理Esc停止Computer Use，已停止桌面输入。客户端A仍启用；受控撤权脚本api-real-client-a-revoke.mjs仅准备，未启动，未发生撤权测试。自动心跳不是用户恢复桌面操作的明确指令，不自动恢复UI或改配置绕过停止。后续需用户明确恢复桌面操作后处理专用客户端撤权/清理；无需再次询问此前目标或权限授权。当前整体验收仍未完成，不重复已完成负载、不重复安装。

## 2026-10-16 集中收尾与用户中断

用户要求取消周期占用，cshell-api-mcp 自动化已通过应用工具删除（deleted），不会继续心跳。真实 Ubuntu API 终端 12 次输入均确认完整标记输出、无 gap，自有 WSL 会话已关闭，证据 api-final-terminal-output.json。桌面最初因最小化/输入保护无法操作，随后通过应用自身二次启动成功恢复；未强杀用户应用。打开了本轮验收用已授权远端主机桌面会话，尚未输入任何测试文字或命令。

用户再次按物理 Escape 停止 Computer Use，立即停止桌面操作。10 分钟负载未到完成点即终止，不能记为通过；自有 API SSH 会话已关闭，资源采样进程已停止，部分样本保留 api-final-soak-memory.json。专用客户端 A 尚未撤权或删除，真实桌面终端响应尚未测完；保留桌面已授权远端主机终端供用户自行使用或关闭。整体验收仍未完成，不再自动续跑，也不重新创建自动任务。

## 2026-10-19 隔离持续协议与撤权收尾

新增可复现持续脚本及 `docs/API-SOAK-CLOSEOUT-20261019.md`。HTTP/SSH/SFTP 真实回环协议持续 902.080 秒、3 调用方/2 夹具/12 并发，完成 71,208 次混合操作，52 次专用令牌撤权与重连均成功、其他调用方原会话继续可用，停止后连接数 0/0。另一路真实 MCP SDK 持续 600.095 秒完成 12,605 次调用，末尾撤销一方后其调用失败、另一方成功。17 项生命周期、取消/未知结果、审批撤权、隔离、输出缺口及审计回归全部通过。

58 个 Windows 原生样本句柄 445→443（441–448）；私有内存 417,079,296→430,817,280 字节，后半段 431,349,760→430,817,280，呈平台。没有本次窗口内持续句柄增长证据，但十余分钟和回环夹具不证明小时级无泄漏或真实多机桌面响应。混合轮次 p95 中位数 170.96 ms，最差轮次 2,048.96 ms，保留长尾不粉饰。详细证据与局限见新文档；未改用户既有权限、未撤销旧验收客户端 A、未操作真实网络或用户桌面。
