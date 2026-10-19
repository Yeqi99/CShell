# OpenCode 模型扩展

OpenCode 作为可安装、停用和卸载的内置扩展 `cshell.opencode` 提供，默认不启用。供应商地址、模型目录、协议转换、凭据和 Go 用量处理位于 `src/extensions/opencode/`；CShell 基座只消费通用扩展注册接口。不是在普通基座表单中写死一个 OpenCode 预设，也不加载第三方下载的任意可执行代码。

## 接入

1. 在插件市场启用 OpenCode，进入该扩展。
2. 点击“获取 API Key”进入官方控制台 Keys 创建 Service Account / API Key。只需要 Key，账号名和工作区网址可选；不要把 Key 发到聊天里。也可点击“通过浏览器登录”，在官方页面确认代码、工作区并批准。
3. 在扩展中输入 Key，点击“保存并检测”；支持最多 32 个独立账号。保存后先验证认证配置，再发送最多 64 输出 token 的简短模型测试，随后加载模型和 Go 用量。检测失败仍保留已保存密钥并显示具体错误。Key 使用 CShell 后端凭据加密，不放进普通基座配置、外观导出或模型返回值。
4. 默认选择 Go 套餐，搜索模型，添加为智能体基座。之后在智能体基座设置可以直接切换该目录的模型。

Go 与按量计费使用不同目录和请求路径，扩展不自动将 Go 请求降级到按量计费。官方账号已经开启的超额余额设置仍由服务端决定，扩展只展示，不修改。浏览器登录状态不等于 API Key；本实现不读取浏览器 Cookie。支持官方 OAuth Device Flow，须在浏览器明确批准；不复用或提取已登录浏览器的 Cookie。刷新令牌加密保存并串行轮换，刷新开始先落盘标记，异常或重启后结果未知时要求重新登录，避免重复使用单次刷新令牌。

## 模型与用量

模型从官方目录动态获取，缓存五分钟，可手动刷新。未知协议及 System One 类型决策模型保留在列表但不可选择，不能伪装成聊天模型。已实现 Chat Completions、Responses、Anthropic Messages 和 Gemini 文本/工具调用适配；目录可用不代表账号拥有对应套餐或权限。

Go 用量读取官方 `GET /inference/go/v1/usage` 的 rollingUsage、weeklyUsage、monthlyUsage，包括使用百分比和重置时间。缺少字段、鉴权失败或接口变化时显示不可查询；不把本地估算当成官方额度，也不把这些百分比称为现金余额。当前不支持现金余额 API。

主智能体请求发送扩展自己的 User-Agent 以及会话稳定的 `x-opencode-session`。停用扩展后后端拒绝新的模型调用；已保存基座保留，重新启用后可用。首次接入和套餐权限仍需要用户 Key 验证。

## 验证范围

自动测试覆盖 Go/按量路径隔离、凭据不外泄、停用阻断、加密配置恢复、官方额度格式、SSE 分片与不完整流拒绝、工具结果和 Gemini thought signature 往返。界面测试覆盖添加基座、用量显示与窄窗口布局。

没有使用用户账号发起收费推理，也没有读取用户真实额度。模型适配测试不是全部线上模型的兼容认证；新增模型、服务端限流和 Go 订阅可用性需要实际 Key 验证。

官方依据（2026-10-19）：

- [Console API / Keys](https://opencode.ai/v2/docs/console/api/)
- [Go 模型和调用要求](https://opencode.ai/v2/docs/console/go/)
- [推理接口](https://opencode.ai/v2/docs/console/api/inference/)
- [已合并 Go 用量接口](https://github.com/anomalyco/opencode/pull/16513)
- [官方旧路径到新 inference 的映射源码](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/lib/inference-proxy.ts)

## 多账号与验证边界（本次更新）

模型引用包含稳定账号 ID、计费目录、模型 ID。旧单 Key 配置迁移为 default，旧模型引用保持绑定；删除账号后对应基座明确失败，不自动切到其他 Key。Go 与按量目录始终分离。官方公开目录及免费模型成功不能证明密钥有效，检测必须先通过认证的 `/console/api/v2/config`。账号摘要不返回密钥、设备代码或刷新令牌。

设备授权与多账号流程已由隔离网络夹具验证；尚未使用真实用户 Key、真实浏览器批准验证在线登录或套餐额度。不提供不存在的现金余额接口；用户在扩展保存 Key 或批准登录后即可实际检测。
