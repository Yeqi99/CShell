# 应用配方与 CAgent 能力包

[在线阅读与全文搜索](https://shell.canp.ai/docs/app-authoring.html)

<!-- Derived from services/portal/docs/app-authoring.html; edit the portal source then export. -->




<h2 id="section-1">选择正确层级</h2>

<p><strong>应用配方</strong>负责在明确的目标机器检查和安装系统软件。<strong>能力包</strong>将已经安装、配置并核验的软件包装成工具。两者都不是任意远程脚本上传入口。</p>



<h2 id="section-2">添加应用配方</h2>

<p>CShell 的 SSH 应用安装实现位于 src/core/applications.ts；CAgent 对应 src/agent/applications.ts。先从已有配方了解目录、检测、计划与执行流程，再在源码中加入自己的受信任配方并提交 PR。</p>

<ol>
<li>约束平台、架构与包管理器；列出真实依赖与版本。</li>
<li>实现只读检查；检测阶段不能安装软件。</li>
<li>生成绑定真实连接的有限期计划，展示命令、目录、权限与网络影响。</li>
<li>用户确认后，通过独立受管进程或连接执行；不向正在使用的终端注入命令。</li>
<li>实现输出、退出码、取消和断开反馈，不自动 sudo、改软件源或覆盖环境。</li>
</ol>
<p>测试至少覆盖缺少依赖、已有安装、权限不足、取消、断线和重复计划。不能把包管理器进程退出当作所有工具能力已可用。</p>



<h2 id="section-3">能力包的文件与契约</h2>

<table><thead><tr><th>源码</th><th>作用</th></tr></thead><tbody><tr><td>src/shared/agent-capability-packages.ts</td><td>清单、平台、版本、权限、工具与事件契约</td></tr><tr><td>src/agent/capability-packages.ts</td><td>生命周期及可信主机接口</td></tr><tr><td>src/agent/capability-catalog.ts</td><td>可信目录</td></tr><tr><td>src/agent/capability-installer.ts</td><td>获取、暂存与文件核验</td></tr><tr><td>src/agent/capability-runtime.ts</td><td>Vault、适配器与工具注册</td></tr></tbody></table>
<p>清单包含包 ID、版本、平台/架构、CAgent 版本区间、GitHub release 来源、文件大小与 SHA-256、adapterId、权限，以及工具输入/输出 object schema。以协议源码为准，不添加未知字段。</p>



<h2 id="section-4">实现可信适配器</h2>

<p>内置适配器的 adapterId 必须对应主程序已实现的适配器；只写清单不会增加原生适配能力。内置实现提供 register、invoke、quiesce、stop、unregister，并随主程序审查构建。若需要分发自己的 JavaScript 工具，使用独立的 <a href="https://shell.canp.ai/docs/plugin-authoring.html#process-tools">process 自定义扩展</a>，按其清单与 stdin/stdout 协议包装；在安装宿主单独授权后运行，不在渲染进程动态加载代码。</p>

<p>只有文件、平台、版本、配置、授权和注册全部通过，状态才能为 available。未知适配器是 incompatible；安装不授予权限。升级仅保留旧权限与新清单的交集，新增权限需明确授权。</p>



<h2 id="section-5">验证与提交</h2>

<p>覆盖路径穿越、摘要变化、未知适配器、撤权、重启恢复及停止失败。卸载包不能误删用户系统软件和资料。PR 附上支持平台、工具副作用、实机结果和尚未验证的范围。</p>

<p><a href="https://github.com/Yeqi99/CShell/blob/main/docs/CAGENT-CAPABILITY-PACKAGES.md">能力包完整规范</a> · <a href="https://github.com/Yeqi99/CShell/blob/main/docs/AGENT-APPLICATIONS.md">应用安装协议</a></p>
