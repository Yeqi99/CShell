# Pro 后续账号体验进度

以 0.8.3 已发布版为基线，不移动旧标签、不覆盖现有账号或 OpenCode 数据。

## 2026-10-22：连接入口下载区

已实现新建 CAgent 连接页按需展开的多系统下载区。后端读取香港开源/Pro 目录，按平台架构选择最新的有效 CAgent 包，要求大小、SHA256、版本、文件名与可信 URL 一致。渲染进程不能提交任意下载地址。仅点击后打开下载，不安装、不授予设备权限。编辑既有连接不显示下载区。

验证：TypeScript、生产构建、两项元数据过滤测试通过；真实 Electron 界面读取香港目录，Windows/macOS/Linux 选项可用，默认收起、展开/收起保留主机草稿、无页面横向溢出。截图 test-results/agent-download-entry.png 已人工检查。复验脚本 scripts/agent-download-ui-smoke.cjs 使用隔离数据目录。

本增量尚未进入安装包；需与后续账号流程一起升级版本后构建安装发布，不覆盖用户当前运行的 0.8.3。

## 尚待完成

- 登录导入来源选择，开源版安全解密迁移、访客和多账号隔离、清除访客数据的范围确认。
- CAgent 登录后的 Pro 图标标识，以及同账号发现/会员连接的完整交互验收。
- 本机应用网络出口与移动端同步整合；旧端对未知云字段保留验证。
- 所有改动通过真实包验收后，递增版本、安装本机、发布并更新香港渠道。

## 2026-10-22：CAgent 账号入口与发现服务增量（未发布）

- 原生 WPF 品牌入口打开账号页；提供密码登录、邮箱注册、返回登录、退出确认。登录标识与付费会员身份分别呈现，聊天草稿保留。
- 设备登记与列表允许免费账号使用；免公网 IP 的 lease / relay 授权继续要求有效会员。跨账号身份绑定不可覆盖。CAgent 定时登记适配免费响应，但不会启动会员中继。
- 验证：Python 服务 10 项测试通过；TypeScript 检查通过；CAgent、OpenCode、云同步、下载过滤与工作区原型共 14 项测试通过。原生 C# 编译通过，隔离 WPF 测试验证密码遮罩、注册返回、邮箱/聊天草稿保留及免费身份。人工查看 test-results/account-native/flow.png 和 account.png。
- 尚未部署服务、安装用户本机或发布任何新包，0.8.3 下载渠道保持不变。原生界面通过的是隔离夹具，尚非真实账号联调验收。

### 账号隔离正在开发，不能误报完成

`src/core/account-workspaces.ts` 为未接入产品的加密工作区原型；`src/core/cloud-sync.ts` 添加了可选注册初始快照及登录前切换钩子，现有 adapter 尚未使用，注册仍需接入空白初始快照才能避免默认上传访客配置。切勿直接接线后发布：cloud bundle 不包含 AI 历史/授权、HTTP 历史、浏览器 Cookie、应用局部存储等，且 browser.cloudImport 为合并操作。需要完整隔离这些数据，并处理切换失败、认证持久化失败的回滚或重启恢复；退出也需同等处理。现有原型测试不能证明产品已隔离。

开源来源凭据必须在原 Electron userData 加密上下文解密（不能直接复制密文给 Pro 解密），迁移通道不可输出秘密；按来源概况与冲突选择后才导入。现有用户 OpenCode 已恢复，不自动重导。

CAgent 同样需要隔离 cached cloud bundle、assistant settings/shared/tasks，并在空云模型时清除前账号模型凭据；登录 UI 虽已完成，须等此项与真实同账号发现验收后才发包。现在不同邮箱直接切换要求先退出，避免设备身份静默重新绑定，不能用这一检查代替数据隔离。

### 后续进展：CAgent 已接入本机账号隔离（仍未发布）

上节的“CAgent 仍需隔离”已有代码实现：AccountWorkspaces 现已接入 CAgent，按 guest / accountId 保存独立加密 bundle 和 assistant settings/shared/tasks。新注册云端从空白配置开始；切换阻止活跃任务；退出恢复访客；新账号的智能体执行授权保持收敛。原生窗口按账号保存各自未发送草稿并清理前账号渲染内容。

CloudSync 账号激活钩子现在返回回滚函数，登录信息保存失败时恢复旧上下文；退出同样走激活。另为账号保留加密同步基线，避免退出前未上传的本机修改在重登录时被旧云端覆盖。现有桌面 adapter 尚未接入这些钩子，因此桌面隔离/访客导入/缓存 UI 仍是下一步，不能认为已完成。

