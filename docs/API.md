# CShell API 与 MCP（开发中）

此接口面向通用客户端。当前实现范围和未完成项见 [实施记录](API-IMPLEMENTATION.md)。

扩展工具的完整契约包含解析后 JSON 结果 schema，指南包含有效参数形状的示例。Python、环境、应用安装与 Docker 返回值均在共享 Provider 注册表校验；不匹配时报告 OUTCOME_UNKNOWN，不重放已执行动作。环境/安装动作返回的 job.state 才表示远端作业成功、失败或取消，不能把 HTTP 200 当作作业成功；job.output 是有界尾部。先通过环境清单、文件读取、安装计划或 Docker 清单取得真实解释器路径、revision、planId 和容器 ID，不能直接执行指南中的示例标识。
内置 AI 与 API/MCP 共用后端机器范围、操作覆盖和应用能力判断；它们仍是独立调用方，配置不会互相继承或合并权限。旧配置只读适配，审核策略不扩大能力或机器范围。
服务默认关闭，监听本机 `127.0.0.1`。在偏好设置的 AI 与安全中显式启用，选择允许访问的保存连接。
建议为每个客户端创建独立令牌与授权；令牌由后端加密保管，通过复制按钮交给客户端。
不要将令牌写入项目、日志、外观方案或 URL。HTTP 使用 `Authorization: Bearer <token>`。

