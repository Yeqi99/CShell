# 会员 MCP 长连接：实现与部署验收

## 2026-11-04 实际传输实现

`gateway.ts` 使用官方 MCP SDK 提供有状态 Streamable HTTP POST / GET SSE / DELETE。独立 `csmcp_` 客户端令牌仅签发时显示，服务端保存摘要；每次请求及最长 10 秒周期重新验证会员、撤销、目标归属。会话绑定令牌摘要，不能跨客户端复用。空闲 30 分钟回收，最大 128 会话；入口只监听 127.0.0.1，必须经 HTTPS 反向代理公开。浏览器 Origin 请求拒绝。

新签发会员客户端可明确授权八个方法：三个应用工具发现/描述/调用方法，加上已发布账号 bridge 的五个方法 `list_servers_page/connect/describe_connection/invoke_connection/disconnect`，旧令牌保留原五方法范围，不自动扩权。机器操作从 `describe_connection` 返回的能力目录发现，再通过 `invoke_connection` 调用；本机现有 MCP 客户端和权限继续校验，不把公网令牌映射为全局权限。原 CanpAI bridge 不增加会员限制。会员要求仅约束新签发的公网 MCP 客户端。

每次 bridge 请求先预留请求和最大 8 MiB 结果预算，投递前拒绝超额，返回或超时后结算实际已投递的应用负载，释放余量。超时表示结果未知，不自动重新执行。进程崩溃的预算保守保留，管理员根据可信记录对账，见 `TRAFFIC-ACCOUNTING-1.0.md`。此上限意味着剩余额度不足 8 MiB 时即使小请求也会拒绝，需要扩容；不能伪装为已精确预测结果大小。

### 本地真实验收

- `tests/cloud-mcp-gateway.test.ts`：官方 SDK 经真实本机 HTTP/SSE 初始化、列工具、调用、越权拒绝、跨令牌会话拒绝、DELETE、重连不重放、撤销断开。
- `services/cloud-sync/test_traffic_http.py`：真实 HTTP 内部网关请求→已认证 worker 投递/回复→计量结算；配置硬上限后 429 且 worker 无新增任务；真实 relay 预算 HTTP 的认证、限额与结算。
- `services/cloud-sync/test_mcp_clients.py`：成员校验、独立令牌摘要、账号隔离、撤销、原 bridge 权益不变。
- 网关可独立打包：`pnpm exec esbuild services/cloud-mcp/main.ts --bundle --platform=node --format=cjs --outfile=.local/cloud-mcp-1.0/main.cjs`。

### 精确部署顺序（尚未部署）

1. 备份云同步数据库，部署 `metering.py/mcp_clients.py/mcp_journal.py/bridges.py/devices.py/server.py`；新增表自动创建，不修改现有额度默认值。
2. 同步服务与 MCP 网关配置相同的随机 `MCP_AUTH_TOKEN`，只保存于服务器受限环境文件；同步服务仍监听本机 8789，网关独立 Node 服务监听本机 8791。绝不把此内部凭据发给客户端。
3. 使用上述构建产物运行独立系统服务，正常停止向进程发 SIGTERM。反向代理将选定独立域名的 `/mcp` 转发至 8791，关闭缓冲、允许 SSE 长读超时、仅 HTTPS；不代理 `/v1/admin/*`。
4. 实际验证 HTTPS SSE 后，云同步服务配置 `MCP_PUBLIC_URL=https://实际域名/mcp`。未配置时客户端 UI 明确显示未开放，不提供创建按钮。
5. 先启用 CShell 原有账号 bridge 并选择独立本机 MCP 客户端及权限，再于“会员远程 MCP 客户端”创建、复制令牌；外部 MCP 客户端使用该地址与 `Authorization: Bearer <独立令牌>`。
6. 部署新 relay（保持现有 `RELAY_AUTH_TOKEN`）后验证预算 HTTP；部署 admin `traffic.js/app.js`。默认无限额，费率未设置不显示虚假成本；正式限额与费率由管理员配置并写审计。
7. 生产验收需外网真实 SDK、网关重启、会员撤销、权限撤销、断网恢复及数据库持久化，未通过前不宣传生产已可用。

### 恢复边界

网关重启会使旧 MCP session 失效，客户端需要重新初始化。真实会员网关调用已接入 `mcp_journal.py` 持久化账本：执行前写入 running，完成后保存 completed 与结果；云同步服务重启将遗留 running 标为 unknown，禁止重新派发。`list_operations` 返回当前客户端最近 100 条操作（含编号），`get_operation_status` 查询已完成结果或 running/unknown/expired 状态。调用方可在 MCP `_meta["cshell/operationId"]` 提交 `UTC秒:UUID`，同编号同参数只查询，参数不同拒绝。

结果保留 24 小时，操作墓碑保留 90 天；新编号只允许前 5 分钟到后 1 分钟的时间，因此过期删除后也不能复用旧编号重放。每客户端最多 10,000 条/64 MiB 结果，全局最多 100,000 条/256 MiB（计入运行任务最大结果预留）；满额拒绝新任务，清理在每次读写时事务执行。数据位于服务数据库，包含操作结果，数据库访问和备份需按敏感数据保护。未知状态要查询目标实际状态，不能断言未执行。

`test_mcp_journal.py` 验证旧数据库建表、重启 unknown、completed 恢复、同ID不重放、摘要冲突与隔离、保留期；`test_traffic_http.py` 实际关闭 HTTP 服务并重新创建 Service/HTTP 监听，凭原客户端令牌恢复结果，重复提交同ID无新增 worker 任务。旧 CanpAI bridge 端点保持既有行为，新增持久恢复只对会员网关路径生效。`session.ts` 仍是独立状态机，实际保证以此 journal/HTTP 测试为准。

