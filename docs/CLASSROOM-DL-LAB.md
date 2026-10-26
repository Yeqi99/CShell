# 下发独立 dl 教学环境

这是独立 PowerShell 任务，不是客户端内置业务。教师使用已有机房管理的脚本下发能力即可，无需重新安装教师包，也不用逐台手动配置学生机器。

1. 在机房扩展选中已配对、明确授权管理的 Windows 学生机器。
2. 在管理中选择现有脚本任务，使用 `scripts/classroom/Install-DL-Lab.ps1` 的全文。默认仅预检。
3. 检查每台机器返回的目录、可用空间、是否需要安装 Anaconda、桌面归属；确认后，在脚本全文外包裹 `& { ...脚本全文... } -Apply` 再下发。

可直接运行文件的等价命令：

```powershell
# 先预检
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-DL-Lab.ps1
# 明确执行；无需先运行其他教学任务
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-DL-Lab.ps1 -Apply
```

`-Root` 默认当前学生用户的 `CShell-DL-Lab`；`-LabRoot` 默认同用户 `CShell-Lab`。如果后者具有已验证教学部署标记、匹配官方 Anaconda 摘要且真实程序存在，复用它创建新环境；不会更新或安装包到已有 base。不从 PATH 或任意注册表记录执行未知 conda。无法确认来源时，在新的 DL 专用目录下载并校验官方 Anaconda 2025.12-2，然后创建 `envs/dl`。该环境叫 **dl**，Python 为 **3.10**，不要求先完成 Python 3.13/PyTorch 教学任务。

锁定顶层包：TensorFlow **2.15.1 CPU**、NumPy **1.26.4**、pandas **2.2.3**、matplotlib **3.9.4**、Jupyter **1.1.1**、JupyterLab **4.3.5**、Notebook **7.3.2**。不使用最新版 TensorFlow，不安装 GPU 驱动。安装后检查 Python 版本、全部包导入、TensorFlow CPU 张量运算、pandas 运算、matplotlib 无界面绘图及 `pip check`，记录完整版本到私有日志。依赖版本由兼容解析器确定，顶层固定不等于完整离线锁定。

成功后，在执行 CAgent 的真实 Windows 用户桌面创建两个快捷方式：

- **dl CMD**：打开 CMD，激活准确的 dl 路径，进入专用 notebooks 目录。
- **dl Jupyter**：用户点击后启动 Jupyter 并打开默认浏览器。只监听 `127.0.0.1`，每次生成随机鉴权 token，保留身份认证；安装期间不会打开浏览器或启动 Jupyter 服务。

桌面路径在任何 HOME 隔离前读取；不能用 SYSTEM 账户冒充学生桌面。已有同名快捷方式、既有非本任务 dl 目录或未完成部署均拒绝覆盖。已经完成且有本任务标记的 dl 保持不变，不自动重装。支持空格、中文路径；包含 CMD 元字符 `% ! & | < > ^` 的路径被拒绝。不要手工把其他环境伪装成本任务标记。

## 动态代理、空间与失败处理

可传 `-Proxy http://地址:端口`；留空按当前 CAgent 的 `HTTPS_PROXY`、`HTTP_PROXY` 环境动态选择。不要写死学生代理，不把教师机 `127.0.0.1` 当成学生可访问地址。代理不可携带凭据或查询参数；下载失败不切换直连。代理只影响本次子进程，不修改系统设置。

复用已知 conda 要求至少 8 GiB 空间，需 bootstrap 则要求 20 GiB。预检即返回 `availableGiB / requiredGiB / spaceReady`，不足非零退出且不创建目标目录。官方下载/依赖安装失败、ToS 或平台兼容问题均明确失败；脚本不自动接受额外条款、不切源、不静默降级版本。日志在 DL 根目录 `logs`；超时不强杀未知进程、不自动重复安装。未完成标记不算成功，应检查原因后选择新的独立目录，而非覆盖已有环境。

## 来源和验证边界

Bootstrap 来自 [Anaconda 官方归档](https://repo.anaconda.com/archive/)的 `Anaconda3-2025.12-2-Windows-x86_64.exe`，SHA256 为 `2e0b8e40ec7600793f116250f5c1775c866833bac32d184ad575ecc0d360a88f`；校验失败不执行。使用 [constructor 官方参数](https://conda.github.io/constructor/cli-options/)关闭注册表、PATH、默认 Python 和快捷方式。Python 3.10 来自显式官方 conda channel，Python 包来自 HTTPS PyPI，禁止源码构建；下载缓存、用户配置均放专用目录。

版本依据：[TensorFlow Windows CPU 安装说明](https://www.tensorflow.org/install/pip)、[TensorFlow 2.15.1](https://pypi.org/project/tensorflow/2.15.1/)、[NumPy 1.26.4](https://pypi.org/project/numpy/1.26.4/)、[pandas 2.2.3](https://pypi.org/project/pandas/2.2.3/)、[matplotlib 3.9.4](https://pypi.org/project/matplotlib/3.9.4/)、[Jupyter 1.1.1](https://pypi.org/project/jupyter/1.1.1/)。

开发验证涵盖脚本解析、只读预检、原目录保护、元字符拒绝，以及临时目录里真实创建/读取含中文空格路径快捷方式，使用模拟 conda 验证 CMD 激活和模拟 Python 捕获 Jupyter 实参。没有向真实学生机器执行安装；本机磁盘不足，未完成整个环境的真实依赖安装。每台学生机必须以该任务实际安装和验证日志为准。
