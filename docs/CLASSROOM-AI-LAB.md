# Python 与 AI 教学环境

`scripts/classroom/Install-AI-Lab.ps1` 可作为机房后台脚本任务使用。默认只输出计划；加 `-Apply` 才下载和安装。脚本小于 16 KB，教师可先对一台测试机预检，再明确选择学生机器批量执行。预检不代表安装已验证成功。

```powershell
# 预检：目录必须尚不存在
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-AI-Lab.ps1 -Root D:\CShell-Lab
# 按预检计划执行，默认 CPU
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-AI-Lab.ps1 -Root D:\CShell-Lab -Apply
# 可选安装代理，仅本次进程和子进程生效，不改系统代理
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-AI-Lab.ps1 -Root D:\CShell-Lab -Proxy http://127.0.0.1:7890 -Apply
```

代理必须是 HTTP(S) 地址，不能携带密码、查询参数或片段。地址必须能从每台目标机器访问；目标机器的 `127.0.0.1` 并非教师机。未传 Proxy 时按 HTTPS_PROXY、HTTP_PROXY 顺序读取当前机器环境，下载和 pip 使用同一出口；配置代理失败直接报错，不重试直连。可先通过机房环境设置按需修改代理，无需把地址写死在模板。

## 安装内容

- Anaconda Distribution 2025.12-2，独立目录的 **base Python 3.13**；安装后实际检查 Python 主次版本。
- VS Code 1.143.1 官方便携版，用户数据放在其 `data` 子目录。
- PyTorch、Transformers、Datasets、Hugging Face Hub、OpenCV（`opencv-python`），安装到上述独立 base。
- `Classroom.code-workspace` 指向独立 Python；`Open-VSCode.ps1` 和 `Python.ps1` 可从所在目录打开工具。不自动下载模型权重，不配置 Hugging Face Token，不自动安装 VS Code 扩展。

默认安装官方 CPU wheel。已有 NVIDIA 驱动且明确需要 GPU 时，使用 `-Compute CUDA -CudaIndex cu128`（或 `cu126`）。脚本检查 `nvidia-smi`，安装后实际创建 CUDA tensor；失败不退回 CPU，也不替学生机安装驱动。需先核对各机显卡、驱动和所选 PyTorch CUDA wheel 的兼容性。

## 保留已有环境

脚本拒绝覆盖已有的非本部署目录、旧 conda、参数不同或未完成的部署。不会激活、卸载或重置已有 Python；安装器关闭 PATH、Python 注册、注册表写入和快捷方式。缓存、临时目录、用户配置和 Hugging Face 缓存放在专用目录，pip 不读取用户 pip 配置或继承额外包源。不会写系统环境变量或软件源。

安装器、依赖下载可能较大，CPU 安装至少需要 20 GiB 可用空间，CUDA 至少 30 GiB，不足时在写入前拒绝。单步最长等待 45 分钟；超时不强杀进程，也不会自动重放。检查专用目录 `logs` 与正在执行的进程后处理；`state=installing` 不算成功，不能直接再次覆盖。已有 `state=verified` 的目录保持原样，不执行自动升级。

## 来源与校验

预检计划包含 `availableGiB`、`requiredGiB`、`spaceReady`；空间不足预检即返回失败，不创建目录，不要求等到 Apply 才发现。

Anaconda 使用[官方归档](https://repo.anaconda.com/archive/)的 `Anaconda3-2025.12-2-Windows-x86_64.exe`，SHA256：
`2e0b8e40ec7600793f116250f5c1775c866833bac32d184ad575ecc0d360a88f`。
[发行说明](https://www.anaconda.com/blog/new-release-anaconda-distribution-2025-12)说明该发行 base 为 Python 3.13.9；[安装器参数](https://conda.github.io/constructor/cli-options/)说明隔离安装选项。组织使用 Anaconda 前应自行核对其适用的仓库与商业使用条款。

其中 constructor 官方 Windows 参数表明确支持 `/NoRegistry=[0|1]` 与 `/NoShortcuts=[0|1]`，本脚本均传 `1`，配合 `/AddToPath=0 /RegisterPython=0`。这是安装器的官方参数约定；仍以隔离实装结果为准，不将参数预检冒充安装成功。

VS Code ZIP 来自[微软官方更新 API](https://update.code.visualstudio.com/api/update/win32-x64-archive/stable/latest)，锁定 1.143.1，SHA256：
`b4f9643b8a549ca2c85a1bbc9063fc76f1e08fc0036a7f6a1a181cdc05235eca`。
解包前核对摘要与路径，解包后验证 `Code.exe` 的有效微软 Authenticode 签名；按[官方便携模式](https://code.visualstudio.com/docs/setup/portable)使用。

两个发行包不通过摘要验证不会执行。Python wheel 来自 [PyTorch 官方源](https://pytorch.org/get-started/locally/)与 PyPI，保持 HTTPS 验证、拒绝源码构建；库版本按安装时兼容的可用版本解析，并非每个 wheel 的离线锁定供应链。成功后 `logs/installed-packages.out.log` 记录准确版本；`logs/verification.out.log` 记录真实解释器、导入与 tensor 检查，`pip check` 必须通过。需要完全相同的离线环境时，应另行生成并审核带每个 wheel 摘要的锁定仓库。

本脚本提供部署入口，不代表任何学生机器已经安装。以每台机器任务结果、版本记录与实际导入检查为准。

