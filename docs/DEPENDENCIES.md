# 依赖决策

当前锁定的主要运行组件：Electron 44.7.0（MIT，另附 Chromium 许可证）、React/React DOM 19.3.0（MIT）、xterm.js 6.0.0 及 fit/search/unicode11 addons（MIT）、ssh2 1.17.0（MIT）、Zod 4.6.5（MIT）、Lucide React 1.54.0（ISC）。完整声明以安装包内 THIRD_PARTY_NOTICES.txt、LICENSE.electron.txt、LICENSES.chromium.html 为准。

没有引入闭源终端产品代码、图标或受保护资源。参考图只用于布局和密度参考；CShell 图标来自仓库内原创 SVG。

ssh2 是成熟但发布节奏相对慢的协议组件。锁定版本后采用真实协议集成测试，升级时需要重跑认证、hostVerifier、SFTP 和关闭路径。cpu-features 和加密加速模块为可选原生优化，当前不执行构建，使用纯 JS 路线，后续用压力测试决定是否需要替换后端或启用优化。

Electron 采用与已安装版本匹配的类型/API，包括异步 safeStorage 和 clipboard；安全补丁需要持续维护，不能只依赖 npm audit。打包工具含部分废弃的传递依赖，属于构建工具链维护风险，已保留锁文件，不在本预览版随意批量升级。

许可证自动清单覆盖生产依赖和 Electron 包依赖，属于发行审查输入，不是法律兼容性结论，也不替代完整二进制发行物审查。项目自有代码仍由所有者最终选择许可证。

一手参考：[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)、[xterm.js Security](https://xtermjs.org/docs/guides/security/)、[ssh2](https://github.com/mscdex/ssh2)、[SFTP API](https://github.com/mscdex/ssh2/blob/master/SFTP.md)。

0.1.3 新增官方 @modelcontextprotocol/sdk 1.32.1，MIT。修复许可证脚本对导出映射指向 dist/cjs/package.json 的处理；递归记录 118 个组件，无 UNKNOWN，包含 MIT、ISC、BSD、Apache-2.0 与 Unlicense。pnpm audit --prod 当次无已知漏洞。
