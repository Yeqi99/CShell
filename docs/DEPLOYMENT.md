# 批量安装与初始配置

适用于机房管理员为每个学生的 Windows 用户安装 CShell、按需安装 CAgent，并预选扩展。以学生实际使用的普通账号运行；不要用管理员账号代替学生账号初始化加密数据。

需要包含 `--provision-file` / `--provision-only` 功能的新构建；已发布的旧 0.8.10 不支持这些参数，不能用于此脚本。脚本发现 CShell 已运行会退出；安装超过 5 分钟或配置超过 60 秒会报错，不强制结束任何进程。超时后先检查实际应用状态再重试。

## 先准备配置，再安装

### 一键课堂方案

教师与学生使用不同的一键包。教师包双击 `Install Classroom Teacher.cmd`，仅安装 CShell 并在新数据目录预选 `cshell.classroom`、`cshell.agent`；不会安装 CAgent 被控程序、创建密码或开启监听。`Install-ClassroomTeacher.ps1` 默认预检，`-Apply` 执行。旧配置保持，需自行检查扩展是否已启用。

完整的课堂部署 ZIP 里双击 `Install Classroom Student.cmd` 即应用显式课堂预设。先核对整个 ZIP 的发布摘要；需要先查看计划时运行 `Install-ClassroomStudent.ps1`（不加 `-Apply`）。脚本再核对包内 CShell 安装器、CAgent 安装脚本和学生机部署脚本的摘要。

新安装会预装并启用 CShell 的机房共享和 CAgent 扩展；初始化 CAgent 密码为用户指定的 `123456`，监听本机所有接口的 `24443` 端口、启动应用，并设置用户登录后自动启动。可用 `-Port`、`-Room`、两个 Destination 参数调整端口、机房名和专用程序目录。密码经当前用户私有临时文件传入，清理后不保留在命令参数或运行日志中。这个固定密码只用于显式课堂预设，通用安装默认不变。

CAgent 的机房发现能力按本机名称及机房名显式开启，不包含密码；远控使用已内置的 Windows 桌面能力及现有认证通道，开启管理和桌面查看/控制，HTTP、托管和中继保持关闭，不额外开放桌面直连端口。安装不修改防火墙；若组织网络策略阻止访问，由管理员按实际需要设置。已有任何数据目录仍保留原密码、端口、发现设置和权限，已有开机启动关闭选择也保留，不能声称旧机器已被重置为课堂配置。

普通脚本仍以预检为默认。下面的通用示例不会自动采用课堂密码或开放监听。

安装文件从官网下载。核对官网提供的 SHA256 后保留原文件；CAgent 离线包应完整解压。部署脚本不会下载或执行来源不明的安装器，不修改全局 PATH、软件源、防火墙，也不会关闭已运行的应用。

示例位于 `scripts/windows-deployment/`：

- `cshell-student.example.json`：选装并启用机房共享、CAgent、Shell 扩展。
- `cagent-student.example.json`：CAgent 初始端口、监听地址、密码文件和允许的能力。
- `Install-Student.ps1`：安装 CShell，再应用初始配置；可同时安装 CAgent。

CShell 配置中的 `extensions` 是初始安装列表。每项用真实扩展 ID 和 `enabled` 指定开关。未列出的扩展不通过这个配置额外安装；启用机房共享扩展不等于开始共享屏幕，启用 CAgent 扩展不等于授予机器访问权限。初始配置只能应用到没有任何现存用户数据的新安装；升级不会覆盖已有账号、访客配置、扩展开关或授权。

```json
{
  "format": "cshell-deployment-1",
  "target": "cshell",
  "extensions": [{ "id": "cshell.classroom", "enabled": true }],
  "packages": []
}
```

## CAgent 端口、密码与权限

复制 CAgent 示例并按机器修改。`passwordFile` 是相对于配置文件的路径；密码文件只包含密码本身，可带一个末尾换行。密码不能写进命令行、JSON 的 `password` 字段或脚本参数。Windows 上把密码文件的读取权限限制为部署账号；Linux/macOS 要求当前用户所有、权限 `0600`。部署后由管理员妥善移除或保存密码原文件，程序不会自行删除输入材料。

默认监听地址 `127.0.0.1`、端口 `24443`，`listenOnLaunch:false` 不开启远程监听。需要局域网连接时明确设置本机接口地址或 `0.0.0.0` 并设置 `listenOnLaunch:true`；仅在下次启动 CAgent 时监听，不自动开放防火墙。

`shells` 为允许的 Shell 类型：Windows 通常 `powershell`/`cmd`，Linux 通常 `bash`/`sh`，macOS 通常 `zsh`；声明不会安装不存在的 Shell。`permissions` 中管理、HTTP、托管、中继四项必须逐项填写布尔值，不使用隐式全授权。远程桌面观看/控制和第三方进程扩展的执行仍通过独立授权设置。

```powershell
# 先只检查，不创建数据目录、启动服务或安装扩展
.\cagent.cmd provision .\cagent-student.json
# 核对输出后应用；已有数据目录会明确跳过，不能借此重置密码
.\cagent.cmd provision .\cagent-student.json --apply
```

成功初始化在私有临时目录完成加密写入后原子迁移，保留稳定设备身份。整个流程不会启动远程服务。中断前尚未迁移的数据不会进入正式目录；若连接配置已成功保存、后续扩展安装失败，保留新身份，可用 `extension-import` 单独重试扩展，不能删除数据目录重新初始化。

## 自定义扩展包

两个目标都可以使用 `packages:[{"file":"tool.cshellext","sha256":"完整的64位小写摘要"}]`。路径相对于配置文件。所有包在写入前检查真实文件 SHA256、包格式、内部文件摘要、平台和已实现的 Provider；重复 ID 拒绝。CAgent 只接受适用的独立进程扩展或受信任的微信扩展。安装包不授予执行权限，也不会自动执行扩展工具。扩展是程序代码，管理员仍需核对可信来源。

## 学生机安装命令

以下参数全部为路径和公开摘要，不含密码。`CShellExecutable` 指定最终程序路径，脚本把它的父目录作为 NSIS 安装目标；也可显式给出一致的 `-CShellDestination`。程序文件名应为对应版本的 `CShell.exe` 或 `CShell Pro.exe`。安装前校验产品与最低 0.8.11 版本，安装后核对产品、路径及版本与已验证安装器完全一致，避免误用另一目录的旧程序。摘要应来自已验证的发布包或管理员的签名部署材料。

```powershell
.\Install-Student.ps1 `
  -CShellInstaller '.\CShell-Setup.exe' `
  -CShellSha256 '<官网公布的SHA256>' `
  -CShellExecutable "$env:LOCALAPPDATA\Programs\CShell\CShell.exe" `
  -CShellConfig '.\cshell-student.json'
# 确认预检后重复相同命令并添加 -Apply
```

同时部署 CAgent 时再给出 `-CAgentBundle`（完整解压目录）、`-CAgentConfig`、`-CAgentInstallerSha256`（已验证包内 Install-CAgent.ps1 的摘要），可用 `-CAgentDestination` 选择专用程序目录。CAgent 安装保持当前数据身份，不会强制停止旧后台；旧后台在运行时，下次正常退出后再打开新版本。

也可直接调用离线包中的 `Install-CAgent.ps1 -ProvisionFile .\cagent-student.json -NoLaunch`。`-PrepareOnly` 与初始部署不能同时使用。部署完成后手动打开应用检查；屏幕共享由用户主动发起，不通过安装脚本默默开启。