新增 tests/cagent-cloud-accounts.test.ts 使用模拟云服务与真实 CAgentAssistant/ClientVault/CloudSync：访客不自动上传、A/B 偏好隔离、退出恢复访客、重登录保留未同步修改、OpenCode 和未知未来字段往返保留均通过。最新 TypeScript 检查和相关 16 项测试通过；C# 重新编译并验证 flow2.png.json 六项交互通过。依然没有真实账号/中继端到端验收，没有发布或改用户应用。

还需审查异常回滚失败后的隔离状态、崩溃恢复及并发操作，完成桌面全数据隔离（不能只套 cloud bundle）、来源导入解密/冲突 UI、访客清理，并实现移动端相同边界后统一构建发布。

## 2026-10-22：桌面端完整工作区隔离（未发布）

新增 DesktopAccountProfiles：升级后的原工作区原位保留并登记 legacy owner；之后的 guest / 不同账号进入 root/account-profiles/<owner> 独立 Electron userData 与 sessionData。不复制访客配置，只保留 OS 保护的 Local State 加密上下文。Windows Chromium 首次退出时才可能刷出 Local State，因此新进程在 Electron 初始化前补齐复制，不能在第一次登录时强制要求文件已经存在。

CloudSync 新增 activationTarget：认证写入目标目录后提交活动目录，当前进程停止同步并重新打开应用。不会在旧访客 adapter 上下载/上传账号数据；已有目标账号的同步基线保留。主窗口在提交切换时阻止新 IPC 操作，连接、传输、HTTP 或智能体任务活跃时拒绝切换。退出等待短暂后台同步完成，不要求用户反复点击。配置、权限、历史、扩展数据、Cookie 与 Chromium 存储随整个目录隔离。

验证：TypeScript 与相关 10 项单元测试通过；Pro 生产构建通过。scripts/account-profile-smoke.cjs 在临时目录、模拟云端、真实 Electron 中完成访客→账号→访客：连接与加密习惯不串入账号，持久 Cookie 和 localStorage 隔离，退出后访客数据恢复。测试拦截 relaunch 并手动重启隔离实例，不调用真实云服务。测试残余 Electron 已核对无存活。正式 CShell/CAgent 0.8.3 未关闭、未修改或安装。

仍未实现：来源预览与显式导入、冲突选择、访客缓存管理 UI；Android 同等隔离；实际账号和会员中继端到端验证；所有包与下载渠道更新。不得发布这个中间版本。下一步从读取来源实现：开源/访客只能从后台固定路径选择，在隔离 Electron 加密上下文中解密，秘密仅经受限父子进程管道传递，预览只向 renderer 返回条目概况。导入不转移本地授权，确认后合并并重新加密；清除不能递归删除 legacy 根目录（其中可能还有账号目录）。还需故障恢复、切换并发与 active IPC/API 的边界审查。

## 2026-10-22：显式来源导入与未登录数据清理（未发布）

- 新增只读 Electron 子进程来源读取器，使用来源 Local State 的独立临时加密上下文；秘密仅经父子进程私有 stdout 管道传递，不进入日志或 renderer。原配置不写入；失败不返回部分配置。独立入口 src/desktop/entry.ts 保证读取器不启动主程序或同步。
- 账号页“本机配置”展示开源/访客来源，用户点击后读取条目概况，再确认载入。连接与对应凭据绑定为一个冲突决策；模型、OpenCode、视图等按原 ID 合并，主机/CAgent 身份不一致拒绝导入。默认不覆盖外观、扩展偏好和默认模型，需单独勾选。来源预览 token 绑定账号、摘要及 10 分钟有效期，来源变化重新预览。
- 导入与同步/账号切换串行；云端自动同步后续继续。来源包含 OpenCode 加密凭据，目标通过各模块 import 重新加密。浏览器历史/收藏按 URL 合并，保留当前标签。回滚恢复主机信任集合及删除新增浏览器记录文件。
- 未登录数据清理有明确范围和二次确认。固定 allowlist 清理 guest 配置及 Chromium 缓存，不递归删除 legacy 根目录；保留账号目录、云认证、Local State 和设备身份。路径预检拒绝不安全路径。尚需补充锁定文件导致部分清理失败的用户反馈及更完整故障注入。
- 验证：TypeScript、Pro 生产构建通过；13 项账号/同步/导入/清理单元测试通过。scripts/account-source-smoke.cjs 用真实 Electron 加密夹具验证密码/OpenCode ID 保留、原文件逐字节不变、损坏来源拒绝；scripts/account-profile-smoke.cjs 回归通过。scripts/account-import-smoke.cjs 验证预览不导入、确认后连接/加密习惯载入、退出原访客不变；--clear 验证取消不清除、确认清理不影响账号、退出为干净访客（含 Cookie/localStorage）。截图 test-results/account-import-preview.png 已查看。测试仅使用临时目录与模拟云服务，正式用户账号/软件不变。

