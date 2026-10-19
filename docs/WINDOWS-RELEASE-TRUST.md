# Windows 发布可信性与检测复核

2026-10-19：ESET 检测尚未确认是误报，不发布或恢复被删文件来绕过检测。实验桌面系统服务保持停止/禁用。

## 构建和签名

当前开发配置允许未签名构建，不代表可信正式发布。正式 CShell Windows 发布使用：

```powershell
pnpm build
pnpm exec electron-builder --config electron-builder.signed.mjs --win nsis --x64 --publish never
```

此配置启用签名且 forceCodeSigning=true，无有效凭据应失败，不回退到未签名发布。证书通过 electron-builder 支持的环境配置或证书库提供；密码、私钥不写入仓库。当前尚无已配置的发布证书，未执行签名构建。

CAgent 的原生宿主、采集程序、服务和安装器也需要独立签名及验签；上述 CShell 配置不会自动签署独立 CAgent 产物。新实验 broker 的授权和资源清理审查问题修复前，不加入发行包。签名不证明软件无漏洞，也不保证杀毒软件放行。

## 本次复核

- ESET 标签：`@Trojan.GenScript.BBBX`。
- 涉及 CShell 主程序、实验桌面采集程序及 LLVM 编译工具；不是只有一个安装器告警。
- 保留的 LLVM 20261006 ucrt-x86_64 ZIP SHA256 与官方附件摘要一致：`317492c456aa27ee607a5919f1d2d38dcdc1112516a24d0bf4b00d078f52d17a`。这是来源证据，不是误报结论。
- 当前安装包 Authenticode 检查为 NotSigned；本机未找到可用代码签名证书。
- 详细本机检测证据放 test-results，不把用户目录、SID、完整杀毒日志或聊天数据提交给第三方。
- 通过 ESET 官方复核渠道提供检测名称、摘要、构建说明和必要样本。对外发送前取得用户明确授权；不得自动上传整份工程、用户配置或内存内容。
- 厂商确认及检测更新后，验证固定版本产物，再恢复安装。不能循环改变二进制以寻找不被检出的版本。

参考：[ESET 样本复核说明](https://support.eset.com/en/kb141-submit-a-virus-website-or-potential-false-positive-sample-to-the-eset-lab)、[electron-builder v26 Windows 配置](https://www.electron.build/v26/docs/win/)。
