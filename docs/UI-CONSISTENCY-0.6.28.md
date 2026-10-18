# CShell 0.6.28 界面与画面恢复检查

本轮修正已保存 cagent 连接状态页缺少内边距、机器工作区导航与断开按钮错行、远端智能体任务输入区缺少布局、组件使用不存在的主题变量，以及偏好保存回读覆盖较新调整的问题。没有修改终端的字符布局或既有授权。

机器工作区按可用面板宽度响应布局，独立于整个窗口宽度；浅色和深色统一使用 panel、field、muted、red 等现有主题变量。任务输入与结果、错误提示、设置字段保留明确边距。已保存连接只在认证确实失效时补充认证，不回退到完整编辑表单。

远控显示端增加首帧等待提示。解码器接收帧后 1.2 秒没有输出时，否定确认该帧、销毁旧解码器、请求新的关键帧并改用软件解码；旧实例输出仍丢弃。画布未挂载或上下文不可用时不再报告已显示成功。这是显示链路的恢复措施，不能单凭本地验证认定远端黑屏的唯一原因。

验证入口与证据：

- `scripts/ui-consistency-audit.ts`：隔离 Electron，设置各分类及插件市场，1440/900 宽度、浅色/深色，记录可用内容宽度。
- `scripts/rdp-layout-smoke.ts`：SSH、cagent、Windows RDP、HTTP 连接入口、文本填充一致性、宽窄布局与保存。
- `scripts/agent-machine-smoke.ts`：真实隔离本机 Agent，终端、桌面入口、应用市场、设置草稿、失效认证与重连。
- `scripts/desktop-view-race-smoke.ts`：无输出解码器超时、过期回调、取消和目标切换。
- `scripts/desktop-view-ui-smoke.ts`：原生采集、真实 Electron WebCodecs 绘制、连接中分辨率调整；不注入系统输入。
- `scripts/desktop-saved-viewer-smoke.ts`：显式指定已配对测试设备，独立只读观看，不抢占已有桌面会话、不操作 RDP；失败也写证据。

上述范围覆盖主要工作区与共用样式，不代表所有第三方插件和所有远端应用的内部页面已逐一验收。

## 公网实机结果

已配对 Windows 测试机的 DXGI 初始化返回配置，但旧版本在 25 秒内没有输出视频帧。0.6.28 增加服务端首帧 3 秒超时，自动重新创建 GDI 兼容采集；兼容采集仍无首帧则明确关闭并报告 CAPTURE_NO_FRAMES，不无限显示已连接的黑屏。

更新远端后，通过正式 AgentDesktopView、Electron IPC 和 WebCodecs 的公网只读观看测试收到 105 帧、实际解码 105 帧，采集路径从 dxgi 切换为 gdi。证据：test-results/desktop-saved-viewer-0.6.28.json。没有注入键鼠、保存远端屏幕像素、迁移 Windows 会话或更改 RDP/防火墙。该结果不代表所有锁屏、RDP 会话切换及长时网络异常场景均已通过。

构建通过 TypeScript、Vite 和主进程打包；常规安装打包未生成附件，改用依赖完全一致的 0.6.26 Electron 运行时打包 0.6.28 应用内容，并逐字节核对主进程、preload 和 renderer 入口，见 test-results/repack-0.6.28.json。

本机 CShell 0.6.28 已静默安装并重新打开，窗口存在且安装 app.asar 与已核验包摘要一致，见 test-results/cshell-0.6.28-installed.json。安装包 SHA256：DEF9B6A42913CEC9721EFEBCD30BA3C97C966B24D2571CBE176F020514616510。未进行 GitHub 发布。
