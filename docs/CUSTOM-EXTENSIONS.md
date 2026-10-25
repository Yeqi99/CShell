# 自定义扩展

打开 **扩展 → 导入扩展**，选择 `.cshellext` 文件；也可以直接将一个扩展包拖到插件页面。先核对名称、版本、发布者、签名与权限说明，再确认导入。导入后保持停用，在筛选菜单的 **自定义扩展** 中单独启用、打开或卸载。

更新已有扩展前先停用。取消预览不会安装；导入不会执行终端命令、连接机器或改变机器授权。卸载保留已有扩展配置，不删除应用或微信数据。签名仅证明来源和完整性，不能代替操作授权。

## 微信

微信以独立的 Windows x64 自定义扩展包分发，不在公开市场展示，不随 CShell 或 CAgent 捆绑运行时。界面名称为“微信”。首次导入后重新打开 CShell / CAgent，再启用和配置实际微信进程、读取范围、发送范围与其他操作权限。旧配置保留，不自动扩大权限。

CShell 与 CAgent 使用当前 Windows 用户的独立扩展目录。CAgent 命令行可先预览：

```text
cagent extension-import "D:\Extensions\WeChat-0.1.7-win-x64.cshellext"
```

核对后加 `--confirm` 导入，重启 CAgent 后从“自定义扩展”配置能力和授权。导入不会自动停止当前任务或微信。远端机器需要在对应机器安装；不会借用控制端微信。控制端智能体使用微信专属工具也需要导入此包。

## 制作命令扩展

`.cshellext` 是 UTF-8 JSON 文件，也可使用 gzip 压缩同一 JSON 内容。协议版本为 `cshell-extension-1`。`snippets` 贡献终端命令，`process` 贡献独立进程工具。扩展代码不会进入网页渲染进程。原生微信适配包必须通过内置发布者公钥校验；不接受伪造内置 ID 或越权权限。

```json
{
  "format": "cshell-extension-1",
  "manifest": {
    "protocol": 1,
    "id": "example.commands",
    "version": "1.0.0",
    "name": "我的命令",
    "description": "常用只读命令",
    "publisher": "Example",
    "provider": "snippets",
    "permissions": ["terminal.input"],
    "commands": [{"label":"磁盘空间","text":"df -h"}]
  },
  "files": []
}
```

保存为 `my-commands.cshellext` 后导入。命令仅在用户主动选择时填入终端，不自动执行。ID 使用 `发布者.名称`，不要使用保留的 `cshell.*` 命名空间。导入不通过聊天或智能体传输文件内容。

微信包构建使用 `scripts/package-wechat-extension.ts`，签名私钥通过 `CSHELL_EXTENSION_SIGNING_KEY` 指定文件路径，禁止提交私钥或发布到包内。包内文件逐项验证 SHA-256；启动加载时再次校验签名和文件内容。文件大小、路径穿越、Windows 特殊文件名、大小写重复与不支持的协议会被拒绝。

## 制作可供智能体、CLI 和 MCP 调用的工具

从仓库的 `examples/process-extension` 开始，运行 `node examples/process-extension/package.mjs`，即可生成 `example.echo.cshellext`。它只把传入的文本转换为大写，不访问连接、账户或用户文件。示例的 GitHub release 地址是来源声明，示例不会下载该地址，也不表示该附件已经公开发布；分发自己的包时改为自己的来源。

在 CShell 中导入后，到“自定义扩展”启用，再点击 **授权运行**。确认窗口说明它实际运行在本机，并具有当前系统用户的权限。安装、启用和运行授权是三个独立步骤。授权前不会启动扩展程序，工具不会显示为可调用。

授权后，工具进入 CShell 的同一能力目录：智能体可以发现它，命令台/CLI 的 `tools`、`help` 可以读取真实输入契约，MCP 的 `discover_capabilities` 和 `invoke_capability` 可以调用。工具名称是稳定的 `extension_` 加包 ID / 工具 ID 的摘要，描述中保留可读的包名与工具 ID。使用目录返回的真实名称，不猜名称。MCP 已建立连接时新增包，用动态能力发现刷新；使用全量静态工具列表的客户端可能需要重新列举或重连。

本机扩展执行的是 **CShell 所在电脑**，选中远程机器不会把它搬到远端。若需要在另一台机器执行，在那台机器导入到 CAgent：