当前本机实现 `src/core/mcp.ts` 只监听 loopback，校验 Host/Origin/Bearer，每次 POST 创建无会话 JSON Streamable HTTP Transport，不支持 GET SSE。这不是已完成的会员远程长连接。

## 已落地的独立基础

`services/cloud-mcp/session.ts` 提供网关会话状态机：单独随机会话凭据、仅内存保存摘要、每次操作复核账号/客户端/设备/权限版本/会员有效期，心跳超时、重连代次隔离和客户端撤销。操作编号与参数摘要绑定，执行前写入 journal；连接恢复只查询，不重新分发已受理的写任务。流量分类固定为 MCP，不能再按 relay 重复累计。

`tests/cloud-mcp-session.test.ts` 覆盖丢失结果后的重连不重放、旧连接隔离、权限/会员撤销、身份与空闲超时、计量参数。

## 原始设计清单与剩余边界

1. 云服务验证账号并签发独立可撤销 MCP 客户端身份；不能使用客户端上传的 account/client/device 作为可信身份。本机 Bearer 绝不送到公网。
2. CAgent/CShell 主动建立带目标证书固定和账号租约的出站通道。公开 MCP 客户端和设备通道分别认证。`settle` 仅由已验证设备通道调用，不能注册为公共 HTTP 方法。
3. 用数据库事务实现 `McpJournal`，操作记录有容量、过期与结果保留规则。当前会话凭据仅驻内存：服务重启后拒绝恢复旧会话；网关不能因新会话重新提交旧任务。设备执行端须有独立持久化幂等账本，防止跨网关重启重复执行。
4. 公开 HTTPS Streamable HTTP/SSE 路由、速率和并发限制、心跳以及客户端断线回收；接入会员额度预留、实际字节计量和成本台账。状态机本身不是网络监听器。
5. 权限按能力目录投影，再由目标机器复核现有权限节点。会话授权仅缩小范围，不能扩大本机权限。扩展新增能力默认不会凭旧 scope 获得授权。
6. 重连/撤销/会员到期/网络分区/进程崩溃和真实 MCP SDK 互操作测试；公开客户端不能提交设备结果，不能读取其他客户端任务。

上面第 1、3、4、5 项已有本页前半部分记录的实际实现和本地验证；第 2 项当前沿用既有账号 bridge 出站认证，第 6 项本地 SDK、撤销与真实 HTTP 服务重启已验证，生产网络分区及外网负载未验证。尚未部署、尚未新增公网入口，不应在 UI 或官网标记远程 MCP 已可用。


## Application capability path

New member tokens may explicitly include `list_application_tools`, `describe_application_tool`, and `invoke_application_tool`, in addition to the original five connection methods. The catalog comes from the selected desktop MCP client's current authorized capabilities, including connection CRUD/credential/trust/preflight, session/task recovery, member domains and enabled application extensions. Invocations enter the same local MCP schema validation, target checks, review, audit and task implementation; no arbitrary HTTP or JavaScript forwarding is provided.

The desktop derives an isolated principal per bridge-client + remote consumer. Permissions are inherited from the selected local MCP client, while sessions/tasks/catalogs are isolated per consumer. Changing the selected client invalidates old principals; rotating its token aborts scoped calls and removes its scoped sessions/tasks. Session IDs created through either direct connect or application invocation retain the same consumer ownership. Existing five-scope tokens and the old CanpAI bridge are not expanded; the new route is accepted only through the authenticated member token path. To opt in, create a new member client token. All operation results still use the durable journal and the same traffic reservations.

Acceptance: real local MCP application dispatch verifies denied review has no side effect, allowed domain mutation, live permission revocation, actual SSH session isolation between consumers, and scoped audit records. Cloud tests verify old token/legacy bridge rejection of application invocation and new token delegation with its authenticated owner. This is not proof that every GUI-only operation already has a local MCP tool; only real registered authorized capabilities are advertised.


## 跨机器文件复制（1.0）

`files_copy_start` 是本机 MCP、会员长连接应用工具及通用 CLI 共同发现的高层入口。先用调用方自己的 `connect` 建立源、目标两个会话，再提供 `source/destination: {sessionId, root, path}`；SSH/FTP 的 root 留空，CAgent 使用其文件根目录 ID。返回任务 ID，使用 `task_read` 查看字节进度与结果，`task_cancel` 请求取消，`task_release` 释放已完成结果。提供 idempotencyKey 可在当前进程的保留期内找回原任务，不能跨重启盲目重放。

源端要求 files.read，目标要求 files.create，并分别遵守审核策略；调用方不能使用其他调用方或 GUI 的会话。每个延迟操作重新核验两端权限和身份，撤销后不能读复制结果。底层传输票据不暴露给 MCP。

`directory: true` 先完整预检最多 10,000 项、32 层的目录树，拒绝复制符号链接，随后创建目录并逐个流式传输文件。已有目标不覆盖；失败保留已经完成的文件/目录，并报告 partial 进度，未提交临时文件取消清理。不保证与外部并发修改之间具有目录快照隔离。GUI 与高层工具共用 Agent 直连探测：绑定接收方证书验证票据，探测失败才退回有界控制端流转；开始写入后失败不重放。目录逐文件同样选择路径，SSH/FTP 使用流式传输。

回归覆盖真实 SSH → SSH 长连接调用、消费者隔离、结果撤权、幂等，真实 Agent 目录及取消清理，以及 SFTP/FTP 双向二进制传输。
