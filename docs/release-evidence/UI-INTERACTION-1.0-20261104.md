# 1.0 界面交互复验（2026-11-04）

本轮运行当前工作树源码，使用真实浏览器/Electron 渲染、受控后端与视频配置。不是手机实机或公网机器性能验收。

- 设置：1100/680/380 px 全部分类、暗色预览、搜索、跨分类草稿、显式权限保存和底部操作区通过。人工查看 680 px AI 与安全截图，全局权限按钮与分区对齐。
- Ping：全部与单机器图标、独立目标结果、排除 HTTP、自动间隔持久化；320/390/700 px、125% 缩放四边菜单限制通过。
- 手机远控：竖屏/横屏比例、窗口随方向调整、用户拖动位置保持、窄屏边界与坐标映射通过；应用搜索/启动、失败反馈和未授权文件目录空态通过。截图中的等待画面是测试流未发送真实帧，不代表手机采集验收。
- Android：真实移动 DOM 消费云端字体和选择；损坏本机缓存恢复，不隐式打开远程服务。
- 账号流量：无上限、预留、余额、刷新失败保留快照、切换账号清理，以及 1100/760/390 px 通过。
- CAgent 市场：查看或编辑不会自动保存权限；本机观看/控制独立。旧 smoke 脚本仍要求隐藏远端管理按钮，与已有授权远端管理功能不符，已改为检查远端入口存在且不隐式提交。

执行脚本：settings-studio-smoke、ping-all-ui-smoke、phone-remote-layout-smoke、mobile-sync-ui-smoke、account-traffic-ui-smoke、agent-capability-ui-smoke。全部退出码 0。

截图位于本地 test-results/settings-studio、test-results/phone-layout、test-results/agent-capability-remote-ui.png。
