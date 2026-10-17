# CShell 微信工具包（实验版）

CShell 微信扩展通过 `cshell_wechat.desktop` 受信任本机子进程入口接入进程检查、联系人候选、文本发送和限时接收。该入口由 CShell 后端执行插件启用、智能体权限、实验确认、进程绑定和联系人白名单检查；不是独立的远程 API，不应直接暴露给模型或网络。常规 CLI 的隔离状态不变。好友管理暂未接入扩展。

当前不是可发布的完整微信协议实现。Windows 4.1.15.50 的一条私聊文本发送由用户确认送达，一条私聊文本接收已解析；随后群聊探针测试发生 `frida-agent.dll` 崩溃。因此本包封锁实时收发入口，安装后默认关闭。不能把研究成功记录理解为生产稳定性。

2026-10-17：已整合原生接受好友申请候选。来源 30 的一条真实测试申请已由原生调用接受，记录状态变化与用户确认“已添加”一致。新增本机维护入口、精确进程/版本校验、五分钟快照期限、请求级持久去重和未知结果禁止重试。正式 `friend_requests.accept` 入口仍返回 `ADAPTER_QUARANTINED`，不自动开放给 Agent。

后续原生 C 接收回调已通过 10 次独立夹具挂载/卸载，并解析一条真实测试群消息的群 ID、成员和正文；中文群消息发送也已由用户确认收到。此候选实现已收录，但尚不足以解除稳定性隔离。完整通讯录所需数据库句柄已定位；因其无数据库互斥锁，跨线程查询已在执行前拒绝，完整列表与群成员枚举仍未完成。

后续研究在数据库所属线程完整读到指定测试群的 3 位成员；完整通讯录分页尚未通过。清理已增加停止失败时禁止继续卸载、活动回调等待与保留会话报告，4 项新增回归测试通过；这些改动尚未证明解决微信崩溃或假死，实时能力仍封锁。

它适配已登录 Windows 客户端内部数据结构，不实现微信服务器网络协议，不登录新账号、不使用 UI 自动化。只支持精确模块 SHA256；升级后拒绝执行，不回退旧地址。

## 安装与调用

需要 Windows x64、Python 3.11+。发行 ZIP 中的 `install.ps1` 创建独立虚拟环境、从附带 wheels 离线安装并检查工具目录。不会启动监听、修改微信、添加启动项或自动授予权限。运行前使用 `verify-package.py` 校验目录清单。

```powershell
./install.ps1 -Python 'C:/Path/To/python.exe'
'{}' | & "$env:LOCALAPPDATA/CShell/tools/wechat-bridge/venv/Scripts/cshell-wechat.exe" capabilities
'{"pid":1234}' | & "$env:LOCALAPPDATA/CShell/tools/wechat-bridge/venv/Scripts/cshell-wechat.exe" inspect
```

每次进程从标准输入接受一个最多 64 KiB 的 JSON 对象，stdout 返回一个 JSON 结果。无网络端口。Agent 未来应通过独立子进程调用，并从其本机权限后端生成受限配置；不要把 `configure` 暴露给远端模型。当前未接入 Agent 工具注册表或应用市场，不显示为已可安装的正式能力。

| 入口 | 输入 | 当前范围 |
|---|---|---|
| capabilities | `{}` | 可用入口、被封锁入口、缺失功能 |
| inspect | `pid` | 模块版本/摘要、进程创建时间，仅读取 |
| configure | `pid,confirm:true,enabled,readContacts,send:[],receive:[]` | 本机显式授权；进程重启失效；实时入口仍受版本隔离状态阻止 |
| disable | `{}` | 撤销本工具授权，不修改微信设置 |
| contacts.cached | `pid,budgetMB:256` | 有界读取已加载联系人候选，明确 `complete:false`，最多 512 MiB、30 秒 |
| messages.decode | `message:{from,to,member,text,type,messageId,timestamp}` | 对调用者提供的数据做离线解码；群成员前缀和常见 XML 元数据 |
| friend_requests.decode_detail | `detailBase64` | 离线解析好友记录详情：保留历史记录、重复子消息、原始标志和未知字段；不推断可接受/拒绝状态 |
| friend_requests.accept | — | **正式入口封锁**；原生候选通过一条实际申请验证，仅供本机维护入口试验 |
| messages.listen | `pid,targets:[],seconds:30` | **封锁**；实现限时队列、身份过滤、缺口反馈，尚未通过稳定性验收 |
| messages.send_text | `pid,recipient,text,idempotencyKey` | **封锁**；一条文本、精确内部 ID、幂等日志，不自动重试未知结果 |

