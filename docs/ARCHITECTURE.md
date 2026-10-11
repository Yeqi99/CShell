# 架构与决策

## 0.1.4 工作台模块与生命周期

- `ConnectionForm` 只管理连接草稿、字段校验与认证输入。`parseSshCommand` 为共享的纯解析器；`connect:temporary` 接收经 schema 校验的配置，但不读写已保存连接与凭据。临时连接继续复用主机指纹验证和 SSH 服务。
- `Workbench` 负责页签、当前工作区与布局；每个连接编辑器独立挂载，切换草稿不销毁。`SessionTab` 处理标签呈现、命名和拖动，标签命名不会意外修改保存的服务器名称。
- `TerminalPane` 按会话 ID 独立持有 xterm，非当前终端仍保留输出与历史；切换主题和字号只更新渲染选项。终端不依赖文件或监控成功。
- `ToolsPanel` 按会话持有 `FilePanel` 与 `MonitorPanel`。文件折叠/隐藏保留路径和编辑，监控只对当前可见连接轮询；断开后卸下远端工具。资源采集、文件错误、终端生命周期分别处理；传输展示按会话过滤。
- 文件选择、传输、监控和终端通过类型化 Bridge 使用独立后端服务。该边界支持后续组合嵌入，但尚不代表发布了稳定的嵌入 SDK、任意终端拆分或跨平台 UI。

## ADR-001：Windows 首版采用 Electron + React + xterm.js

选择理由：SSH2/SFTP 可直接使用成熟 Node 实现；无需为首版引入 Rust/JNI 桥；终端渲染和 React 界面适合后续 Web 复用。代价是 Electron 安装体积和内存占用，不能把它描述成极小原生程序。Tauri 有更小发行体积，但当前环境没有 Rust，SSH/系统安全存储桥和跨平台维护需要额外验证，因此不作为一天首版的主路线。

版本锁定在 package.json 与 pnpm-lock.yaml。ssh2 的 CPU 检测及加速扩展是可选项；当前走已验证的纯 JavaScript 路径，关闭原生自动重建，避免构建依赖 Python/MSVC。不是删除安全检查或修改 SSH 协议。

## ADR-002：桌面边界

`src/core`：SSH、SFTP、配置、传输、本地目录授权、Linux 指标解析。这里不依赖 Electron/React。

`src/desktop`：原生对话框、safeStorage、文件授权、IPC 和窗口生命周期。渲染器关闭 Node，启用 sandbox/contextIsolation；IPC 校验主 frame 和应用文件 URL；没有通用 shell 执行或任意文件读取接口。

`src/shared/contracts.ts`：数据类型、schema 和小型 Bridge。当前为内部 v0 接口，不承诺公共 SDK 稳定性。

`src/ui`：界面、终端渲染、i18n、快捷键；不导入 SSH/Node 文件系统。仅通过 Bridge 与平台通信。未为未来功能创建空实现或虚假的 AI 插件系统。

终端数据有输出确认与暂停/恢复流控，xterm scrollback 有界。传输使用流，复制到临时文件，完成后提交；目录取消可能留下已成功的文件/空目录，界面报告取消，不做危险的自动回滚。符号链接与 junction 不跟随。

## ADR-003：认证与主机身份

首次连接显示 SHA256 指纹并由用户确认；已保存指纹变化时硬性拒绝，没有“继续连接”绕过。应通过可信渠道核验指纹。当前轮换需谨慎备份后人工移除精确的 known-host 记录，后续提供受控管理界面。

仅当用户选择记住凭据且认证成功后，使用 Electron safeStorage 异步 API 加密保存。Windows 为 DPAPI；Linux 如果回退 basic_text 则拒绝保存。DPAPI 不防护同一用户身份下的恶意进程，凭据仍需进入 SSH 进程内存。连接地址/用户名/认证类型改变后清除原绑定凭据。

## ADR-004：Web/Embed 路线

可复用：React 视图、终端渲染、i18n、会话展示和消息数据契约。

