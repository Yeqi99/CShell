# 统一 UI 验收矩阵 · 2026-11-01

> 最终状态以 [本轮需求最终核对](UNIFIED-FINAL-AUDIT-20261101.md) 为准。下方早期未勾选与“待验证”是实施时点记录，不再作为当前发布阻塞；后文保留真实失败、修复与验收边界。

本表记录界面代码、交互与夹具验证，不能替代真实设备和发布验收。所有测试使用隔离配置，未改动用户连接、密码和权限。

## 已实现与已验证

| 入口 | 本轮变化 | 验证证据 | 仍需真实环境验证 |
| --- | --- | --- | --- |
| 设置分类 | 稳定分类导航、搜索、保留跨分类草稿、固定保存栏 | `settings-studio-smoke.ts`：1100/680/380 px、浅/深色、修改后显式保存 | 本机最终安装包 |
| MCP 权限 | 每台机器独立卡片、继承状态、紧凑权限网格；全局全选保留原后端检查 | 设置夹具确认点击全选不会在保存前授权 | 实际 MCP 客户端调用与撤销 |
| API 客户端 | 客户端标题旁可删除；移除后保存才撤销令牌，不隐式提交其他授权草稿 | TypeScript；删除后端原有 token 清理逻辑已审查 | 两个真实客户端隔离验证 |
| 智能体目标/事件 | 紧凑浮层保留会话和输入；明显关闭入口 | TypeScript；沿用已有页面状态与草稿 | 真实长任务中操作菜单 |
| 同对话切模型 | 调用 aiThreadProvider 更新当前会话；执行中禁用，不再偷偷新建空对话 | TypeScript；后端测试由账号任务记录 | 两种真实模型跨工具历史兼容 |
| 聊天气泡 | 用户气泡按内容宽度、右对齐、长字串换行 | TypeScript | 不同语言/长代码截图 |
| 标签页 | 滚动按钮预留位置；仅切换活动标签时显露；多次打开同机器用独立实例键，凭据ID不改 | `plugin-layout-ui-smoke.ts`：编辑不改变标签 scrollLeft | CAgent/RDP/SSH真实并行连接关闭隔离 |
| Ping | 紧凑 Ping 全部；每个真实 profile 单独请求；双并发；右键周期并保存设置 | `ping-all-ui-smoke.ts`：目标/结果对应、排除HTTP、周期保存 | 网络代理/TUN下真实 ICMP |
| 新建连接 | SSH/SFTP/FTP/FTPS/RDP/CAgent直连均有不保存端口探测；说明不等于认证成功 | `lending-probe-ui-smoke.ts`：host/port准确；后端真实TCP由主任务验证 | 每种实际协议认证成功/失败 |
| 机器借用 | 云注册设备、多选、邮箱/限次分享码、到期、兑换、撤销确认，凭据不展示 | `lending-probe-ui-smoke.ts`：760/380排版及真实注册ID payload；已查看截图 | 两个真实账号与到期断流 |
| 身份代理 | 账号CAgent来源→出口规则列表/增删；菜单排除自环；SSH应用可选本机出口 | `activity-layout-ui-smoke.ts`：规则payload、同源排除 | 跨公网真实设备链路，不是全系统TUN |
| 统计/历史 | 分类先于筛选；独立数字卡；14 px方形活跃块；近期记录分区，历史可搜索 | `activity-layout-ui-smoke.ts`：1000/540/380无溢出、方格等边、搜索；已查看截图 | 真实大量历史分页 |
| 插件设置 | 微信本机/操作/联系人范围分区，权限卡片；OpenCode/Tavily统一间距尺寸 | `plugin-layout-ui-smoke.ts`：760/380、显式保存、无隐式授权；已查看截图 | 各扩展完整联网操作 |
| 统一错误 | 连接、文件、模型、MCP、远控、托管、WSL等纯IPC错误归 ErrorNotice；诊断折叠/复制；会员、权限、未开放状态黄色；401区别认证与权限；正文/详情令牌隐藏 | `feedback-ui-smoke.ts`、TypeScript、设置全尺寸回归 | 剩余带自定义操作的少数旧错误块仍需逐入口迁移 |
| CAgent终端 | 可视化真实terminal renderer显示后端失败；原错误仅在不可达旧renderer中展示，造成按钮无响应体感 | TypeScript；后端真实TLS终端测试由能力任务记录 | Windows CMD/PowerShell实机 |
| CAgent原生设置 | 模型连接、执行委派、运行预算卡片；长权限标签换行；全局字段留白；会员权限黄色提示；窄滚动条系统资源；版本化微信配置保留 | WPF编译、`agent-native-exit-smoke.ps1`；`--fixture ... settings`截图已查看 | 原生所有设置页逐页最终包验收 |

