# 官网整体设计调研 · 2026-10-24

调研对象共10个。官网与设计图库均实际读取；图库收录是选样依据，不等同获奖或所有用户一致好评。部分官网版本与图库历史版本不同，不将旧设计当作现行页面。

| 官网 | 设计收录/评价依据 | 观察与CShell取舍 |
| --- | --- | --- |
| [Linear](https://linear.app/) | [Curated](https://curated.design/sites/s/2659/) | 用工作流和产品界面证明价值，采用真实工作区展示，不复制其大量网格边框。 |
| [Raycast](https://www.raycast.com/) | [Narrow Labs](https://www.narrowlabs.design/website-inspiration/raycast1) | 系统平台页面与产品场景结合，采用明确平台入口和工具识别度。 |
| [Zed](https://zed.dev/) | [Curated](https://curated.design/sites/s/2519/) | 下载区将系统、架构、版本具体化，采用能力与安装信息分层。 |
| [Tailscale](https://tailscale.com/) | [A1 Gallery](https://www.a1.gallery/website/tailscale) | 下载系统完整并列、连接和平台分开，采用完整四客户端平台，避免OS和协议混成树。 |
| [Warp](https://www.warp.dev/terminal) | [Minimal Gallery](https://minimal.gallery/warp-dev/) | 从终端本身提取图形语言，采用窗口与光标等产品元素，不用无关3D装饰。 |
| [Stripe](https://stripe.com/) | [Lapa](https://www.lapa.ninja/post/stripe/) | 产品与解决方案导航分层；多种业务界面而不是纯文案说明。采用有具体含义的视觉示意，避免过度动效。 |
| [Vercel](https://vercel.com/) | [Lapa](https://www.lapa.ninja/post/vercel/) | 基础平台、产品、资源层级清楚；采用功能与文档路线分离，不复制网格化外观。 |
| [Framer](https://www.framer.com/) | [Lapa](https://www.lapa.ninja/post/framer/) | 编辑器与成果展示承担主视觉，采用产品画面与功能联动；不借用其作品充当CShell截图。 |
| [Figma](https://www.figma.com/) | [Lapa](https://www.lapa.ninja/post/figma/) | 多产品仍有清晰用途导航和资源入口；采用CShell/Pro/CAgent角色划分，避免把全能力塞进首页文案。 |
| [Notion](https://www.notion.com/) | [Lapa](https://www.lapa.ninja/post/notion/) | 功能按捕获、查找、自动化场景组织，采用按任务查文档和渐进展开。 |

## 重做原则

- 首页、下载页、文档入口作为一个系统，移除首页叠加的三轮样式；首页使用独立、单一的样式来源。
- 四客户端平台 Windows/macOS/Linux/Android 等权展示。CAgent独立包三系统，Android在客户端中启用被控扩展；不承诺所有平台同等原生远控能力。
- 首屏实际产品画面，展示后立刻提供全平台入口；场景切换采用真实现有组件截图，明示示例，不能捏造macOS/Android实机截图。
- 用具体工作流呈现连接、智能体、云同步与应用出口；信息在图形里有含义，动效尊重减少动态设置，不滚动劫持。
- 下载页按产品和平台筛选，原有架构、摘要与验证限制不丢失；无JS保留附件。
- 版本表用实际权益与容量；没有真实支付不能造购买按钮。微信私有扩展不进入官网市场展示。
- 文档保留24篇文章/全文检索/按任务入口，改进统一视觉和可读性，不删功能说明。

## 必要平台边界

CShell/Pro：Windows x64；macOS ARM64/x64；Linux ARM64/x64，AppImage/DEB；Android10+。CAgent独立包：Windows/macOS/Linux。Android被控是CShell中的扩展，需要系统录屏及无障碍授权；当前不是独立CAgent APK，也不承诺Android被控中继。macOS未公证，macOS/Linux实体设备覆盖有限。下载入口与已发布0.8.8附件一一对应。

## 视觉与上线验收

Stripe、Vercel、Framer、Figma、Notion均通过实际浏览器截图观察（Figma等待二次渲染后复查）；其余五站通过官网页面内容、产品/下载分区及图库资料核验。五站截图在本地`.local/research/`留档，不部署第三方素材到官网。

2026-10-24整体官网已部署香港源，旧静态目录保留回滚备份。构建校验26页、137索引章节；桌面及320/390px、4平台跳转、场景键盘切换、图片加载、首页搜索交接、下载空态均通过本地与线上检查。下载页另验证26个原链接/摘要完全相同、产品/平台组合、键盘、无JS降级。页面未借改版删除平台能力，未改客户端版本或安装包。
