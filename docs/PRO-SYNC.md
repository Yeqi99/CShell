# Pro 云同步（0.8 共用代码线）

状态：实现与测试中，尚未发布。仅配置同步，不包含会员支付、官方模型额度和中继。

## 维护方式

Pro 是同一 CShell 客户端中的账号能力，不复制工作台、不维护长期 Pro 分叉。连接、终端、文件、cagent、模型设置继续使用同一套实现。后续开源更新合入同一主线，再从同一提交构建各平台。开发分支只用于本次评审与测试。

桌面端的接入只位于 `src/desktop/cloud-sync.ts`，同步协议在 `src/shared/cloud-sync.ts`，加密与状态机在 `src/core/cloud-*.ts`。Android 使用现有原生桥梁和独立 Android Keystore 存储，AES-GCM 线格式由 Node/JVM 互操作检查覆盖。服务端独立部署，不依赖 CanpAI 数据库、镜像或密钥。

同步协议版本与应用版本分离。客户端拒绝未知格式；Android 回传时保留桌面专属配置，不能将不认识的字段当作删除。新增字段需要跨版本保留测试。当前整份保险库使用 CAS 版本检查；不同设备同时更改也会产生冲突，不支持字段级自动合并。后续可在不分叉 UI 的前提下升级记录级同步。

## 数据边界

- 同步：SSH/RDP/cagent/HTTP 连接描述、分组和收藏；已保存的连接密码及 SSH 私钥；模型配置与 Key；外观、终端和布局设置、命名方案及视图；所引用的外观资源；HTTP 工作区配置；已核对的目标身份。
- 不同步：控制端本机身份私钥、监听与授权设置、MCP token、插件安装与授权、系统环境、运行中会话、聊天/终端日志、浏览器 Cookie、文件正文。新设备连接 cagent 仍需按目标的认证机制授权，账号登录不能冒充原控制端。
- Android 当前可恢复 SSH/cagent 连接、使用原生保存的 SSH 凭据、同步明暗设置、查看同步的模型名称。桌面专属模型/视图保留在加密保险库中，不宣称 Android 已实现桌面智能体界面。新建 cagent 配对先在桌面端完成。

## 安全与恢复

邮箱验证码单次使用、10 分钟有效、最多 5 次尝试；发信冷却及按邮箱/IP/全局限流。会话随机生成，数据库只存 HMAC 摘要，30 天到期，可退出撤销。生产初期仅接受邀请邮箱。

保险库在本机以随机 256 位恢复密钥进行 AES-256-GCM 加密，96 位随机 nonce，账户 ID 绑定关联数据。恢复密钥不发送给服务端。桌面密钥和登录凭证由系统安全存储加密；Android 使用独立 Keystore 密钥，应用禁止系统备份。邮箱找回不恢复保险库密钥。

桌面上传请求先持久化密文和 mutationId，响应丢失后重放原请求，不重复增版。版本回退、密钥错误、密文篡改和双端冲突停止同步。显式覆盖前保留本机加密备份，最多 20 份。Android 保留最近一次保险库备份和恢复前的连接列表；上传只更新支持的字段。下载不执行连接、命令或插件安装。

## 部署

香港主机的 `/opt/cshell-sync/server.py` 以独立 `cshell-sync` 用户运行，SQLite 在 `/var/lib/cshell-sync/`；环境文件 `/etc/cshell-sync.env` 为 root 0600。只监听 127.0.0.1:8789，由已有 Caddy 的 `shell.canp.ai/api/` 转发。门户位于根路径，管理页面迁移到 `admin-shell.canp.ai` 并要求访问密码。单独限制 256 MiB 内存、0.5 CPU、32 任务、16 个请求线程和请求体大小。

验证码通过已配置的 163 SMTP SSL 发出。Cloudflare 提供域名解析和 HTTPS 代理；无需 Workers Paid。SMTP 授权凭据仅保存在服务器受限环境文件中。

发布前必须完成：真实邮件收件、正式账号注册、本机数据加密上传与第二设备恢复验证、跨平台构建及产物核验。当前测试通过不代表这些线上验收已完成。

## 0.8.1 登录即恢复

已配置账号支持固定密码登录。恢复密钥通过 PBKDF2-HMAC-SHA256（210000 次、随机 32 字节盐）派生的密钥进行 AES-GCM 包装；服务端保存包装密文，客户端登录后自动解锁并恢复配置。Windows 后台约每分钟同步，Android 前台约每 30 秒检查本机变化或云端版本。首次恢复前保留本机备份，并发编辑保留冲突处理，不静默覆盖。

当前测试账号已配置该流程；密码修改与遗忘密码后重新包装流程尚未提供。验证码登录仍保留，新的未配置账号不应被宣称已具备自动解锁功能。

## Pro 构建与安装标识

设置 `CSHELL_EDITION=pro` 后运行 Vite、`scripts/build.mjs` 和 `scripts/build-android.mjs`。Windows 使用 `electron-builder --config electron-builder.pro.cjs`，应用 ID 为 `org.canpshell.pro`，产品名称和数据目录为 `CShell Pro`，与普通版独立。Android Gradle 在同一环境变量下使用 `org.canpshell.mobile.pro` 和 `CShell Pro` 名称。两端均使用已确认的 `assets/brand/cshell-pro.*`，不重绘或改动普通版/cagent 资源。更新器只匹配本产品的发行附件。

## 账号体验与门户（2026-10-22）

Pro 桌面顶栏常驻账号入口，在可关闭的工作区标签打开账号页。Android 顶栏提供同一入口，密码与验证码登录分开，只显示当前需要的字段；状态查询不再显示“操作完成”。客户端从 `/v1/account` 获取真实会员有效期，安装 Pro 不自动获得会员。

`services/portal` 为 `https://shell.canp.ai` 的公开下载门户；`services/admin` 复用原管理平台，账号列表和会员操作审计连接真实服务，其余支付、套餐、模型用量模块仍明确为草稿。管理员通过 `https://admin-shell.canp.ai` 访问，Caddy Basic Auth 保护整个主机，反向代理注入独立 `ADMIN_API_TOKEN`。公开 API 转发必须移除该头，服务端管理员接口校验 token，写操作校验浏览器 Origin。会员修改必须填写原因，前后有效期写入审计；不会伪造充值订单。

Windows 与 Android 下载附件放入香港服务器 `/opt/cshell-downloads/`，校验值使用 `SHA256SUMS.txt`。安装包未完成核验不得替换公开附件。Windows 当前为未签名测试安装包，Android 使用现有发布证书签名。Pro 的其他平台尚未发布。