截图位于 `test-results/unified-ui/` 和 `test-results/settings-studio/`。这些截图明确为夹具，不是已登录真实机器。

## 剩余发布审计：不可因此标为“19项全部完成”

1. 账号/模型/插件/设置跨机还原、CAgent真实模型联网、OpenCode实际账号请求：由账号任务继续实机；UI测试不代替凭据验证。
2. 微信三个版本能力包构建/安装/消息订阅/Agent工具实际可用：由能力包任务验证，界面分区不代表包已发布。
3. Android远控、短信电话权限和回归：由主任务USB实机验证，不允许把未授予权限显示为开放。
4. 会员免IP、多账号机器借用、到期撤销、应用出口：需要真实后端部署及跨设备测试。
5. 目标检查间隔与记忆：React编辑页支持秒/分钟/小时、目标记忆读写、无绑定会话按授权范围创建；goal-editor-ui-smoke验证30秒+记忆payload与390px排版，已查看截图。核心运行及原生自动化由对应任务核验。
6. 剪贴板图片/文件无缝互通、所有连接断线及时性：尚无本UI任务的实机通过证据。
7. 原生CAgent非Windows界面和Android视觉不能用WPF/浏览器截图替代。
8. 自定义错误确认块（例如有取消/保留编辑操作的块）没有批量替换，以免丢失操作；应逐项审查。ErrorNotice已把脱敏信息写入现有diagnostics:error通道，同文60秒去重；未迁移自定义块仍需核对日志覆盖。
9. 普通/Pro/CAgent/Android最终包、官网下载、admin、香港源和本机升级由主任务统一发布，当前UI提交不代表发布。

## 续验收

- Windows系统代理显式启用/恢复按钮已接入，要求先应用机器出口；fixture验证未点击不会改系统设置，点击后调用networkSystemSet。真实系统代理未在UI验收中擅自启用。
- CAgent已打开工作区后台每15秒探活，失败同步左栏在线状态，切换标签不重置计时；仍须最终包实测断网恢复。
- AI管理连接managementOnly进入机器工作区，不再给Android等无Shell机器创建PowerShell终端。

## 远控剪贴板补齐与测试限制

- 新增显式复制/粘贴按钮及 Ctrl+C / Ctrl+V，绑定当前可见远控view与generation；每个分块前检查控制权限，断连不重放。
- 文本、PNG使用有界分块；文件通过私有token读取与专用接收目录，完整收齐后才写Windows CF_HDROP；拒绝目录、路径穿越、保留名、超额数据。
- 本地剪贴板服务与双向文件传输模拟集成测试、renderer粘贴/关闭控制测试通过；不等于远端native实机成功，等待native构建与双机验证。
- Electron新版ClipboardItem原生测试确认文本和CF_HDROP格式往返；测试错误地尝试将read()对象直接write恢复，Electron拒绝且进程退出，因此未能恢复原剪贴板，已向主任务报告并由主任务告知用户。未修改用户文件。此测试不得作为完整安全恢复通过。
- 后续真实剪贴板测试必须先将各格式payload完整保存并验证可重建成new ClipboardItem，修改后只有当前仍是测试内容才恢复；空剪贴板也应恢复，敏感备份及时清理。

## 剪贴板真实 RPC 收口（2026-11-01）

- 新增可复跑 scripts/clipboard-real-rpc-smoke.ts：真实 Electron ClipboardItem、本地独立身份配置、密码配对和 pinned TLS、CAgent DesktopService 与实际 Windows 原生 worker，逐项往返 Unicode/emoji 文本、PNG 像素、CF_HDROP 文件内容。非 fixture 模拟 RPC；同一 Windows 桌面回环，不冒充跨机器安装包 UI 验收。
- 实测发现 native 剪贴板 owner 窗口没有消息循环，另一个应用改写时同步阻塞约 5 秒并导致键鼠 lease 过期。改为独立 owner HWND 消息线程，文件 IO 仍在原授权用户上下文；不延长 lease。OpenClipboard 仅在取得锁前最多重试 200 ms，不重放写入。
- 新原生构建后文本/PNG/文件真实往返通过（约 175 ms 的 RPC 流程），原剪贴板所有格式先保存并验证可重建，每次仅仍为测试内容时恢复；恢复校验成功并清理备份。原先事故记录保留，不将后续成功掩盖事故。
- Ctrl+C 先读远端 sequence，再发送按键并等实际 sequence 变化，超时不替换本机剪贴板；工具栏“取回远端剪贴板”只取现有内容。权限撤销与序号不变测试通过。
- 尚需最终完整安装包、两台物理机器交互验收；native SYSTEM broker、跨用户桌面和实际拖放场景不在此回环覆盖内。