必须替换：Electron Bridge、桌面凭据库、目录选择/文件访问，以及直接 TCP 的连接实现。计划由宿主后端签发短期、单次或可撤销、绑定租户/用户/目标服务器/功能范围的会话票据，网关校验来源、目标白名单、权限、配额与有效期后解析服务端凭据。

不允许前端传 host/port 就变成任意服务器连接授权。网关需防 SSRF/DNS 重绑定，凭据仅保存在服务端，每条命令/文件动作执行时重验授权，连接、传输、审计记录必须租户隔离。审计不默认收集密码或全部终端内容。宿主与 iframe 通信必须校验 origin、source、消息版本与会话 nonce；品牌、语言、布局配置与连接授权分离。生命周期事件应覆盖连接、关闭、错误、票据撤销。

Android 单独设计触控 UI 和平台适配层，不直接装进桌面布局；本阶段不声称 Electron 支持 Android。AI 未来通过可选 provider 接入，读取上下文、上传日志、执行命令分别授权。

参考：Electron 官方 Security、Context Isolation、safeStorage 文档；xterm.js Security/Unicode 文档；ssh2 README/SFTP.md。依赖清单另行生成。

## 0.1.3 外观、布局与对外工具

- 字体：Windows 通过 InstalledFontCollection 枚举本机字体；字体导入只接收文件选择器或拖入产生的一次性授权。TTF/OTF/WOFF/WOFF2 按格式和 20 MB 上限检查，Chromium FontFace 执行字体解码。字体以内容哈希存入本地 appearance 目录，不修改系统字体安装。平台实现集中在 desktop/appearance.ts。
- 背景：仅本地 PNG/JPEG/WebP，解码后重新编码 PNG，最长边 4096 像素。设置只保存资源 ID；配置导出携带对应资源，导入验证 schema、哈希、大小和类型。CSP 仅增加 data: 字体来源，不允许联网加载任意字体或图片。
- 布局：服务器、终端、文件三块主面板支持水平排序和宽度调整，不销毁已运行的终端。顺序与宽度持久化。当前不是任意浮动窗口/多层停靠系统；监控仍随文件工具区移动。
- 命名配置只保存 Preferences（外观、语言、字体、背景、布局），不导出服务器列表、密码、私钥、主机信任或 MCP 权限。导入先预览，再由用户保存；同名配置保存会更新原配置。
- MCP：使用官方 @modelcontextprotocol/sdk 1.32.1（MIT），Streamable HTTP、无 HTTP 会话状态，每请求独立 transport。默认关闭，仅监听 127.0.0.1，端口可配置。随机 256-bit Bearer 令牌通过现有系统加密方案保存；UI 仅提供主动复制/更换。拒绝带 Origin 的浏览器请求，校验 Host，限制请求大小和并发。
- MCP SSH 会话与界面会话隔离；只接受用户勾选的 profile ID，凭据只在后端读取，主机指纹必须预先信任。工具包括列出服务器、连接/断开、列文件、监控；命令执行单独开启，每条命令由桌面确认，30 秒超时、256 KiB 输出上限。变更配置、禁用、轮换令牌或退出程序会释放 MCP 会话。审计仅记时间、工具名及成功与否，不记录密码、命令正文或输出。局域网/公网开放和无人值守命令授权暂未提供。

参考：[Microsoft 字体枚举 API](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.text.installedfontcollection)、[Electron 文件拖入 API](https://www.electronjs.org/docs/latest/api/web-utils)、[官方 MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)。

## 连接 Provider 与浮动会话（开发中版本）

参见 [Connection Provider Architecture](CONNECTION-PROVIDERS.md)。Agent 工具调度已从 SSH 实现中解耦，当前内置适配器仍只有 SSH；后续协议按能力注册，不提前放置空实现。

独立终端小窗是现有会话的另一视图：主视图持有输出流控，快照携带输出序号，小窗接续有界尾流并去重。输入与窗口尺寸只作用于绑定的会话；仅观察模式拒绝输入，焦点输入窗口决定远端 PTY 尺寸。关闭小窗不结束连接，关闭主工作台仍按连接关闭规则处理。子窗口独立校验发送方，不开放主工作台配置、密钥与文件授权接口。它不是独立后台会话服务，也不承诺进程退出后恢复 shell。
