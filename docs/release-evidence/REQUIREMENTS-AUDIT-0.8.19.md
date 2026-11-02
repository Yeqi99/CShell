# 0.8.19 前全需求差距审计（只读实现审查）

## 审计后的收口状态

下文保留审计当时发现的问题，不代表最终候选包仍缺失。后续已补齐账号发现开关的独立云同步与 schema 4 旧客户端保护、Android 账号登记/中继与委派认证、分享入口及自定义有效期，并完成实际香港后端回归。Android API 29 的嵌套 TLS 问题已修复，API 29/35 验证均通过。Windows 两渠道安装包、独立 CAgent 安装包及普通版/Pro 隔离均已有成品验证记录。完整发布状态以 `../RELEASE-0.8.19-FOLLOWUP.md` 和最终发布收据为准；此段不表示已经上线。

扩展可携带配置的适配范围及安装前验证见 `PORTABLE-CAPABILITY-AUDIT-0.8.19.md`；设备绑定、端口和权限不作为普通偏好复制。目标/事件执行状态仍不跨设备自动迁移，运营商短信/电话、联想实机中继与 macOS/Linux 实体设备覆盖等限制继续保留。

审查日期：2026-11-02。审查对象为 Pro 工作树当前代码；account/cap 正在修改019，不能把工作树新功能当成0818已发布。根已通知 Core Ping 同步提交 a7805fa。本审查没有启动真实模型计费、发送消息/短信、拨号、改用户代理或构建发行包。

依据：逐项查看实际 UI 引用、IPC/runtime、存储与工具实现；历史文档仅用于定位，并打开相应收据核对限制。`UNIFIED-FOLLOWUP-20261101.md`、`UNIFIED-FINAL-AUDIT-20261101.md`、`PRO-ACCOUNT-FOLLOWUP.md` 混有旧阶段未完成记录，不把其标题或勾选直接当现状。

本次独立运行8组回归，共41项通过、0失败：cloud-store、cagent-cloud-accounts、mcp-client-removal、identity-network、identity-network-tools、ai-work、opencode-catalog、remote-automation-tools。是当前源码的定向回归，非全套UI/真机或019成品验收。

## 19项逐项