## 固定入口

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/mcp` | POST | 标准 Streamable HTTP MCP，工具输入为完整 JSON Schema |
| `/api/v1/capabilities` | POST | 授权能力发现、查询和契约读取 |
| `/api/v1/invoke` | POST | 按稳定能力名称调用，直接返回 JSON 结果 |
| `/api/v1/call` | POST | 兼容入口，保留 MCP 内容封装 |

端口以已保存配置为准。服务拒绝浏览器 Origin 和不匹配的 Host。HTTP API 不支持浏览器跨域访问。
请求体最大 64 KiB。响应含 `apiVersion: "1"`；成功封装在 `result`，协议/调度错误在 `error`。
推荐使用 invoke：成功返回 `{apiVersion:"1",result:...}`；失败返回 `{apiVersion:"1",error:{code,message,nextAction}}` 和非 2xx 状态码。参数错误为 400、未授权 403、不存在 404、冲突/过期游标 409、预算过小 422、过载 429、不可用 503、超时 504，执行失败或结果未知为 502。不要仅凭状态码决定是否重试副作用。
call 兼容入口仍使用 `result.content[0].text` JSON 文本及 `result.isError`；该入口的 HTTP 200 不保证工具成功。MCP 协议保持不变。认证失败可能返回空的 401，客户端应先检查认证状态再解析结果。

旧 `list_files` 与 `monitor` 也遵守目标审核策略：“全提示”先审批，拒绝则不读取；审批后重新核对权限和连接，撤权不能被迟到的批准恢复。审核策略不会授予文件或监控能力。配置更新可能关闭在途 HTTP 连接，客户端不得将断线当作操作成功。

## 从发现到执行

1. 向 capabilities 发送 `{ "level": "names" }`。从返回的 ID 选择能力，不猜工具名或参数。
2. 发送 `{ "capabilityId": "list_servers_page", "level": "contract" }` 读取准确契约。
3. 向 invoke 发送 `{ "name": "list_servers_page", "arguments": {"limit":100,"budgetBytes":65536} }`。从 items 读取连接；有 nextCursor 时携带同一 query 继续，直到游标为 null。
4. 使用列表实际返回的 profile ID 调用 `connect`。凭据留在 CShell，不能传入任意主机地址绕过范围。
5. 用实际返回的 sessionId 调用 `describe_connection`，或向 capabilities 发送 sessionId 与 `level: "contract"`。
6. 将该连接发现的 tool 名称和参数交给 `invoke_connection`。连接目录中的工具属于该 Provider；不能假设 SSH、Agent 主机和 WSL 等价。
7. 结束后调用 `disconnect`。客户端不能采用桌面终端或其他客户端的 sessionId。

`list_servers_page` 支持不区分大小写的 query（名称、地址、用户名和协议），每页最多 200 项。total 与 remaining 只统计授权后的搜索结果。游标绑定调用方、授权版本、查询及可见连接内容，五分钟过期；变化后返回 CURSOR_EXPIRED，需从头读取。budgetBytes 限制 JSON 结果字节数，不含传输封装；单项超预算返回 BUDGET_TOO_SMALL，不裁掉字段。旧 `list_servers` 保留原数组返回格式供兼容使用。

连接、目录、监控、命令、终端和任务入口的结果在后端按输出 schema 检查。契约内 MCP 文本的 contentSchema 描述 JSON 内容；invoke 直接返回该内容。Provider 的字符串结果仍须按所选工具契约解释；异步任务 result 是该操作的结果，不能假设所有任务返回相同结构。

调用包格式示意（变量必须取自上一步返回值）：

```js
const response = await fetch(`${base}/api/v1/invoke`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'connect', arguments: { profileId } }),
});
if (response.status === 401) throw new Error('CShell authentication required');
const envelope = await response.json();
if (!response.ok || envelope.error) {
  // Read code and nextAction; never blindly replay a side effect.
  throw new Error('CShell call did not succeed');
}
const { sessionId } = envelope.result;
```

## 披露配置

所有详情级别（包括 names）均返回稳定 id、name 和 version。version 是完整契约内容摘要，目录 revision 同时绑定调用方和授权。缓存按客户端、目标与能力 ID 隔离：读取完整 names 分页集合，比较 version，仅重新读取新增或版本变化项的 contract/guide；删除本轮集合中已消失的项。分页中 revision 变化或 CURSOR_EXPIRED 时丢弃这一轮并重读，不能拼接不同修订的结果。契约版本不代表运行中任务版本，也不授予执行权限，后端始终复核当前授权。

模式与详情粒度独立，均不改变执行授权：

| 配置 | 含义 |
| --- | --- |
| full | MCP 同时列出各能力及固定发现/调用入口 |
| progressive | MCP 只保留 `discover_capabilities` 和 `invoke_capability`，从目录按需读取契约 |
| adaptive | 根据明确目录字节预算选择上述入口，不推测模型上下文大小 |
| names | 稳定 ID 与名称，响应保留版本和分页元信息 |
| summary | 另含简述、目标、权限和读写影响 |
| contract | 另含完整输入输出 schema、前置条件、取消和重试说明 |
| guide | 另含已提供的示例；当前部分能力的示例仍待补齐 |

每次发现可以显式覆盖 `level`、`query`、`capabilityId`、`limit`、`budgetBytes`。
Provider 工具仍返回字符串；已声明 JSON 结果的工具在 outputSchema 中给出 `type: "string"`、`contentMediaType: "application/json"` 和解析后的 `contentSchema`。例如文件分块字段、目录分页字段与独占创建结果都有完整字段契约，guide 提供输入示例。后端校验已声明的结果 schema；执行后格式不符返回 OUTCOME_UNKNOWN，不自动重放。未补齐结构的旧工具仍只声明字符串，不能假定全部结果都可解析为 JSON。
预算针对目录结果 JSON 字节数，不是模型 token 保证。超大契约返回 `BUDGET_TOO_SMALL` 和所需字节数，不截断 schema。
`nextCursor` 非空时继续分页；保持相同查询、ID 和详情级别。游标绑定客户端、授权修订及目录。
`CURSOR_EXPIRED` 表示重新发现；不能把另一客户端的游标移用。目录不会返回未授权资源的名字或计数。

## 任务、取消与重试

SSH 文件读取通过连接目录中的 `read_file_chunk` 提供，需 `files.read`。首次参数为 `{path, offset:0, limitBytes:16384}`，后续带上返回的 `revision` 和 `nextOffset`；nextOffset 为 null 表示结束。结果是 JSON 字符串，body 使用 base64，保留二进制字节，每次最多 65,536 字节。现有 read_file 仍用于最多 64 KiB 的 UTF-8 文本。

SSH 目录使用 `list_files_page`，参数 `{path, limit:100}`，再携带 `nextCursor` 续页；null 表示结束。每页最多 200 项且结果 JSON 不超过 64 KiB，不截断单个条目。游标绑定本次连接、输入路径及实际目录元数据列表，五分钟后过期；列表变化或游标不匹配返回 CURSOR_EXPIRED。每页重新扫描目录（现有目录服务上限 50,000 项），不保留跨页快照或目录句柄；它不是远端原子快照，也没有宣称恒定时间翻页。

文件版本依据路径、大小、修改时间等 SFTP 元数据计算，每块读取前后都核对；变化返回 CONFLICT，应丢弃已拼接内容并重新读取。`consistency: "metadata-best-effort"` 明确表示并非快照：相同大小且修改时间未变的内容替换可能无法发现。取消在 SFTP 请求之间检查，仅关闭此次打开的文件句柄，不关闭共享连接。只有真实提供该工具的连接才可调用，不能推定 Agent 或本机也已支持。

SSH `create_file` 需独立的 `files.create` 授权，旧配置不自动获得。参数 `{path, bodyBase64}`，最多 32 KiB 原始字节，使用标准且完整的 base64；请求文件权限为 0600。远端以独占创建方式打开，不覆盖现有路径。并发创建仍以远端独占条件为最终裁决，应用冲突锁不能替代该条件。
此能力不是原子发布：打开后即可能出现空文件或部分内容；成功仅表示服务器确认写入和关闭，不保证持久落盘。取消、断线或写入错误可能返回 OUTCOME_UNKNOWN，先检查目标，不自动删除或重试。为避免重复提交，使用 task_start 和幂等键，但仍遵守任务保留期及进程生命周期限制。

创建、分块写入与 Python 条件保存共用文件冲突域：同一目标中 `./dir/file`、`dir//file` 与 `dir/./file` 串行，其他文件和目标仍可并发。此规则只合并词法别名，不改写传给服务器的路径；不会折叠可能跨符号链接的 `..`。符号链接、硬链接、大小写别名及相对/绝对路径之间尚无统一远端对象身份，因此不保证这些别名之间互斥；也不协调外部进程的写入。

