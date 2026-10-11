# CShell 插件协议 v1

插件扩展本地工作台；应用配方修改用户选定的远端服务器。二者有独立生命周期，不属于外观方案，也不改变 MCP 权限。

## 内置插件

| 插件 ID         | 宿主能力                                         | 默认状态           |
| --------------- | ------------------------------------------------ | ------------------ |
| cshell.vim      | Vim 模式、编辑与退出操作                         | 已安装             |
| cshell.nano     | Nano 编辑操作                                    | 已安装             |
| cshell.commands | Shell 前缀补全                                   | 已安装             |
| cshell.docker   | 已连接服务器的 Docker Engine                     | 未安装；迁移旧开关 |
| cshell.conda    | Anaconda / Miniconda 环境、包、环境终端、Jupyter | 未安装             |
| cshell.python   | Python 文件编辑、Jedi 补全、签名与语法诊断       | 未安装             |

启停、卸载即时生效并持久化。卸载插件不会删除服务器软件或 Conda 环境。Docker Socket 属于插件设置；旧版工具开关迁移到插件状态。已打开的普通终端不因停用插件而关闭。

## 可下载包

v1 使用声明式 JSON 包，不在 Electron 渲染进程加载第三方 JavaScript。第三方包目前可以贡献 Shell 命令候选；内置远端能力由随应用审查发布的 provider 实现。v1 不是任意第三方代码运行时。

```json
{
  "protocol": 1,
  "id": "example.operations",
  "version": "1.0.0",
  "name": "Operations",
  "description": "常用只读运维命令",
  "publisher": "Example",
  "provider": "snippets",
  "permissions": ["terminal.input"],
  "commands": [
    { "label": "查看监听端口", "text": "ss -tulnp" },
    { "label": "查看磁盘容量", "text": "df -h" }
  ]
}
```

协议校验来源：`src/shared/plugins.ts`。未知字段、协议版本、控制字符、超量候选会被拒绝。第三方不能占用 `cshell.*`、指定内置 provider 或声明远端执行权限。命令候选只补全输入，不发送 Enter；用户仍需审阅并执行。

目录结构：`{ "protocol": 1, "plugins": [{ "manifest": <完整包清单>, "url": "https://…/operations.json", "sha256": "<原始 UTF-8 文件 SHA-256>" }] }`。

包通过 HTTPS 下载，拒绝重定向、超时、超大响应、校验和不匹配及目录与包清单不一致。发布者文字是目录声明，不是认证标识。目录提供者掌握包与校验和，使用者仍需信任插件源。安装包清单与启用状态存本机配置；无需保持联网。

运行 `pnpm exec tsx scripts/package-plugin.ts <manifest.json> <HTTPS-package-URL> <catalog-output.json>` 校验包并生成目录。将包与目录提交到 GitHub，通过固定标签的 raw.githubusercontent.com URL 分发；无需自建服务。默认官方目录位于 `marketplace/plugins.json`，应用目录位于 `marketplace/applications.json`，由 `scripts/marketplace.ts` 生成。发布前必须核对 `src/shared/market.ts` 的仓库和发行标签。

官方清单只有在下载地址与当前版本预设完全一致、且清单与编译内置功能完全匹配时，才能启用内置提供器。任何第三方清单都不能借用官方命名空间或获得远端执行权限。外部目录仍仅支持声明式命令。市场不提供独立账号、评级或运行第三方 JavaScript；投稿通过 GitHub Pull Request 审核，客户端升级携带新的可信提供器。目录读取失败可继续使用随包清单。

## 应用配方

`src/core/applications.ts` 在后端生成有期限、一次性的安装计划，绑定真实 session ID。前端不能把任意脚本作为安装计划提交。检查条件不安装软件，用户点击“安装到此服务器”才运行计划；计划展示目标连接与完整命令。