## 二次错误入口与原生界面审阅

- 实际漏项修复：WSL、托管运行/请求、事件订阅、中继、模型目录、命令台、文件传输、HTTP、Docker监控、连接表单、更新、MCP、统计、监控分屏等仍有直接渲染IPC错误，现改用ErrorNotice；连接取消保留普通状态，既有重试/取消/设置入口未移除。
- 共用显示、复制和日志脱敏新增含空格的密码、独立sk密钥、URL认证和PEM私钥覆盖；2项测试通过。会员/禁用/权限保持警告色。
- CAgent新建自动化原生页面拆任务/触发/启用三个分区，定时与事件字段按需显示，增加触发来源/API密钥无障碍名称与数值/JSON校验。原生WPF编译与fixture截图已验证；属于界面验收，不宣称事件真实执行。
- settings-studio-smoke（1100/680/380px）、feedback-ui-smoke、TypeScript通过。

### 最终反馈入口矩阵（5a39ba6 / 6ebea39）

| 入口 | 实现与上下文 | 验证 |
| --- | --- | --- |
| 新建/已保存连接、机器工作区、分屏 | 共用错误组件，原重试/重新认证保留；取消是普通状态 | TypeScript、已有连接 smoke |
| WSL 发行版/网络/安装、插件目录/模型目录 | 未安装/未授权显示警告；目录和操作失败日志统一 | 设置分类 1100/680/380 px、feedback smoke |
| 托管、中继、HTTP 请求、命令台 | 服务/单次请求错误在所属任务内，原启动/取消/设置按钮保留 | TypeScript、反馈复制/重试 smoke |
| FTP/SFTP/CAgent 文件传输、Docker、机器信息分项 | 传输/采集失败共用反馈，不把旧采集值冒充成功 | TypeScript |
| AI 事件、权限保存、文字辅助、Python 编辑 | 各自草稿与操作位置保留，依赖缺失仍可进入安装 | TypeScript、反馈流式/停止 smoke |
| MCP、更新、统计、全局设置保存 | 统一诊断详情、脱敏复制与日志；设置错误在滚动内容而非撑高保存栏 | 设置窄屏/草稿/固定页脚 smoke |
| 破坏性操作确认 | 删除布局、中继停用、编辑丢稿继续使用明确确认，不误判为错误 | 未改动行为 |

以上为代码与UI定向验收，不代表每个外部服务故障均已人工制造；仍由最终安装包实机回归覆盖后端。

## 2026-11-01 真实双机 Windows 远控与剪贴板补验

目标为已保存的 WIN-3K4794IML24 / 德威云，直连配对身份和证书均核对一致。目标实装 0.8.16，Windows Server 2022 build 20348；系统桌面服务运行且匹配。原会话 disconnected、无人登录控制台，故没有可采集的已解锁桌面。正常使用已保存 RDP 凭据恢复原账号会话；未解锁绕过、切换 console、注销、替换服务或安装驱动。

在唯一临时目录部署本轮源码 ClientServer + DesktopService 和最终 candidate 原生 worker，复用远端已安装 Node。新服务仅监听 127.0.0.1:39477；通过既有授权 CAgent browser stream 转发，内部再做绑定身份的真实 TLS。无防火墙、启动项、原配置变更。连续帧与 control 租约有效；不是本机回环替代双机。

- 实际本机 Electron 剪贴板 ↔ 远端 native 剪贴板：Unicode/emoji 文本、2×2 PNG 像素、小文件内容往返全部通过。
- 双方原有格式先完整备份并验证可重建。远端六种 HGLOBAL 格式备份使用 CurrentUser DPAPI 加密；本地全格式 Blob 备份限额并验证重建。恢复前检查序列/摘要仍为测试拥有；最终 `remoteRestored:true`、`localRestored:true`。
- 首轮发现 RDP 自带剪贴板重定向干扰：远端 sequence 在 CAgent 写入前变化，护栏停止测试。本地恢复后远端逐字节核验 `sameAsBackup:true`，没有覆盖新复制。第二轮仅验收 RDP 宿主禁用 RedirectClipboard 后完成独立通道测试。
- 仅测试的两处远端目录、进程及加密备份已清理；临时 RDP 正常关闭，用户程序保留。旧 CAgent 服务未替换。
- 新 native `--probe` 可检测真实显示；虚拟显示 preflight 返回 CONSOLE_SESSION_REQUIRED。此结果不声称无人登录时可控制桌面、Server 虚拟显示驱动已安装或 SYSTEM 跨会话完整验收。
- 界面修正 CAPTURE_FAILED / ACCESS_DENIED 的操作说明，已断开会话优先显示真实状态，不再暗示需要长期保持 RDP 窗口可见。