SSH `create_directory` 使用独立的 `directories.create` 授权，默认关闭，旧 `files.create` 授权不包含它。通过 `invoke_connection` 调用，参数例如 `{path:"./new-directory"}`。只发送一次 MKDIR，父目录必须存在，不递归创建、不覆盖、不自动 chmod；请求权限 0700，实际权限由服务器策略决定。返回 `{path,created:true,requestedMode:"0700",durability:"server-acknowledged"}`，不保证持久落盘。明确的权限拒绝、已存在、不支持分别返回 FORBIDDEN、CONFLICT、UNAVAILABLE；服务器仅给出笼统失败或取消后已确认创建时返回 OUTCOME_UNKNOWN，先检查目录再决定后续动作，不盲目重试或删除。此工具与文件创建共用路径冲突域；可用 task_start 幂等键抑制保留期内重复提交。

SSH `rename_file` 与 `delete_file` 分别需要 `files.rename`、`files.delete`，默认关闭，均只处理普通文件。先用 `read_file_chunk` 读取准确路径的 revision，再提交 `{path,revision,acceptNonAtomic:true}`；重命名还需 `destination`。目录、符号链接、版本不匹配在提交前拒绝；重命名先检查目标不存在，使用标准 SFTP RENAME，不用覆盖式 OpenSSH 扩展。元数据检查与变更并非远端原子事务，外部路径替换可能竞态，不能把 acceptNonAtomic 当作原子保证。重命名同时预约源、目标两条路径冲突域，全部可用才执行；删除复用文件路径域。独立路径与机器仍可并发。删除永久生效，没有回收站或恢复保证。提交后取消或模糊失败返回 OUTCOME_UNKNOWN，检查涉及路径，不自动重试、回滚或恢复；重复请求优先使用任务幂等键。