仍未收口：登录后主页主动提示（目前来源提示在账号页）、设置分类入口、来源缓存/跨进程并发与故障回滚进一步审查、移动端账号隔离/同步、真实 CAgent 同账号发现/付费中继验收、应用网络出口及全部正式包验证。不得把以上单元测试与隔离 Electron 流程当作全平台发布验收。当前 0.8.3 下载源保持不变；完成剩余要求后再递增版本统一发布。

## 2026-10-22：登录后的来源提示与 Android 边界排查（未发布）

- 顶栏账号下方提供一次性、可关闭的来源提示，列出开源/访客来源，点击“查看并选择”进入账号页；不抢焦点、不自动导入。每个隔离账号工作区单独记住提示已处理，设置中的“账号与云同步”本来已复用 CloudSettings，因此载入及清理入口同样可用。
- 真实 Electron scripts/account-import-smoke.cjs --clear 已验证提示显示、提示本身不导入、查看后关闭、显式导入与清理全链路。test-results/account-source-notice.png 已查看；TypeScript/Pro 生产构建通过。清理文件被占用时改为明确提示未全部完成，不能误报成功。
- Android 检查发现后续必须处理的实际缺口：web/cloud.ts 注册直接打包访客连接；WebView profiles/theme/cloud-snapshot-hash 共用未隔离；logout 仅移除 session/key 但保留 bundle，旧 fillCredentials 没有检查登录解锁状态。本次先给 fillCredentials 增加 session + key 前置检查，阻止退出后继续使用账号凭据；完整账号/访客隔离、未上传更改保留、注册空白云初始数据与显式载入仍需一起实现，不能只改注册为空而丢掉访客配置。Android 原生浏览器/机器凭据存储也需纳入隔离审查，不可只改 localStorage 便宣称完成。
- 桌面导入还有异常回滚失败后阻止继续上传、跨进程并发及设置草稿相容性需要进一步验证；CAgent 真实身份发现/会员中继、网络出口、各平台正式包验收仍未完成。0.8.3 下载源、正式应用及真实用户配置不变。
- Android compileDebugJavaWithJavac 离线编译成功（Pro 构建配置）；存在已有 SDK XML/Gradle 弃用警告。本次不是 Android 真机测试或安装包发布。

## 2026-10-22：测试启动异常恢复

用户看到的“登录状态与本机工作区不一致”来自新隔离实现的测试版本。正式安装的 Pro app.asar SHA256 仍为 D581ADC37A56AF3897D1C0FB1E098DF89BBBE8CFA754054A464A600201FED967；检查安装内容不包含该报错，未修改正式用户配置。
已将不一致情况改为：保留原加密登录文件为 cloud-sync-recovery-*.enc，不联网、不上传、不改原配置；提交 guest 目录并重新打开；登录页说明原配置保留、可重新登录。隔离测试 CSHELL_TEST_DATA 启动异常只写诊断，不弹系统错误框。TypeScript/Pro 构建通过；8 项相关单元测试通过；真实 Electron scripts/account-recovery-smoke.cjs 验证备份、原账号文件保留、干净 guest 启动、零云请求及零系统错误框，截图已检查。仍待和剩余功能统一发布，未安装中间版。
用户授权给 854124946@qq.com 开通会员，已在香港生产库更新并写 admin_audit；账号 02d3ad7b5a484afc8bba4947f7a502d6，首次赠送一个日历月，到期北京时间 2026-11-22 22:59:08。不要重复赠送或重复延长。

用户新增内核优先需求：CSV（含 iShell 等可识别字段）批量导入、多连接字符串预览解析；本机→目标及机器→机器延迟测试；CAgent 可视化桌面“机器信息”应用，详细概览/CPU/GPU/内存/磁盘/网络、真实时间序列与缺失能力状态；修复免费模型编造 server.cpu.view/server.disk.view 权限节点和吐出 Previous tool result，增强工具使用提示。必须先独立开源内核分支实现验证，再集成 Pro，保留全部已有 Pro 追加目标，不在 Pro 专属代码里重复开发内核。
