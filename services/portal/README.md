# CShell 官网

生产地址：https://shell.canp.ai/。使用现有香港服务器与 Caddy；账号 API、安装包、管理员和 CanpAI 保持各自路由。

## 设计与内容

- 首页：`index.html` + `home.css`，单一样式入口。四客户端平台与连接协议分层；`showcase.js` 提供带键盘支持的真实界面导览。
- 下载：`downloads.html` + `download-picker.css/js`。按产品/平台筛选；保留无JS全部附件访问、原架构与摘要。
- 文档：`docs/*.html` + `docs-reader.css/js`；24篇文章，全文搜索索引由构建工具生成。首页搜索参数可直达结果。
- 调研与设计依据：`docs/PORTAL-DESIGN-RESEARCH-20261024.md`，10个官网与收录来源。
- 平台事实：CShell/Pro支持Windows、macOS、Linux、Android；CAgent独立包支持Windows/macOS/Linux，Android被控能力在CShell扩展内。不能用OS列表替代连接协议，也不能承诺各系统原生桌面能力相同。

## 编辑与验证

直接编辑HTML，不用旧生成器覆盖内容。`scripts/build-portal.mjs`验证26个页面、内部链接并生成137个章节索引。`scripts/portal-smoke.cjs`检查4设备选择、所有文档与搜索；`scripts/portal-redesign-smoke.cjs`检查4平台入口、场景切换、320/390/1440布局、图片、首页搜索交接与下载空态。设置PORTAL_ORIGIN可对线上执行新版验证。

下载改动必须对比所有既有附件URL与摘要，开源CShell走GitHub，Pro与CAgent走香港源。当前0.8.8，macOS未公证，macOS/Linux实体设备覆盖有限，限制靠近下载操作呈现。

## 发布

备份现有portal，在独立目录覆盖已检查的内容，然后切换静态目录。仅发布本次网站文件；不要覆盖管理员、API、安装包或CanpAI。页面资源带版本参数防止旧缓存混用。发布后重复线上交互检查、下载地址与页面HTTP验证。