`write_file_chunk` 需独立的 `files.write` 授权。参数包含 path、offset、revision、bodyBase64 和 `acceptNonAtomic:true`，每次最多 32 KiB 原始字节。使用读取结果的 metadata revision，后续使用写入返回的新 revision；不能跨越当前文件末尾制造空洞。先独占创建空文件再连续写块可上传大文件。每块核对元数据，非原子发布，也不是外部写入者之间的原子条件写；出错后可能保留部分内容，返回未知结果时先检查目标。

`task_start` 接受 API-owned sessionId、实际 Provider tool、arguments 和可选 idempotencyKey。
重复键加相同请求返回同一个 taskId；同一客户端用该键提交不同请求返回 CONFLICT。
键只在当前进程的保留期内有效，不能当永久去重凭证。

`task_read` 使用 taskId、after（初始 0）和 limit 读取事件；继续使用 nextCursor。
`gap: true` 表示早期输出已被淘汰，返回内容不是完整日志。慢客户端不会阻塞任务输出。
`task_cancel` 仅请求取消；轮询至 settled。`unknown` 表示无法确认远端结果，必须检查目标后再决定是否重试。
SSH 输出可实时续读，其他 Provider 可能只返回最终结果。任务存活于当前 CShell 进程，重启后不可恢复且不会自动重放。

当前默认界限：全局 16 个执行槽、每客户端 4 个、每目标 4 个；队列 64 个、每客户端 16 个。
连接全局 32 个、每客户端 8 个；HTTP 在途请求全局 32 个、每客户端 8 个。
任务读取/取消另保留全局 16、每客户端 2 个控制请求槽，普通执行饱和不占用这些槽。请求体读取也独立限流。
任务保留总量 128、每客户端 32，完成后 15 分钟；事件 64 KiB，结果 256 KiB。
这些是资源上界，不是已验证的服务吞吐承诺。超载应等待现有任务结束，不能立即无限重试。

## HTTP 工作区

先在 CShell 启用 HTTP 插件并建立工作区，显式授予客户端该工作区 ID 与 `http.use`。
目录才会列出工作区实际启用的 `http_list`、`http_save_request`、`http_send` 和 `http_history`。
工作区取消某项工具后，目录同步失效，调用不能继续沿用旧授权。

远端发送另需 `http.send`，且对应保存连接在允许范围内、已经由当前 API 客户端打开。
本机发送另需 `http.send.local`；远端失效不会回退本机。`http_list` 仅列出当前客户端可用的发送方。
保存请求可携带真实 sender ID，也可通过 requestId 复用工作区中后端保存的凭据。列表不返回保存的秘密请求头。
发送方、工作区与请求修订在审核后再次核对；执行历史与桌面工作区共用，响应内容视为不可信数据。
`http_send` 为有界同步请求；`http_task_start` 接受 `{arguments:<http_send 参数>,idempotencyKey}`，使用相同工作区、发送方授权、审核与历史服务。通过 task_read/task_cancel 查询和取消，重复键不重复发送；请求取消不证明接收方未执行。

发送结果和历史列表提供最多 24,000 个 UTF-16 字符的 UTF-8 文本预览。`previewTruncated` 表示预览截断，`captureTruncated` 表示底层捕获已截断；`truncated` 为两者任一发生。二进制响应不要使用文本预览恢复。
调用 `http_history` 并提供 `{workspaceId, historyId, offset:0, limitBytes:16384}` 可读取保留的原始字节，响应 `body` 为 base64，`encoding` 为 `base64`，`retainedBytes` 为保留长度；用 `nextOffset` 续读，直到 null。每块最多 65,536 字节，offset 按字节计数。所有分块仍检查工作区授权；历史淘汰返回 NOT_FOUND，不重新发送原请求。`captureTruncated` 为 true 时只能恢复已保留部分。

## 授权与生命周期

