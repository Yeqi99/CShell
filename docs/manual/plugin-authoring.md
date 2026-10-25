# 制作第一份声明式扩展

[在线阅读与全文搜索](https://shell.canp.ai/docs/plugin-authoring.html)

<!-- Derived from services/portal/docs/plugin-authoring.html; edit the portal source then export. -->


<p>目标：提供两个只读运维命令候选。此扩展不会自动连接机器或执行命令。</p>



<h2 id="section-1">1. 编写清单</h2>

<p>保存为 operations.json：</p>

<pre><code class="language-json">{
  &quot;protocol&quot;: 1,
  &quot;id&quot;: &quot;example.operations&quot;,
  &quot;version&quot;: &quot;1.0.0&quot;,
  &quot;name&quot;: &quot;Operations&quot;,
  &quot;description&quot;: &quot;常用只读运维命令&quot;,
  &quot;publisher&quot;: &quot;Example&quot;,
  &quot;provider&quot;: &quot;snippets&quot;,
  &quot;permissions&quot;: [&quot;terminal.input&quot;],
  &quot;commands&quot;: [
    {&quot;label&quot;: &quot;查看监听端口&quot;, &quot;text&quot;: &quot;ss -tulnp&quot;},
    {&quot;label&quot;: &quot;查看磁盘容量&quot;, &quot;text&quot;: &quot;df -h&quot;}
  ]
}
</code></pre>
<p>ID 使用自己的命名空间，不能占用 cshell.*。provider 只能是 snippets，权限只能声明 terminal.input。命令需要由用户确认执行，示例命令适用于具备相应工具的 Linux 目标。</p>



<h2 id="section-2">2. 校验并生成目录</h2>

<p>在仓库安装开发依赖后运行下列命令。将 YOUR_NAME / YOUR_REPO 替换成自己的仓库，并先准备不可变的版本标签。</p>

<pre><code class="language-sh">pnpm exec tsx scripts/package-plugin.ts operations.json https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/v1.0.0/operations.json catalog.json
</code></pre>
<p>脚本使用 src/shared/plugins.ts 校验协议，再为原始 UTF-8 文件计算 SHA-256。输出文件必须尚不存在，以免误覆盖已发布目录。生成结构为 protocol + plugins 数组，每项包含完整 manifest、url 与 sha256。</p>



<h2 id="section-3">3. 发布与安装</h2>

<p>将原始包和生成的 catalog.json 提交到 GitHub。下载地址应使用固定版本标签的 HTTPS URL，不能依赖会随时变化的文件。修改包内容后重新生成摘要并发布新版本。</p>

<p>在 CShell 插件市场使用外部目录入口加载目录，检查来源后安装、启用。目录读取失败、重定向、超大响应、摘要不符或目录清单与包清单不一致都会被拒绝。</p>



<h2 id="section-4">4. 验证行为</h2>

<ul>
<li>插件启用后显示候选；选中仅补全，不发送 Enter。</li>
<li>停用后不再贡献候选，不中断已有终端。</li>
<li>修改一个字节后旧摘要应被拒绝。</li>
<li>测试密码提示、断开和全屏程序，不向错误上下文填入内容。</li>
</ul>


<h2 id="section-5">5. 加入官方目录</h2>

<p>通过 Pull Request 提交功能说明、固定下载地址、清单和验证结果。官方目录位于 marketplace/plugins.json，由 scripts/marketplace.ts 生成。官方内置 Provider 不能被第三方清单借用。</p>

<p><a href="https://github.com/Yeqi99/CShell/blob/main/docs/PLUGINS.md">完整插件协议</a> · <a href="https://github.com/Yeqi99/CShell/blob/main/scripts/package-plugin.ts">校验脚本</a></p>


<h2 id="process-tools">进程工具：一次包装，多种入口</h2>
<p>如果需要实际执行自己的逻辑，使用 <code>process</code> 类型的 <code>.cshellext</code> 包。它与上文只填入命令的 snippets 不同：每个工具声明独立输入、输出 JSON Schema、权限和副作用，宿主在授权后启动有界子进程，并将同一工具提供给智能体、命令台、CLI 和 MCP。</p>
<ol><li>从仓库 <code>examples/process-extension</code> 开始，运行 <code>node examples/process-extension/package.mjs</code> 生成示例包。</li><li>导入、启用并确认运行授权。未授权时工具不进入可调用目录。</li><li>用 CLI 的 <code>tools</code> 查实际工具名、<code>help 名称</code> 读契约，再以 <code>call 名称 {JSON参数}</code> 调用。不要猜工具 ID。</li><li>修改文件后重新计算摘要并升级包；摘要、协议、结果结构、权限或时限不符合要求时调用失败，不自动重放。</li></ol><p>运行时使用应用私有 Node，不安装全局依赖；输入、输出、时限与并发都有上限。独立进程拥有当前系统用户可用的权限，并非操作系统沙箱。完整两层清单、进程协议、授权边界和例子见<a href="https://github.com/Yeqi99/CShell/blob/main/docs/CUSTOM-EXTENSIONS.md">自定义扩展开发手册</a>。</p>


<h2 id="package-import">导入文件包</h2>
<p><code>.cshellext</code> 是 UTF-8 JSON，或同一 JSON 的 gzip 文件。外层包含 <code>format: "cshell-extension-1"</code>、<code>manifest</code> 和带摘要的文件集合。使用自己的命名空间，不能占用内置 Provider 或伪造发布者。包拖入扩展页后先预览再安装，安装不代表启用或授权。</p>


<h2 id="local-package">本地扩展文件格式</h2>
<p>不发布到市场，也可以将命令扩展保存为 <code>.cshellext</code> 文件，由使用者导入或拖入。文件为 UTF-8 JSON；可 gzip 压缩同一内容。保留 <code>cshell.*</code> 命名空间，使用自己的发布者前缀。</p>
<pre><code>{
  "format": "cshell-extension-1",
  "manifest": {
    "protocol": 1, "id": "example.commands", "version": "1.0.0",
    "name": "我的命令", "description": "常用命令", "publisher": "Example",
    "provider": "snippets", "permissions": ["terminal.input"],
    "commands": [{"label": "磁盘空间", "text": "df -h"}]
  },
  "files": []
}</code></pre><p>命令不能含换行或控制字符，不自动执行。导入与启用是两个步骤。此示例只提供声明式候选。需要执行逻辑时使用上文 process 工具包并单独授权；带原生微信运行时的包仍要求受信任发布者签名，不能通过声明权限绕过校验。</p>