```text
cagent extension-import example.echo.cshellext
cagent extension-import example.echo.cshellext --confirm
```

重启该 CAgent 后，在能力包界面检查状态并单独授权。它会进入该机器的 `packages.tools` / `packages.invoke` 与本机智能体目录；CShell 连接该原生主机后，把工具的具体参数结构加入机器能力目录。新装工具需重新连接以载入契约，撤权或更换包会使旧契约立即拒绝调用。控制端须具备该机器管理及命令执行权限；选中 WSL 环境不会混入 Windows 主机的进程工具。账号云同步不携带可执行包或授权，不会自动把本机批准复制到其他机器。

### 两层清单

外层 `manifest.provider` 为 `process`，`permissions` 固定为 `["remote.execute"]`，表示执行类扩展。实际运行位置仍是安装扩展的宿主；它不隐式赋予远程执行权限。`manifest.capability` 沿用 CAgent 能力包协议：

| 字段 | 用途 |
| --- | --- |
| `id`、`version`、`adapterId` | 与外层包 ID、版本一致；适配器 ID 必须等于包 ID；禁止 `cshell.*`、`cagent.*` 保留前缀 |
| `compatibility` | 操作系统、x64/arm64 和宿主版本范围；范围外显示不兼容 |
| `files` | 每个文件的相对路径、字节数和 SHA-256；必须与外层 base64 文件集合完全一致 |
| `permissions` | 至少包含 `extension.execute`；每个工具也必须声明此权限 |
| `tools` | ID、描述、对象类型的输入/输出 JSON Schema、权限、`sideEffect` |
| `process` | 下表的执行配置 |
| `events` | 当前进程协议必须为空；不支持常驻事件监听 |

进程配置例子：

```json
{
  "protocol": "node-json-stdio-1",
  "entry": "echo.cjs",
  "timeoutMs": 10000,
  "maxOutputBytes": 65536,
  "maxConcurrency": 1
}
```

入口必须是清单中声明的 `.cjs`、`.mjs` 或 `.js` 文件。运行时使用应用自带 Node，不修改系统 Node、PATH 或软件源，不运行安装脚本。纯 JavaScript 依赖需随包提供；宿主不执行 npm 安装，原生 addon 不加载。包内文件总大小最多 16 MiB，清单最多 128 个文件。

### 请求与响应

每次调用一个新进程，工作目录为核验后的包目录。主程序向 stdin 写一条 JSON 并关闭输入：

```json
{"protocol":1,"id":"由宿主生成的 UUID","tool":"uppercase","args":{"text":"hello"}}
```

扩展在 stdout 只写一份 JSON，再正常退出；`id` 必须原样返回：

```json
{"protocol":1,"id":"与请求相同的 UUID","result":{"text":"HELLO"}}
```

输入和结果分别按声明的 JSON Schema 校验；不能在 stdout 混入日志。stderr 只作为有界诊断通道，不转发到模型或应用日志。未授权、结果格式不匹配、摘要改变、超时与超量输出均返回错误，不自动重放工具调用。

| 限制 | 实际范围 |
| --- | --- |
| 输入 | 64 KiB，包含协议封套 |
| 输出 | 默认 256 KiB，可设 1 KiB–1 MiB |
| stderr | 64 KiB；超限停止 |
| 时限 | 默认 30 秒，可设 100 毫秒–120 秒 |
| 每包并发 | 默认 1，可设 1–4；整个能力运行时最多 8 |
| 环境变量 | 不继承密钥、`NODE_OPTIONS`、`NODE_PATH`；仅传递基本系统/临时目录与语言配置 |

停用、撤权、卸载或替换会取消进行中的调用，并使旧工具引用失效。更新包字节后需要重新授权，即使版本号未变也不会沿用旧授权。卸载后重启不会自动装回。

**独立进程不等于操作系统安全沙箱。** 授权代表允许发布者代码以当前系统用户身份执行，包括该用户可访问的文件与网络；进程的时限和输出限制不替代来源审查。外部 `sideEffect: false` 不能降低 CShell 的执行审核等级。第三方声明不能自行授予权限、获取主程序密钥或扩大已有机器范围。

测试入口：`node node_modules/tsx/dist/cli.mjs --test tests/process-extensions.test.ts`。测试使用临时目录与真实本机子进程，覆盖授权、重启、撤销、更新、取消、并发、摘要校验和输入/输出边界，不接触用户连接。