- Miniconda / Anaconda：Linux x86_64 / aarch64；读取官方索引中的具体文件名与 SHA-256，下载后验证再运行。目标为当前用户 HOME；拒绝覆盖既有安装；不修改 shell rc、不自动接受额外商业许可或频道条款。需要 curl、bash、sha256sum 及发行版兼容的 glibc。
- Python：在已有 Conda 中创建独立环境，可选版本与名称；缺少 Conda 引导先安装发行版。
- Jedi / JupyterLab：使用所选解释器的 `python -m pip` 安装。系统受管理环境可能拒绝全局 pip 安装；选择独立 Conda 环境，不使用 `--break-system-packages`。
- Nginx / Redis：当前提供 Debian / Ubuntu 的 apt + systemd 配方，要求 root SSH 身份；不自动 sudo。使用发行版配置，安装服务可能启动默认监听端口，完整命令在执行前可见。

任务使用独立 SSH exec 通道，记录进度、输出、退出码、超时与断连。每个连接串行修改，最多保留 100 条内存记录，每条截断至约 100 KB；应用退出不持久化安装日志。停止任务发送 TERM 并关闭通道，不保证包管理器事务回滚，也不代表已安装文件被撤销。

## Anaconda / Python 上下文

环境检测通过 PATH 与常见用户/系统 Conda 路径发现可执行文件，然后读取 `conda env list --json`。自定义安装位置必须能被远端非交互 PATH 找到。支持创建、删除非 base 环境、查看 pip 依赖、安装包；删除有确认并重新核对环境归属。

“在此环境打开终端”创建独立 PTY，使用 `conda run --prefix`，不向原来的 Vim 或运行中程序注入激活命令。新终端共享所属 SSH 连接：关子终端不关父连接，父连接断开时子终端同时结束。

双击远端 `.py` 文件进入 Python 编辑页。UTF-8、1 MB 以内的常规文件支持读写，保存验证原文件摘要后使用同目录临时文件与 OpenSSH 原子重命名扩展；外部修改冲突不覆盖，服务器不支持该扩展则保留原文件并报告失败。远端外部进程仍可能在最终校验与重命名之间写入，这是 SFTP 无条件写入的协议限制。草稿按连接和文件在内存保留，关闭扩展页签不会丢失；退出应用或关闭所属会话页签会释放。

Jedi 在所选远端解释器运行，分析编辑文本、不执行文本；支持模块、成员、函数签名、语法诊断与 Unicode。项目没有实现调试器、类型检查器或重构系统。补全引擎读取当前解释器可见的模块，不自动安装依赖。

终端 Python / IPython 需要观察到交互解释器启动以及实际提示符。已知 Conda 环境终端或绝对解释器路径可自动关联；其他情况显示紧凑环境选择，避免把系统 Python 当成当前虚拟环境。退出到 Shell、全屏程序、密码提示或断连时不应用 Python 补全。终端分析基于本次可观察输入文本，不读取活跃 Python 进程里的动态对象；Vim / Nano 内的 Python LSP 尚未实现。

Jupyter 以已认证的 SSH 用户在所选环境启动（支持 root 连接，不调用 sudo），绑定远端 127.0.0.1，通过 SSH 转发到本机随机回环端口；随机 token 在后端产生，不写配置或任务日志。点击打开时在系统浏览器进入，本机 URL 不开放到局域网。停止或 SSH 断开会清理转发与本次启动的进程通道。已有外部启动的 Jupyter 不在本次管理范围内。

## 参考

- [Conda 环境管理](https://docs.conda.io/projects/conda/en/stable/user-guide/tasks/manage-environments.html)
- [Jedi API](https://jedi.readthedocs.io/en/latest/docs/api.html)
- [CodeMirror 补全接口](https://codemirror.net/examples/autocompletion/)
- [Jupyter 认证与 token](https://jupyter-server.readthedocs.io/en/latest/operators/security.html)
- [Anaconda 安装器索引](https://repo.anaconda.com/archive/)、[Miniconda 索引](https://repo.anaconda.com/miniconda/)