授权目标、应用能力和审核策略分别检查。审核通过不能扩展机器范围；执行前重新检查权限和目标身份。
旧单令牌的目录和监控访问维持原行为，新客户端不继承这些授权。文件内容读取和 Agent 管理/托管/中继需独立授权。
轮换独立客户端令牌会撤销该客户端连接与任务；其他客户端和桌面用户终端保持不变。
服务配置保存或关闭会撤销 API 连接。未收到结果不表示远端已回滚，尤其是任意 Shell 命令。
审计记录客户端 ID、调用 ID、目标/会话 ID（适用时）、能力名、时间、尝试/结果阶段和成功标记，不记录令牌、命令正文或文件内容。
执行前必须成功写入审计尝试；存储不可用时停止接收执行请求。执行后审计失败明确报告未知结果，不能自动重试。

执行调度队列默认最多等待 30 秒。超过等待期限返回 `DEADLINE_EXCEEDED`，明确该次操作尚未开始；已运行操作的锁和并发配额不会因此释放。排队取消、获准执行和超时均清理计时器与取消监听。此期限只约束调度等待，不表示远端执行、网络响应或审批必定在 30 秒内结束；后台任务查询中的最终状态仍需按任务语义处理。

审计采用有界写入队列，硬上限 128 条待写记录；普通调用在 64 条时开始返回背压，为任务读取/取消及已运行操作的结果记录留出空间。任务控制仍须通过身份/归属检查与审计落盘；预留不承诺在磁盘停滞或剩余空间耗尽时立即取消。磁盘失败仍关闭执行入口；结果审计失败仍按未知结果处理，不能据此自动重放副作用。

`terminal.read` 是独立、默认关闭的 API 能力。授权后新开的内置 SSH/Agent 会话从初始输出开始保留最多 256 KiB UTF-8 字节；`terminal_read({sessionId,after?,limitBytes?})` 每页最多 64 KiB，以 base64 返回。仅能读取调用方自己打开的实时连接，不能读取桌面用户终端。字节页可能切开字符，应使用流式 UTF-8 解码；发生 `gap` 时丢弃解码器未完成字符，`lostBytes` 表示缺失字节。日志不等同屏幕快照，关闭、撤权、令牌轮换或服务停止会清理相应日志，没有断连恢复保证。全提示审核模式对读取也要求批准。

`terminal.input` 为默认关闭的独立权限，允许向自己打开的 API 终端发送文本或控制字符（换行可能执行命令，Ctrl+C 使用 U+0003）。先调用 `terminal_state({sessionId})` 获取 `nextSequence`，再调用 `terminal_input({sessionId,expectedSequence,data})`，单次 1–8192 个 UTF-16 码元。同一会话输入按冲突域串行并复核序号；并发/过期请求返回 CONFLICT，不重复提交。序号在调用 Provider 前消耗，提交异常也不退回；响应丢失后不得把新的序号当成重发许可，应检查输出和目标状态。返回 `accepted:true` 仅表示本地 Provider 接收了提交，不证明远端处理、命令成功或子进程终止。命名客户端独占自己的 API 会话；同一客户端的多个调用通过序号协调，不能接管桌面会话。全提示/限制执行模式要求审核实际输入，审批后再次复核归属、权限和序号。terminal_resize 使用相同权限、冲突域和 expectedSequence，参数另含 cols（2–500）与 rows（2–300）。输入和 resize 共用递增序号。

终端工具的 `contract/guide` 披露现在包含 `content[].text` 的 `contentMediaType: application/json` 和 `contentSchema`，分别描述成功负载与统一错误。原生 `/api/v1/invoke` 的 `result` 即成功负载；MCP 与兼容 `/call` 仍以 JSON 文本封装。指南给出读取游标、获取输入序号及 Ctrl+C 示例，示例 sessionId 必须替换为自己的 connect 返回值。返回成功前按同一 Zod 契约验证终端负载；不匹配按未知结果处理，禁止自动重放输入。

## 目标与应用授权

`allowedProfiles` 仅包含明确选择的保存连接。`targetPolicies[profileId]` 完整覆盖该目标的 capabilities、allowCommands、review；它不会把未列入范围的目标加入授权。审核策略只控制已授权操作是否提示。缺失的新能力不会由迁移自动授予。

`allowedLocalShells` 是独立本机范围，实际可用的 CMD、PowerShell 与已启用插件发现的 WSL 发行版分别选择。通过 list_local_targets 读取实际 profileId，再 connect；远端授权不允许访问本机。本机 Provider 目前只披露真实终端能力，不借用主机文件或监控冒充 WSL 能力。