别名或备注不能直接作为发送地址。缓存存在旧副本、冲突副本、未加载记录；候选列表不能被当作完整通讯录或单独用于确认收件人。读取结果不默认落盘；不要把个人联系人数据放进发行包。

## 错误与恢复

- `DISABLED` / `NOT_AUTHORIZED`：需要本机用户按明确范围配置，远端不可自行扩大。
- `SESSION_CHANGED`：微信进程重新启动，必须核对账号后重新绑定。进程绑定不能证明运行中账号没有切换，因此当前实时功能不开放。
- `UNSUPPORTED_VERSION` / `CODE_CHANGED`：停止调用，完成新版适配，禁止只修改版本号或强制跳过摘要。
- `ADAPTER_QUARANTINED`：已知崩溃未解决，不应重试；由维护者完成稳定性验收后更新适配器。
- `BUSY`：同一工具状态目录已有调用。当前操作串行，不支持同时监听与发送。
- `IDEMPOTENCY_CONFLICT`：同一键的参数不同；检查调用方错误。
- 发送 `unknown`：可能已经产生副作用，不能换一个键盲重试；人工核对聊天记录。
- `JOURNAL_FULL`：10000 条上限；人工归档日志前必须保留未知结果。日志保存摘要与状态，不保存正文，当前无自动过期。

已存在的研究代码使用的开源仓库仅作为人工分析参考，没有复制其实现或二进制。运行依赖 Frida 和 pefile 采用各自许可证；原始微信二进制、内存、联系人、凭据、测试状态目录均不随包分发。Frida 的进程内注入并非崩溃隔离，外部 Python 子进程也不能消除对微信的影响。

协议覆盖和版本升级步骤见仓库 `docs/WECHAT-ADAPTER.md`。

好友详情解码使用 4.1.15.50 的结构映射，已通过 12 条真实详情缓冲的线格式核对，未发现未知字段。结果中的 `status:unknown` 与空 `actions` 表示状态语义未确认，不表示没有好友记录。二进制字段保留 Base64，64 位整数以字符串返回；输入和字段数量有界。2026-10-17 曾再次观察到 Frida fail-fast，线程上下文检查尚未证明解决全部崩溃。

## 本机维护：接受申请候选

安装后维护脚本位于 `%LOCALAPPDATA%/CShell/tools/wechat-bridge/maintenance/accept_request.py`，使用同目录 `venv/Scripts/python.exe`。显式参数为 `--confirm-target <内部wxid> --acknowledge-unstable`；JSON 快照由标准输入传入，不在命令行携带票据。该入口会产生真实接受请求，不能暴露给远端模型，也不能使用模型自行生成的快照。

快照必须来自操作者刚完成的可信本机读取，包含且仅包含：`binding`（pid、created、moduleSha256）、`target`、`encryptedIdentity`、`ticket`、`scene`、`detailBase64`、`observedAt`（Unix 秒）。必须核对普通内部身份与 v3/v4 字段属于同一条申请；脚本只校验格式和绑定，不独立证明快照真实性，也不自动读取或刷新数据库。来源只接受已实测的 30，详情顶层字段 2 必须为 1，快照不得超过五分钟。当前不支持指定备注、标签或朋友隐私权限，不保证客户端默认权限语义；这些选项需单独验证。

请求级去重日志固定保存到工具状态目录 `accept-journal.sqlite3`，只保存摘要和结果，不保存身份、票据原文。同一票据即使进程重启或改变调用键也不会再次调用。`native_returned` 仅表示原生调用返回，必须用独立状态读取或人工查看确认“已添加”；`unknown` 不得删除日志后重试。`replayed:true` 表示没有新提交。调用限时等待 60 秒，清理失败保留 unknown；不声称超时能取消已发送请求。

包不含真实申请快照、联系人、票据或研究输出。维护入口仍可能使微信崩溃；进程绑定不能检测同进程切换账号，切换账号后必须重新读取并核对。安装不会启用此入口或重做已完成的申请。

## CShell 本机实验扩展（2026-10-17）

插件市场安装“微信（实验）”，在独立工作区选择本机微信进程，分别配置发送、实时接收、历史读取目标并保存。智能体访问权限中的“微信读取 / 微信发送”是另一层授权；切换远端标签不改变微信所在机器。默认关闭，不把历史授权从接收授权自动继承。离线包当前携带 Windows x64 Python 3.12 的依赖轮子，需使用 Python 3.12 安装。