证据：`test-results/unified-ui/clipboard-physical.json`、`remote-windows-physical-session.json`、`remote-windows-candidate-diagnostics.json`、`remote-windows-cleanup.json`。最后 tsc 通过，桌面恢复/视图 13 测试通过。

### 临时连接重连实包回归

修复独立标签的 instanceId/visual 被带入严格 Profile IPC 导致临时 SSH 重连失败。工作区元数据与连接数据在组件边界分开，HTTP/RDP/CAgent 同样不携带标签字段。真实 SSH fixture + Electron 完整 lifecycle 验证通过：临时认证重连产生第二个有效会话、旧滚动历史保留、未重放输入、未保存临时密码；取消和切换工作区保留草稿，浅/深紧凑布局均通过。tsc 与 Pro renderer build 通过。

### 独立小窗 Windows 缩放回归

真实125%显示器首次show后Windows外框/DPI调整使560×360请求成为566×364外框、564×364内容。现首次显示后按目标屏幕重新应用DIP尺寸并约束工作区；实测内容560×360、外框562×361。smoke按实际内容尺寸（只容忍一个物理像素换算的舍入）及外框完全位于workArea验证，不再以任意放宽outer阈值通过。完整真实Electron独立窗口测试两次通过：历史保留、真实键入、仅观察后端拒绝、受限IPC、独立置顶、还原/关闭不丢会话。tsc通过。

### typed身份代理与CAgent主题入口

机器出口改为紧凑的来源→出口规则表，来源与出口包含后端实际提供的本机/SSH/CAgent。已生效/等待连接/未生效使用后端状态；原位增改撤销，编辑不悄悄改变来源，自环选项排除且复用有向图防循环校验。380/800px组件截图无横向溢出，fixture验证保存typed参数、编辑草稿、撤销、循环禁存，不代表真实远端代理验收（由后端验收记录覆盖）。

CAgent网页主题按钮现在写account.appearance，再按保存结果应用主题，刷新保留并保留字号字体；并发旧轮询不能覆盖新选择。web真实组件fixture验证切换写入、重新加载和现有对话草稿/权限隔离通过；云端持久化由账号回归单独验证。

旧 SSH 代理设置新建入口已移除，既有代理终端可正常关闭释放；新建统一使用来源→出口规则。SSH 规则注明对之后新开的终端生效，不承诺接管已运行软件。来源离线时撤销状态保留为“等待机器恢复后撤销”，不能把持久规则删除当成远端撤销已确认。

### Android 输入定位记录（尚未验收通过）

API29 真实仪器 run 41286458196 显示光标确认仅运行一轮，`node.refresh()` 消耗5002ms，总5038ms，尚未发送光标定位便耗尽有界预算。修复75b4a05改为重新查询系统当前输入焦点，核验同一节点、仍可编辑、非密码后读当前快照；移除重复刷新陈旧节点，不延长预算、不重放文本。API35同轮停在selection-rejected，仍需新包两API共同验证。此前一次API35 CONTROL_CLOSED发生在宿主协议互操作阶段、输入测试之前，71dd110保留隔离模拟器宿主诊断供复现定位，不将其误记为光标失败。

手机最后一次只读核对仍是2026-11-01 14:42:40安装的旧签名候选；尚未替用户安装新诊断包，也未再次盲点屏幕。此条不代表真机输入已完成。
# 外部扩展跨机恢复状态补验

`cb954a2` 将尚未恢复的账号扩展归入市场内的折叠区域，显示名称、所需版本与原因，沿用当前工作区的安装预览。CAgent 仅对后端已核验来源、版本和摘要均匹配的包提供“查看并重试”；同名旧包不会隐藏待恢复提示，缺失来源不伪装可安装。

`scripts/restore-pending-ui-smoke.ts`（`ee8e3fe`）在真实 Edge 的 380px/1100px 下通过：默认折叠、展开、无横向溢出、选择包只预览、取消不导入或启用、CAgent 详情不自动安装或授权。已人工检查 `test-results/unified-ui/extension-restore-380.png` 与 `cagent-restore-380.png`。TypeScript 与既有 CAgent 网页能力回归同时通过；这不代表对应外部包本身已安装或实机可用。

