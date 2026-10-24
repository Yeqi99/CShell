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

