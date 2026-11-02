# 0.8.20 权限默认值与权限行布局

- 新账号 CAgent 工作区沿用首次安装的智能体默认值：命令、自动化可用，无逐次审核，委派范围仍受已认证控制端与后端授权约束。
- 已保存的关闭项、审核要求和委派限制保持不变；云导入模型不能重置这些选择。
- 应用权限的标题与说明归入同一个可聚焦选项，避免定位轮廓与相邻说明重叠。

验证：24 项 CAgent/自动化/账号测试通过；完整 TypeScript 与桌面构建通过；真实 Electron 隔离配置在 360/500/700 面板宽度检查无行重叠及横向溢出，并验证修改只停留在草稿，点击保存后才生效。截图在 test-results/permission-layout-020。旧 permission-links-smoke 依赖已经移除的 bundled 微信插件，因 Unknown bundled plugin 未执行到界面断言，不计为通过；本次使用不依赖该插件的 permission-layout-smoke。

本记录对应 0.8.20 源码修改，尚未构建发行包或安装到用户当前应用。现场旧账号的权限提示仍需区分明确关闭、旧工作区默认和连接认证问题，不能仅凭该修复声称所有旧配置已恢复。

最终尺寸复核：`getBoundingClientRect().width` 实测分别为 360/500/700 CSS px；当前 Windows `devicePixelRatio=1.25`，对应 PNG 位图宽度为 450/625/875 px。450 px 截图不是面板被最小宽度钳制。脚本现在同时断言实际 CSS 宽度与 PNG/DPI 比例，并保存 `test-results/permission-layout-020/geometry.json`。此次隔离 Electron 复验通过；未调整产品布局来迎合截图尺寸。
