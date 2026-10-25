# 将你的功能加入 CShell

[在线阅读与全文搜索](https://shell.canp.ai/docs/developers.html)

<!-- Derived from services/portal/docs/developers.html; edit the portal source then export. -->


<p>先判断功能需要在哪一侧运行，再选择接入方式。CShell 使用 MIT 许可证；源码、目录和发行附件通过 GitHub 管理。</p>

<table><thead><tr><th>你要做什么</th><th>接入方式</th><th>是否运行第三方代码</th></tr></thead><tbody><tr><td>分享一组 Shell 命令候选</td><td>声明式扩展包</td><td>不运行脚本，仅填入候选</td></tr><tr><td>安装目标机器上的软件</td><td>应用配方 / 可信 Provider</td><td>审阅计划后在目标执行</td></tr><tr><td>为智能体加入可授权的应用工具</td><td>CAgent 能力包与可信适配器</td><td>需要主程序实现适配器</td></tr><tr><td>新工作台视图、协议或复杂交互</td><td>仓库源码贡献</td><td>随客户端审查、构建和发布</td></tr></tbody></table>


<h2 id="section-1">第一份扩展</h2>

<p>跟随<a href="https://shell.canp.ai/docs/plugin-authoring.html">声明式扩展教程</a>，从 JSON 清单开始。你可以独立托管包与目录；加入官方目录需提交 Pull Request。当前 v1 不是下载任意 JavaScript 就能运行的插件系统。</p>



<h2 id="section-2">应用与工具</h2>

<p><a href="https://shell.canp.ai/docs/app-authoring.html">应用与能力包接入</a>说明配方、安装计划、适配器、工具 schema 和授权的关系。安装成功不能直接显示工具可用，还需要配置、版本及权限检查。</p>



<h2 id="section-3">源码贡献流程</h2>

<ol>
<li>Fork <a href="https://github.com/Yeqi99/CShell">源码仓库</a>，阅读仓库 AGENTS.md 与相关协议。</li>
<li>在独立分支实现，复用现有设计组件、Provider 与授权边界。</li>
<li>为实际行为补充验证：目标绑定、断开、撤权、取消与失败。</li>
<li>提交 PR，写明功能入口、支持系统、权限、副作用和测试结果。</li>
<li>审核合入并随版本发布后，才能把新的可信 Provider 标记为可用。</li>
</ol>
<p>不要把密钥放在渲染进程、清单或示例中；不得用静态演示数据冒充机器实时能力。</p>
