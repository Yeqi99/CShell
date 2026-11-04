# MCP 更新与本机恢复验收

2026-11-04，用户授权通过 MCP 更新，避免鼠标操作。

- CShell `application_update`：status/check/download/install，独立 `updates.manage` 权限；安装显式 acknowledgeRestart，后台同渠道选包、摘要复验、延迟交接、持久化收据。重连后实际版本匹配才能算成功。
- CAgent：已授权机器管理的 `agent_manage` 暴露 update.check/download/status/install，禁止借用连接更新，不接受包 URL/路径；安装等待空闲。旧版必须先升级到支持此协议的版本。
- Pro/Core 均已同步实现，TypeScript 检查通过。更新器与渠道/摘要/便携升级 7 项测试通过；CAgent 16 项含真实 TLS、撤权、参数限制及生命周期测试通过。
- 实际 Windows 包独立数据验收：MCP 状态可读、撤销权限后拒绝、外部 URL 拒绝、缺少重启确认与未经校验安装拒绝；未通过测试接口伪造安装成功。

## 本机

- 安装位置：`E:/CShell/CShell Pro/CShell Pro.exe`，安装器退出 0，实际文件版本 1.0.0，重新打开供用户使用。
- 安装包 SHA256：`94a1ca177a6b7d1f0aa58eed1a2aafa485f3eec74d1ead5cd309b81f29c57d31`。
- 配置与加密身份备份：`C:/Users/35097/AppData/Local/CShellUpgradeBackups/20261104-184304`。未导出凭据明文。运行中的浏览器 Cookie 文件锁定，因此仅备份配置、加密数据和控制端身份，原浏览器数据保持原位。
- 经正常应用保存接口恢复“德威云”到 `p3.deviy.cn:53773`，保留连接 ID 与分组。重启后再次确认地址正确。
- 仅为用户当前 MCP 授权新增本次明确要求的 updates.manage，其他既有权限保持。
- 真正重连本机 MCP 后 application_update/status 返回 current=1.0.0；check 返回 checking，随后 status 返回 current、发行渠道版本 0.8.22。没有安装较旧版本。

## 限制

本机安装是首次引入 MCP 更新接口的命令行引导升级，不冒称使用旧版尚不存在的 MCP 自更新能力。实际新版本下载、安装、重启全链需下一次有高于本机版本的真实渠道包才能验收。当前是本机验证构建，1.0 尚未正式发布；远端 CAgent 未在本次操作中升级。macOS/Linux 的准备与撤权清理有代码及测试覆盖，本机 Windows 验收不能代替其真机验收。