| 项 | 实际入口与实现证据 | 判定及剩余 |
|---|---|---|
| 1 CShell/CAgent共享基座、回复动效 | `src/desktop/cloud-sync.ts:78` 导出AI，`src/agent/cloud.ts:150` 接OpenCode官方transport；`src/agent/assistant.ts`模型执行，`src/agent/native`原生窗口实现 | 已接入可达；本次账号恢复测试通过。历史Terra实际回复有证据；不能由此断言每个提供商/代理均可用。原生动画需新成品复查，不新造已实测结论。 |
| 2 微信市场、事件订阅、远程工具 | `src/agent/runtime.ts:141-149`把managedWechat加入CapabilityRuntime，onEvent→automation.emit；`:191-195`注册通用自动化与工具；`src/core/remote-automation-tools.ts`远端包装 | 已接入而非仅后台；远端owner过滤测试通过。`wechat-final-native-lifecycle.json`明确首次冻结自动投递失败、诊断同事件投递成功、修复后重投同事件通过；不等于新真实消息首次自动端到端通过。4.2原生进程未做本轮实机验收。 |
| 3 设置随账号 | `src/core/store.ts:70-114`导出/恢复preferences、内置enabled、命令、external；`src/agent/cloud.ts:275-290`回写theme/font/size；`src/desktop/cloud-sync.ts`恢复各模块 | 已实现指定字段，不是全部设置。**新自动发现开关仅本机分账号**，见下节。CAgent只消费适用偏好，MCP令牌/监听、设备私钥不云复制；线程/事件任务也不在共享AI云导出中。 |
| 4 Android远控/电话短信 | `AndroidAgentHost.java:120-130`发布手机能力；`AndroidPhoneCapabilities.java:25`真实权限状态；真实输入收据`android-0.8.18-real-input-final.json` | 0818 Pro真机视频/点击/输入/退格已有历史证据；运营商短信收发/接打电话仍未验证，不能标完整电话能力实测。019 Android账号/发现/委派在cap开发，须重新验收；无SIM/系统授权不能用夹具代替。 |
| 5 删除Codex/Claude入口 | 可见市场/桌面入口中不再发现对应安装项；仍有`src/agent/coding.ts`与`src/shared/coding.ts`兼容内部定义 | 用户可见入口已移除；不是所有兼容实现源码被删除。不得删除用户外部软件；需要最终市场目录快照再确认无入口回归。 |
| 6 会员无IP | 既有云relay/lease+目标TLS；历史公网隔离多控制端证据，019设备发现新代码 | 已实现，历史跨账号/撤销/重连测试范围有限；指定联想实机由用户明确免除，不可写作已实测通过。019手机中继/发现与分享需重测。 |
| 7 WSL离线源 | `WslPlugin.tsx:54`、`AgentWsl.tsx:51`均链接`services/portal/docs/wsl-offline.html`，页面含官方安装与镜像/架构/校验说明 | 已有可达入口与文档。本次不重新下载整发行版，不保证第三方镜像长期在线；文档链接验证与完整安装应区分。 |
| 8 机器租借 | 云服务分享/委派逻辑及用户/管理员管理入口；根另审发现Android委派差距并提交349e3a2门禁，cap补实现 | 既有桌面机制可达；**Android不能据桌面分享测试宣称完成**。019以根分享专项审计为准，须验证目标执行拒绝/期限/撤销/无密码泄露。 |
| 9 UI统一 | `Settings.tsx:162,423`分类入口；AiPermissionTree、ApiTargetPolicies、ExtensionWorkbench共用样式；插件/权限实际组件 | 已有结构化设计，不能笼统称所有页面无畸形。本次未逐页真实窗口验收；新增发现/Ping/Android/分享UI必须尺寸、键盘与错误状态补验。 |
| 10 任意机器身份代理 | `NetworkSettings.tsx:54-55`渲染SystemMachineProxy+MachineNetworkRules；`MachineNetworkRules.tsx`来源/出口多规则；`desktop/identity-network.ts:54`明确local/ssh/agent端点，`:58-59`发布工具 | UI可达、真实TLS/SSH/半关闭与环路/撤权测试通过。仅应用HTTP/SOCKS及新终端环境；**不是所有进程/TUN/UDP**。Windows系统代理只有模拟注册表测试，不能称系统全流量实机通过。 |
| 11 OpenCode与插件同步 | `src/core/store.ts:77,112-114`内置/外部选择；`src/agent/cloud.ts:150`官方runtime；opencode-catalog测试超长modalities/失败模型禁用/刷新恢复 | 目录与状态实现可达，测试通过；该账号免费模型历史403/400/429仍是上游不可用，无成功回复证据。外部包只恢复匹配版本/来源选择，不能把任意执行文件静默下载当同步。 |
| 12 会话不中断、菜单与换模型 | `AiPanel.tsx:286-329`聊天不因目标/事件隐藏；`ai-panel.css:3-8`目标/事件绝对定位小浮层；`AiConversation.tsx:312-316`已有thread调用aiThreadProvider | 已实现可达；执行中禁切模型，空闲同对话可切。目标菜单关闭保留原thread，不需进历史。新成品需要UI复验，不能仅凭CSS审美下结论。 |
| 13 细滚动条 | `src/ui/styles.css:1203`等全局thumb与高对比支持 | 已实现；原生Windows/Android系统控件并非此CSS覆盖，不能声称所有平台滚动条统一发光。 |
| 14 目标间隔与记忆 | `shared/ai-work.ts:6-7`秒级与memory；`core/ai-work.ts:289-293`update_goal；`AiWork.tsx:119,151`表单；`agent/automation.ts:30-35`update memory/everyMs | UI+工具都有，当前目标持久化/失败回滚测试通过。CShell1秒到7天；CAgent间隔1秒到30天。记忆本地任务持久化，不等于跨设备云同步目标。 |
| 15 统计布局与正方形 | `ActivityPage.tsx`页面；`styles.css:6075`热图行14px/列14px、卡片与响应式栅格 | 正方形和分区实际存在；本轮没有重新视觉验收所有语言/缩放/长记录，新成品需专项检查。 |
| 16 断连、统一报错、双击新标签 | `AgentMachineWorkspace.tsx:54`真实terminalClosed状态；`ServerSidebar.tsx:430`调用onConnect；`desktop/main.ts:120-134`统一diagnostics；ErrorNotice | 有实现入口，历史连接生命周期测试；sidebar本身不足证明独立标签，应由根最终App会话测试复验。统一错误组件存在不代表所有路径均统一；需包含IPC失败、会员/权限、断线原位反馈。 |
| 17 Ping全部/周期 | `ServerSidebar.tsx:243`渲染PingAll；preferences.sidebarPingIntervalSeconds进cloud store；019 account修改菜单/根Core同步a7805fa且真实smoke通过 | 019新增仍未发布。Ping周期跟preferences可云恢复，区别自动发现开关。需要确保真实目标ICMP而非代理本地测量，不能用UI测试证明网络时延正确。 |
| 18 CAgent CMD/PowerShell | `AgentMachineWorkspace.tsx:52-54`真实clientShells/open会话；ConPTY后端；既有`agent-terminal-live.json` | 已实现且有历史真实TLS+ConPTY记录。019运行时若变更应重跑真实包，不把历史记录冒充新包通过。 |
| 19 会员正常提示 | `ErrorNotice.tsx:12-35`membership/permission/unavailable分类为warning+role=status；其他错误alert | 主组件已实现可达。所有调用点是否共用仍需界面巡检；不是所有401/权限故障都应该降为警告，真实认证失败需保留故障语义。 |