`applicationCapabilities` 独立授权 plugins.read/plugins.manage。plugins_list 返回安装状态，plugin_manage 安装内置插件、启停或移除。此操作影响整个 CShell，不能增加 API 机器授权。排队修改在出队时再次检查取消。

## 扩展与共享服务

SSH 连接按真实插件状态披露 Docker 查询/操作、Conda 环境查询与修改、应用目录/安装计划/执行，以及 Python 语义分析和文件编辑。插件关闭后目录失效，执行时再次检查。应用安装计划绑定原 sessionId，不能转移给另一连接；安装、环境修改走独立通道并可用 task_start，绝不向用户终端注入命令。

python_analyze 使用明确选择的真实解释器及其语义依赖；缺少依赖报告错误。python_file_read 返回内容 SHA-256 revision，python_file_save 接受该 revision、代码与 acceptNonAtomic:true；共享桌面编辑服务，用临时文件与 OpenSSH rename 发布。两次内容核对仍不能对外部写入者提供原子 CAS。需要 Python 插件与 files.read/files.write；分析使用 environments.read。

先 describe_connection 获取实际工具，再读其完整契约。Agent 不支持的 SSH 扩展不会伪装成可用。

## 释放完成任务

task_release 仅释放调用方已结束任务的结果和事件；运行中任务先取消并等 settled。保留原幂等记录至原期限，重复提交仍返回原 taskId 而不重放。released:true 表示结果已释放。未释放任务上限为全局 128/每客户端 32，包含释放记录的总量上限为各自八倍；到期清理，超额拒绝。

插件市场的 plugin_catalog / plugin_download 需要 plugins.manage，因为前者保存应用目录来源，后者安装并启用插件。网络只允许无 URL 凭据的 HTTPS，禁止重定向，15 秒超时且响应有界；包必须符合清单和 SHA-256。取消在网络请求及最终排队写入前复核。调用方应先展示目录清单，再显式执行下载；不会自动增加机器授权。
# 本机文件范围

在 MCP 设置中为当前调用方选择只读目录并保存；命名客户端各自配置，默认没有目录。该授权不授予终端或写入权限，不属于外观方案。`local_file_roots` 返回已授权根的稳定 ID、名称和独立授权的 mutations，不返回绝对路径。将 ID 作为 `rootId`，先用 `local_files_list` 列出根相对目录（例如 `/`），再用 `local_file_read` 读取列表中的普通文件路径；`local_file_stat` 返回普通文件或目录的 metadata revision。通过同一版本化 invoke 入口或标准 MCP 工具调用；未授权时不展示这些能力。

修改操作在每个根目录中逐项勾选并保存，旧授权仍然只读。`local_file_task_start` 需要 rootId、idempotencyKey 和 operation；operation.action 为 create/write/rename/delete/mkdir/rmdir/renameDirectory，均需要 path 和 acceptNonAtomic=true。create/write 的 bodyBase64 最多解码为 32 KiB；write 还需要 offset 与当前 revision，不支持稀疏写入或截断。rename/delete 仅支持普通文件，rmdir 仅删除空目录；这些操作和 write 都需要先用同一路径 stat 获取 revision。rename 和独立授权的 renameDirectory 额外需要不存在的 destination，目录移动详见下文。暂不提供单调用整树复制或递归删除出口。

例如创建文件：`{"rootId":"从 local_file_roots 获取","idempotencyKey":"本次操作唯一键","operation":{"action":"create","path":"/note.txt","bodyBase64":"aGk=","acceptNonAtomic":true}}`。随后用返回 taskId 调用 task_read，成功时 result 含 action/path、可选 destination/bytes、consistency=metadata-best-effort、atomicPublication=false。保留幂等键 15 分钟，同调用方同键不同请求返回 CONFLICT；进程重启不恢复任务或去重记录。任务执行期限 30 秒，可用 task_cancel 取消，但已提交 OS 操作可能已经生效，应检查结果而非盲目重试。撤权在审批后和各次 IO 前后复核；审计落盘失败阻止开始，执行后失败报告未知结果。

