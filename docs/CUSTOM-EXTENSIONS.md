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

`.cshellext` 是 UTF-8 JSON 文件，也可使用 gzip 压缩同一 JSON 内容。协议版本为 `cshell-extension-1`。普通自定义包目前支持 `snippets` 命令贡献，不加载任意 JavaScript、Python 或原生代码。原生微信适配包必须通过内置发布者公钥校验；不接受伪造内置 ID 或越权权限。

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