CShell 后端通过固定路径的本机 Python 子进程调用 `cshell_wechat.desktop`，没有监听网络端口。只有当前精确模块摘要和进程创建时间匹配才调用；重启微信后需要重新绑定。允许列表用内部 ID 或 filehelper，不能凭备注猜测收件人。发送保持先记 unknown 的持久幂等日志；取消和超时不能撤回已经提交的消息，不自动重试。当前仍是实验适配，已知崩溃风险未被隔离。

当前智能体工具：`wechat_status`、`wechat_contacts`、`wechat_send_text`、`wechat_receive`、`wechat_history`。好友接受候选仍只在本机维护入口，没有把未经完整验证的删除、拒绝、置顶等标记为可用。普通 CLI 的 live quarantine 保留；桌面实验通道必须显式授权，不代表稳定性验收完成。

历史读取是真实数据库查询，不是监听缓存：在数据库自身线程触发只读 SQL，最多 30 条，约 30 秒等待读取活动，原生查询预算 100 ms / 64 KiB。空闲时可能返回 HISTORY_UNAVAILABLE，需要打开对应会话或滚动历史后重试读取。查询不提取数据库密钥，不执行任意调用方 SQL。文本支持已核对的 UTF-8 与 Zstandard，媒体只返回元数据。解压、记录尺寸和返回量均有界，过大或未知编码标记 contentStatus/gap。

首次 direction=latest；向前翻页用 olderCursor + before；增量续读用 newerCursor + after。结果按 local_id 升序，64 位 ID 保持字符串。调用方须处理完成后持久保存游标，并按 deduplicationKey 去重；工具不会自动提交消费进度，不会启动后台同步。重启后重新绑定同一账号进程再沿用游标。数据库路径范围改变或游标锚点消失时明确拒绝或返回 gap，不能把空结果误当成已经同步。覆盖只限本地 message_0.db；其他分片、删除记录、远端未落盘消息未覆盖，complete 恒为 false，不提供完整补偿保证。

验证：32 项 Python 测试（含同时间戳分页、续读、游标锚点丢失和压缩上限）；实际文件传输助手读到 8 条历史记录、5 条文本解码，探针 codeRestored/unloaded 均为 true。桌面隔离夹具验证插件安装、原位配置、初次加载禁用编辑、保存及重启保留；未用夹具调用发送。用户数据和历史正文不进入发行包。

客户端升级时先停用原生通道；重新记录 DLL 摘要、函数 ABI/线程归属、消息表及 Name2Id 映射、WCDB 压缩标记；用隔离夹具和测试账号核对私聊/群聊/历史分页及清理，再新增独立 profile。不能只更新偏移、修改版本号或绕过摘要检查。

## 修改好友备注（2026-10-17）

桌面扩展新增 `wechat_get_remark` 与 `wechat_set_remark`；允许修改备注的好友 ID 独立保存在 `remarks`，旧配置迁移为空，不继承发送、接收或历史读取范围。修改还需智能体应用权限 `wechat.contacts.manage`，执行按现有审核策略处理。仅支持个人 wxid，不支持群、公众号或文件传输助手；先按准确 ID 读取备注，随后传入 `expectedRemark`、`remark`、`idempotencyKey`。空字符串表示清空，长度最多 64 字符且 UTF-8 不超过 128 字节，拒绝控制字符。

原生适配固定到 4.1.15.50 已核对的 DLL 摘要，沿当前协程获取联系服务：get_coro 0x47220 → get_svc 0x381870 → get_contact 0x4737f0 → lookup 0x102a950 → set_remark 0x10521f0。在调用前核对模型 username(+0x8) 与备注(+0x78)，不直接写联系人内存或数据库。字符串按 UTF-8 字节构造 MSVC std::string，区分短字符串和堆字符串。原备注不符返回 conflict，不提交修改；该检查不等于对其他设备的服务端原子比较交换。

独立 `remark-journal.sqlite3` 保存操作摘要与结果，提交前写 unknown，跨进程重启去重，参数变化拒绝复用键。调用返回仅是 native_returned/serverConfirmed:false，必须再读取或人工确认；未知结果禁止换键自动重试。注入、执行、卸载均有现有边界与清理检查，适配仍有崩溃风险。未成功 arm 且清理完成时可明确 not_submitted。

升级时重新核对联系服务 ABI、对象布局、字符串编码、协程上下文及真实保存语义；不能仅改偏移启用。测试限定已授权的测试联系人，并恢复原备注。


CShell 0.6.1 的发送设置支持 `*`（所有有效账号），发送黑名单优先拦截。留空禁止发送，原有配置不会自动扩大范围；点击保存才生效。接收、历史、备注仍按各自明确授权列表执行。
