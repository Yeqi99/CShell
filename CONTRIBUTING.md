# 贡献指南

先阅读 README、SECURITY.md 和架构决策。项目采用 MIT 许可证，提交贡献即表示你有权按同一许可证提供这些代码。

保持 core 不依赖 Electron/React，平台权限留在 desktop，界面文本放入 i18n。新 Bridge 方法需要严格 schema、调用方校验、明确的权限和资源释放策略。不要直接给渲染器暴露 ipcRenderer、文件系统或任意 shell 执行。

修改 SSH/传输必须加入有意义的集成测试；修改 UI 运行桌面测试并检查中英文、深浅主题及紧凑布局。测试凭据只能运行时生成，服务只监听 loopback。不得提交真实凭据、配置、构建目录或包含私人数据的截图。

提交前执行 `pnpm build`、`pnpm test`、`pnpm test:desktop`、`pnpm exec prettier --check src tests scripts docs README.md SECURITY.md CONTRIBUTING.md`。依赖变更提交锁文件与更新后的 notices。关键安全/兼容性取舍记录简洁 ADR，不用大量空接口代替实际实现。
