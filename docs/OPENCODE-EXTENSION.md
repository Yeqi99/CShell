# OpenCode 模型扩展

OpenCode 作为可安装、停用和卸载的内置扩展 `cshell.opencode` 提供，默认不启用。供应商地址、模型目录、协议转换、凭据和 Go 用量处理位于 `src/extensions/opencode/`；CShell 基座只消费通用扩展注册接口。不是在普通基座表单中写死一个 OpenCode 预设，也不加载第三方下载的任意可执行代码。

## 接入

1. 在插件市场启用 OpenCode，进入该扩展。
2. 粘贴自己的控制台工作区页面地址并保存。点击“管理 API Key”打开该工作区的 Keys 页面；创建或复制 API Key。新版控制台可能先要求添加 Service Account，然后 Add API Key。不要把 Key 发到聊天里。
3. 在扩展中输入 Key 并保存。Key 使用 CShell 后端凭据加密，不放进普通基座配置、外观导出或模型返回值。
4. 默认选择 Go 套餐，搜索模型，添加为智能体基座。之后在智能体基座设置可以直接切换该目录的模型。

Go 与按量计费使用不同目录和请求路径，扩展不自动将 Go 请求降级到按量计费。官方账号已经开启的超额余额设置仍由服务端决定，扩展只展示，不修改。浏览器登录状态不等于 API Key；本实现不读取浏览器 Cookie。当前采用 API Key 接入，没有实现 OAuth 登录。

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