本机变更按绝对词法路径协调，包括不同根 ID 指向的重叠子目录；Windows 大小写归一。外部程序、硬链接/路径别名与检查后替换不受此锁保护；条件写入和“不覆盖”检查不是 OS 原子 CAS，也不是安全沙箱。新建使用独占创建，其他操作的失败或取消可能有部分副作用，不承诺回滚。

目录分页携带 `nextCursor`；游标绑定调用方、根和目录内容，过期或撤权后重新发现。文件返回 base64，每块最多 65,536 字节；续读同时传回 `nextOffset` 和 `revision`。根身份变化、文件元数据变化需重新选择授权或重新开始读取，不自动重试未知状态。审核策略为全提示时读取仍需批准，批准不能恢复已经撤销的授权。

此出口拒绝检测到的符号链接与 junction，遵守进程的系统权限；并非操作系统权限沙箱，也不保证对抗外部进程同时替换路径的原子隔离。文件元数据版本是 best effort，不是内容快照。本机写入、普通文件删除、空目录删除与目录树移动按上述独立授权提供，不包含整树事务保证。


## Jupyter 生命周期

environment_jupyter_status/start/stop 绑定调用中的 API SSH 会话和 python 解释器。先从 environments_list 获取实际解释器，确保已安装 jupyterlab；启动须 environments.manage 授权和审核，建议通过 task_start 提交并保留幂等键。服务仅监听远端回环，随机令牌保留后端。API 返回 running 与远端 port，不提供浏览器 URL 或令牌，也不会接管桌面会话和外部 notebook。开始阶段可以取消；停止完成表示本机通道与隧道已经关闭，不保证远端全部后代进程死亡。服务不提供跨进程恢复或自动重放。


## Conda 环境终端

桌面提供环境适配时，connect 可带 environment 对象：parentSessionId 为本调用方已打开的 SSH 会话，conda 与 prefix 使用该会话 environments_list 的实际值；profileId 必须与父会话相同。需要 Conda 插件、environments.read 和 terminal.input 授权，按目标策略审核。返回独立子 sessionId，沿用 terminal_read/input/resize 和 disconnect。describe_connection 返回 terminalEnvironment。父连接关闭会关闭子通道；子终端关闭不关闭父连接。Conda 仅绑定终端进程，不能把 SSH 文件/监控视为环境专属资源。


## 目录树变更

先以 directory_tree_inspect 检查绝对非根路径并取得 revision 与条目数；directory_tree_mutate 需要独立 directories.manage 授权、审核及 acceptNonAtomic=true。action=rename 还需不存在且与源不重叠的 destination；action=delete 不传 destination。最多 1000 项、32 层，拒绝检测到的符号链接和特殊文件。默认标准 SFTP rename，不跨文件系统复制，不覆盖目标。删除由叶到根执行，不使用回收站。中途取消或失败可能已永久删除部分内容，必须检查后再决定下一步，不能盲重试。使用 task_start 的幂等键避免同一请求重复提交。词法树冲突域协调 API 子路径写入，但外部写入、路径别名和硬链接不构成原子保护。


API 设置保存带配置 revision。多个设置草稿同时打开时，先保存者生效，后续过期草稿报冲突；请重新打开设置，核对并重新应用自己的修改。冲突不会自动合并权限或停止当前服务。审核模式只决定已授权操作是否询问，不增加目标或能力授权。

Agent 管理与中继的完整契约现在逐个 method 声明 params：WSL 安装需要真实 planId 与 confirm，网络应用需要 confirmDisconnect，网络保存需要 revision。client.status 等无参数方法不接受任意额外字段。凭据读取/轮换与监听密码修改仍不通过这些外部工具暴露。反向中继的空凭据只在实际后端确认同一端点身份时保留原秘密；不代表自动授权。Agent 独立命令输出明确包含 stdout、stderr、exitCode、truncated 和实际 environment；SSH 兼容命令输出仍为文本，不能按 Agent JSON 格式解释。

