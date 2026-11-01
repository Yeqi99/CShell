# 0.8.18 最终双版本源码核对

本轮在 Core `94acf25` 与 Pro `b6007d1` 基础上只读比较全部 `src`、Android 主源码与打包脚本，再修复发现的差异；没有以构建通过代替源码核对。

## 发现并修复

- Core `agent-terminal` 已设置网络出口回调，但启动 PTY/命令时传入 `undefined`。改为宿主 Shell 消费出口环境；WSL 不继承宿主代理。新增实际子进程与新建 PTY/WSL 隔离测试。
- Core 网络设置同时显示旧的单次远端代理表单与新的多条身份规则。移除重复旧表单，保留真实统一规则。
- Pro 桌面关闭未等待官方 OpenCode 运行时，活动判断也漏计官方请求。恢复与 Core 相同的关闭等待和活动计数；新增真实等待中的官方下载取消/等待完成测试。
- 新建 CAgent 连接的按需下载区只有 Pro 有。通用 UI/桥接同步 Core，并把两版目录查询改为严格当前渠道；不再从两渠道混选最高版本。目录必须提供有效摘要、精确版本路径与文件名。新增跨渠道/替换目录拒绝测试。

## 保留的差异及依据

| 范围 | 保留原因 |
| --- | --- |
| account-import/workspaces/profiles/guest-cache、cloud-*、portable-plugins 与相应 Store/IPC | Pro 账号、访客隔离、加密云恢复；Core 不依赖云服务 |
| CAgent cloud/account-network、assistant shared providers、账号记忆、原生/网页账号菜单 | Pro 共享模型、账号外观、会员网络；通用工具、自动化、能力包、终端和远控代码保持共同实现 |
| ClientProvider/Server/Relay 的 delegation/cloudLease/accountManaged | Pro 借用设备、权益与账号中继；Core 配对/直连能力未移除 |
| desktop/main 初始化和进程锁、entry 导入辅助进程、品牌图标 | Pro 独立应用身份、账号目录、切换屏障；避免与普通版互相覆盖 |
| browser/http/ai/export/import，OpenCode/Tavily cloud 方法 | 加密云快照、账号切换及未知字段保护；模型调用与目录兼容的通用修复两端均有 |
| download-source/updates 的 edition 参数 | 必须分别使用 opensource/pro 安装及更新渠道 |
| Android Cloud*、MainActivity 登录恢复、AgentConnection 中继、MachineBrowser owner 隔离、Manifest 标签 | Pro 账号/会员特有；AndroidControlService、协议/UI输入、剪贴板等公共生产实现一致 |
| AgentAccountNetwork/CloudSettings/Account*/MachineLending 以及调用入口 | 依赖 Pro 后端权益/账号方法，不作为虚假入口搬到 Core |
| desktop native/service/shared clipboard 等尾部空行、import 顺序 | 无执行语义差异，不为格式重建 |

检查了同名文件中混合的共同逻辑，不只按文件名排除整个文件。CagentWindow 的 `--verify-capability-runtime` 与目录隔离保护仅 Pro 存在，是 Pro 账号验收入口；Core 没有该命令执行分支。

## 二进制范围

此前 Pro 桌面 `ca92ec4`、Core `143418e` 至本次核对前，生产 src/Android main 无后续变化；候选摘要与当时源码一致，但上述遗漏使对应成品已标记作废，不用于发布。

本次影响：全部 Core 桌面和独立 CAgent，以及全部 Pro 桌面。Pro 独立 CAgent与两版 Android 生产源码未改变，可保留此前核验的附件；最终新摘要以重建后的库存为准。未经实机安装的 Android 状态仍需单列，不能用仪器验收代替手机安装。
