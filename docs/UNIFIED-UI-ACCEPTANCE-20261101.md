# 统一 UI 验收矩阵 · 2026-11-01

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