Agent 管理、托管与中继工具的返回契约按 method 标注并在返回前验证。hosting.remove 成功返回 JSON null；client.info 返回一个包含公开连接信息的 JSON 字符串（不是含密码的邀请）。反向中继 status 不返回 credential。返回不符合契约时报告未知结果，不能因校验失败重放已经提交的修改。

## 配置与生命周期差异

| 资源 | 冲突与持久化 | 生效与恢复 |
| --- | --- | --- |
| API 设置及调用方授权 | revision 条件保存；串行配置事务；秘密后端加密 | 变更撤销旧代次调用与会话；重新发现和连接，不恢复旧句柄 |
| SSH / Agent API 会话 | 调用方独占，连接身份绑定，不借用桌面标签 | 断开后句柄失效；重新连接产生新会话，任务不自动重放 |
| 本机环境变量覆盖 | 后端加密，写入串行；当前没有对外配置修改工具 | 仅新终端继承，不改已运行终端或注册表 |
| Agent HTTP 托管 | 配置 revision；启动需同一审阅配置与 expectedRevision | 停止释放所属监听/代码子进程；移除仅允许停止后执行 |
| Windows Agent WSL 网络 | 文件内容 revision，保存备份并保留其他配置 | 保存不重启；apply 明确 confirmDisconnect，影响该 Windows 的所有 WSL 任务 |
| Agent 中继配置 | API configure 强制 expectedRevision；在后端串行事务内复核，拒绝过期保存 | status 返回进程内 revision；重启后失效。旧原生调用兼容省略 revision，API 不允许省略；configure/start/stop 可能断连 |
| WSL 安装 | 持久化实际 planId 与状态，绑定 Windows Agent | 重启后运行中状态为 interrupted；重新检查系统，不从日志伪造任务恢复 |
| 环境终端 / Jupyter | 绑定 API 所有者与父 SSH 会话 | 撤权/断连清理所属通道；不交出 token，不保证远端全部后代进程退出 |

审核只影响已授权操作是否需要确认。AI 和外部调用共享权限与审核判断，仍保留独立配置与秘密存储，不相互继承授权。上述差异是当前真实边界，不代表全应用配置都具有事务或持久任务恢复能力。

## 本机目录树移动与组合复制

local_file_task_start 新增独立 renameDirectory 授权，旧 rename 文件授权不扩大。先用 local_file_stat 获取源目录 revision，再提交 operation={action:"renameDirectory",path:"/source",destination:"/destination",revision,acceptNonAtomic:true}。目标必须不存在且不与源包含重叠；使用真实 OS rename，不跨卷复制，不遍历或执行子项。源目录 revision 只检查目录条目元数据，不是后代内容快照；移动保留已有树内容，内部链接不会被遍历，后续 API 仍拒绝链接访问。树冲突域覆盖两个目录及子路径。

目录树复制可以通过现有稳定 API 组合：先分页列举源树，拒绝 symlink，选择与源不重叠的目标；按父先子后调用 mkdir，普通文件以 local_file_read 分块读取，首次 create，后续每次 stat 获取目标 revision 后 write（最多 32 KiB），完成一项再释放其任务结果。源读取持续携带初次 revision，变化则停止并报告已复制项；空文件用空 bodyBase64 创建。跨根复制须分别具备源读取和目标 mkdir/create/write 授权。每次副作用用独立且可追踪的幂等键，不能把一次递归流程伪装成单个原子任务；无回滚、无一致性快照、无自动断点恢复，调用方负责保存清单并对照实际文件决定如何继续。

中继 API 保存流程：先 agent_relay 调用 relay.status 或 relay.reverse.status，再把其 revision 作为对应 configure 的 params.expectedRevision，和完整配置一并提交。字段验证和后端事务均检查该条件；配置已变则重新读取并由调用方重新决定，不去掉条件强制保存。未返回 revision 的旧 Agent 只支持旧行为，需先更新 Agent 才能使用新的 API 条件配置出口；不静默降级。版本只存在于该 Agent 进程，重启使草稿失效，版本内容不包含凭据。