## 附加项

- 新建连接检测：`ConnectionForm.tsx:408`、`ClientConnectForm.tsx:270`、`RdpConnectionForm.tsx:182`都挂接`ConnectionProbe`。仅本机到端口连通，不是假登录成功；relay配置不盲测不存在的直连地址。
- 默认全开放：既有首次初始化默认与显式关闭保留测试/成品记录。MCP服务默认关闭、系统录屏/无障碍/短信授权仍不能默认代替用户授予。
- 剪贴板：真实双Windows文本/PNG/文件历史收据存在，不能扩展为Android/Linux文件剪贴板也全部验证；019跨平台需精确说支持矩阵。
- 标签稳定：历史CSS/生命周期实现；仅复查sidebar回调不能证明当前所有页面标签不跳动，需要真实多标签切换验收。
- API客户端删除：`McpSettings.tsx:358,584`两处删除，明确删除后保存撤销令牌；本次`mcp-client-removal.test.ts`真实HTTP验证删者401、另者200、重启保持通过。不是仅后台能力。
- admin：既有0818页面已发布；019 Android分享/发现新支持尚在开发，不应提前写admin已同步。

## 明确差距：自动发现与设置同步

`src/core/account-discovery.ts:9-24`自身注释和实现均说明本机按账号存储：账号哈希文件`account-discovery-*.json`保存enabled。`src/desktop/cloud-sync.ts:261`仅IPC get/set；bundle没有该值。账号切换不串值≠跨设备同步。

建议：新增独立`accountPreferences.autoDiscoverDevices`，不放外观方案/预设导入，以免导入主题隐式触发加入机器。若一定放preferences，必须把外观preset导入与此功能设置排除。采用可选字段，新快照不存在时保留本机显式值/按约定默认；导入账号设置须等连接凭据完成后再发现，不覆盖现有名字分组，不删除离线记录。

兼容门槛：现有`preferencesSchema`、桌面bundle严格解析；`vaultWriteSchema`最高3，服务端`server.py:273`只接受1/2/3。直接新增字段沿schema3上传会破坏旧版读写，不能只加default。需新schema4读写门禁，先部署服务端、新客户端支持4，Android/CAgent保留不消费字段；旧版明确升级提示且禁止覆盖，测试注册首包、旧快照缺字段、账号切换及双设备合并。当前建议尚未实现。

## 明确同步范围差距

`capability-runtime.ts:14,101-107`支持portableConfiguration契约，但在生产适配器中未找到声明；当前CAgent能力包恢复的是选择+精确版本+清单摘要，不是每个插件设置均随账号。微信进程/账号绑定、设备授权等不应复制；可迁移非敏感设置需逐插件白名单适配后才能声称完成。

`core/ai.ts:72-79`共享AI只含policy/habits/providers及默认provider引用；没有threads/goals/events。目标记忆本地持久化已完成，但若“所有设置跟账号”包括目标、事件规则和历史，需要另行设计设备绑定/owner迁移及不重放操作，当前不能称已经云同步。

## 019发布前建议优先级

1. 关闭正在开发的Android账号/发现/分享差距；按账号发现开关同步需求作明确实现决定，不能从最终说明漏掉。
2. 明确插件非敏感配置的支持矩阵，未适配项标待恢复；避免“全部设置无缝恢复”的过度概括。
3. 对新增界面和多标签/断连真实测试；剩余电话短信运营商、4.2原生微信新消息等限制如实保留，不能借重发019改写历史证据。
4. 全部代码与测试固化后再启动019构建；本审计没有提前构建或发布。
