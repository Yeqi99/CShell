# 使用扩展与应用市场

[在线阅读与全文搜索](https://shell.canp.ai/docs/extensions.html)

<!-- Derived from services/portal/docs/extensions.html; edit the portal source then export. -->


<p>这两个市场解决不同问题：<strong>扩展</strong>增加工作台能力；<strong>应用</strong>安装到你选定的真实机器上。</p>



<h2 id="section-1">扩展</h2>

<p>从扩展市场搜索、安装和启用需要的插件。Vim、Nano、Shell 联想、Docker、Conda、Python 等按各自支持范围工作。插件的专属设置和视图从已启用插件条目进入。停用插件不应关闭已有普通终端；卸载插件不会卸载服务器的软件。</p>

<p>第三方声明式命令包只提供候选命令，选中后仍需审阅并执行。不要把插件发布者的文字名称当作身份认证。</p>



<h2 id="section-2">应用</h2>

<ol>
<li>先选择要安装的目标机器。</li>
<li>检查真实包管理器、系统与已有依赖。</li>
<li>阅读安装计划、目录和权限影响。</li>
<li>确认后执行，在所属工作区查看进度和失败原因。</li>
</ol>
<p>安装任务使用独立通道，不向当前终端注入命令。不自动提权或添加软件源；停止任务不保证已经安装的文件被回滚。</p>



<h2 id="section-3">CAgent 能力包</h2>

<p>能力包将已安装的软件包装成可授权的工具。系统安装、配置、版本核验和工具授权分别检查，只有全部满足才显示可用。</p>

<p>准备接入自己的功能？先阅读<a href="https://shell.canp.ai/docs/developers.html">开发者接入路线</a>。</p>


<h2 id="catalog">常用扩展怎么选</h2>
<table><thead><tr><th>扩展</th><th>适用任务</th><th>使用前检查</th></tr></thead><tbody><tr><td>Vim / Nano</td><td>终端编辑器紧凑操作面板</td><td>当前确为编辑器，手动回退识别不会向普通 Shell 盲发按键</td></tr><tr><td>Shell 联想</td><td>补全常用命令</td><td>只补全不执行，密码与全屏场景不提供普通候选</td></tr><tr><td>Docker</td><td>当前机器的容器管理</td><td>真实 Socket 与授权，删除和端口重建需确认</td></tr><tr><td>Python / Conda</td><td>解释器与环境工作流</td><td>选择真实环境，缺依赖时查看安装计划</td></tr><tr><td>WSL</td><td>Windows 上的 Linux 发行版</td><td>只列实际检测到的发行版，网络变更不自动重启全部任务</td></tr><tr><td>HTTP</td><td>请求集合与多发送方</td><td>先启用扩展，再选择真实支持的发送环境</td></tr><tr><td>OpenCode</td><td>账号模型目录与智能体基座</td><td>模型可列出不代表账号可以推理，见专门排查页</td></tr></tbody></table>

<h2 id="safe-install">安装不等于可用，停用不等于卸载系统软件</h2>
<p>插件安装、启用、配置和授权是不同状态。CAgent 应用还需要配套软件、版本核验与工具注册。界面显示未配置或不可用时，按详情补齐条件，不仅重复点击安装。</p>
<p>应用安装绑定目标机器，通过独立通道执行，不占用正在编辑或运行任务的终端。不隐式替换系统依赖。取消只能停止后续工作，已发生的安装变化应按实际日志处理。</p>

