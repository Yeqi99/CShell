# 0.8.18 候选构建记录

## 当前有效记录 · 原生重连与 Android 最终实机验收

0.8.18 尚未公开发布。当前附件唯一依据为 f566ea0 的 [最终30件库存](release-evidence/final-0.8.18-inventory.json)：24个不受后续修复影响的桌面/POSIX包、两版新CAgent Windows包、两版新Android APK及两份重新生成的校验文件。历史摘要不得用于取包。

- **Windows与POSIX**：两CShell安装器及22个POSIX附件继续采用已核验的最终SSL目录构建；Core 41300796296、Pro 41300827199 全部原生作业通过。两CAgent Windows安装器已按7759a91替换并实际安装验证安全重连、写操作不重放、共享后台与身份保留；Core无Pro账号UI。见 [Windows收据](release-evidence/final-windows-candidates.json) 和 [POSIX收据](release-evidence/runtime-final-artifacts.json)。Windows未签名、macOS未签名/未公证，CI不代替实体设备实测。
- **POSIX**：Core `41300796296` 四作业、Pro `41300827199` 八作业全部成功。12个GitHub归档摘要、22个附件SHA-256核验完成，八个CAgent归档内的最终目录和渠道实现已检查，见 [最终运行时收据](release-evidence/runtime-final-artifacts.json)。Core生产源码 `3202d56`，Pro生产源码 `c53e8f1`；其后纯文档/收据修改不要求重复构建。macOS未签名/未公证，原生CI不替代实体设备验收。
- **Android**：Core 41310002331、Pro 41309477156 的API29/35全部通过，含网页输入、连续删除、未聚焦拒绝写入、重放拒绝/释放/重连。Pro最终7f9f866 APK已在Android16手机实际验收：H264画面、点击、文字、八次退格后实际空值、返回共享设置、同身份重新连接均成功，密码保持隐藏且无需再次录屏授权。八次安全退格耗时3.37秒。见 [实机收据](release-evidence/android-0.8.18-real-input-final.json)；Core APK未单独物理安装，短信/电话未做运营商收发测试。
- **微信**：真实手机B消息被原生监听捕获；诊断投递同事件完成一个任务；最终冻结包自动重投该事件返回204且无重复任务/模型调用；另有独立合成新事件的自动单任务验收。首次真实消息自动端到端成功尚不是本轮证据，4.2原生钩子也未实机。详见 [分段证据](release-evidence/wechat-final-native-lifecycle.json)。
- **联想会员中继**：会员已幂等开通，实际联想设备仍signed-out，待登录后强制中继测试；不以局域网直连或其它隔离机器代替。

- **发布门禁**：香港30项完整摘要/大小/权限已由7630135核验，官网26项摘要及响应式检查通过。正式源码和控制清单已固定；联想已恢复真实登录表单，仍待用户登录后完成该机器强制中继验收。完成后再统一发布代码、附件、官网/admin、更新渠道及本机升级；当前尚未公开或切换。

## 历史构建记录

下文保留旧候选及失败过程，不代表当前附件状态。

## Windows Pro

- `release/pro-0.8.18/CShell-Pro-0.8.18-win-x64.exe` 已成功生成，包括 blockmap。
- SHA-256：`e059e40ae8ac52b24fcf7d75eabd5da2e4f4a550571b4bde59a64d6bc7cb83c6`。
- 安装器和应用没有 Authenticode 签名，不声称已签名。
- 使用该构建的实际 `win-unpacked/CShell Pro.exe`，隔离配置运行 `platform-package-smoke.ts` 通过。此前最新源码的完整真实桌面交互验收另见主清单。
- 本机首次安装器构建因直连GitHub超时失败；使用现有本机代理重新执行打包成功，没有修改系统代理。

## CAgent 与 Android

- 0.8.18 CAgent独立运行包构建通过，真实CMD PTY/TLS/权限限制/停止通过。
- CAgent候选EXE已在独立目录静默安装，逐个核验48个payload文件摘要，再运行安装后的真实终端/TLS验收通过。未替换实际安装、快捷方式或开机启动项。EXE SHA-256：`e6d0626f390bbcc9ebb94e00286d6c7874791e43ea9dc11ec9495caf05d69dfb`，未签名；收据 `test-results/pro-cagent-0.8.18-installer.json`。
- 对此候选原生窗口执行实际API验收，模型选择、自动化规则管理、主题应用、权限与身份保持通过；使用临时配置，没有调用真实模型或微信。
- Android Pro debug和androidTest包、lint完成（71项Gradle任务，构建成功）；debug不是正式签名包。手机系统仍拒绝USB安装，不能据此宣称安卓实机验收通过。

## 发布前仍须完成

以 [最终验收矩阵](UNIFIED-FINAL-AUDIT-20261101.md) 为准，继续实际微信事件、新设备云恢复与CAgent出口、双机Windows剪贴板、Android系统授权后的验收。候选源码与跨平台构建只生成核验附件，不自动发布。

完成验收后再发布递增标签、核验附件/香港下载源/更新通道、更新官网文档，并保留数据升级和打开本机对应应用。

## Android 正式签名候选核验

GitHub候选工作流41281283583成功，使用既有release密钥，没有创建新签名身份。下载的artifact压缩包SHA-256为2f601caf2ce0c6a3d47392e2b9f682eb11783a328e58420e3ab9792d9caf2e58，与GitHub记录一致；APK摘要4f7efbd66da73bad7af7d4c80d41a919435a59de4e7fb8a665291e1d30fce552，与附件清单一致。apksigner验证通过，证书SHA-256为34cc1c9a0eacafc512a0837c3d286081879822f047e5637a65cdbc5b525914c5。

用户确认开启USB安装后，向已授权Android16手机重试此签名APK，仍立即返回INSTALL_FAILED_USER_RESTRICTED: Install canceled by user。系统没有显示安装页，手机上没有CShell包；不能标记实机验收通过。没有修改手机安全设置或绕过系统确认。

## 收口重建 · 本机 Windows

后续真实RDP多标签隔离、CAgent网页偏好/自动化、原生验收入口隔离及远控状态提示已纳入重新构建。此前本文首轮摘要仅保留为历史，不作为最新发布附件。

- Pro NSIS最新SHA-256：fd5d6ec9c2f7808fe227c90f0cb0373c57a976f775206e05e701c20d70d18b78。实际win-unpacked应用完成platform-package-smoke与release-desktop-smoke，真实SSH/文件/布局/字体草稿/权限MCP等通过。
- CAgent NSIS最新SHA-256：6732ee491149e85849969e2a1175aee4b8279570af83cbcf0e97a27891bacef9，26,227,803字节。安装到隔离目录后真实CMD/TLS/授权/退出通过；原生模型/自动化/主题及身份跨重启验证通过。签名状态仍为未签名。
- 手机已改用系统文件管理器正常安装上述正式签名Android候选并启动；USB安装限制未绕过。实际视频已成功，键鼠和系统授权验收继续，详见Android记录。
- 本机实际用户应用仍未被候选替换，正式渠道未切换。

### 最新 Windows Pro 候选

包含非Windows代理清理、临时连接重连与独立小窗DPI修复的正确Pro配置安装器已重建：release/pro-0.8.18/CShell-Pro-0.8.18-win-x64.exe，SHA-256 `69188fad9fbe886dcfa8b55c6434a2a17de0ae222091a606167b005bb011c88b`。platform-package-smoke及release-desktop-smoke针对该目录的真实CShell Pro.exe全部通过。尚未签名、安装到用户目录或发布。

本轮曾误以默认builder配置产生Pro工作树release/0.8.18/CShell-0.8.18-win-x64.exe；它明确排除于所有发行清单，不属于有效开源或Pro附件，未安装或上传。开源只采用Core工作树构建；Pro仅采用显式electron-builder.pro.cjs产物。CAgent按独立已核验清单取包，不使用release目录全量glob上传。
# Schema 3 与统一身份代理候选复验

下列 Windows 包已替换本地旧候选，仍未发布或安装到用户的正式应用。

| 包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `release/pro-0.8.18/CShell-Pro-0.8.18-win-x64.exe` | 123907565 | `9f8dcf1bdcafe720b1e6cd8f60e97f2bab2911156645d9531e1fb1f13be19049` |
| `release/0.8.18/CAgent-Setup-0.8.18-win-x64.exe` | 26235261 | `c8051b778fe1e54fa4f24dc3ac941122d3194e79b1735038986c1376dfc3323c` |

Pro 构建基于 `885e7d7`，CAgent 构建时 HEAD 为 `0b05da1`（其后者仅新增 Android 输入线程修复）。CAgent `agent.cjs` 摘要为 `be968dfc0befccbe6470d1a73c77c68b9d511824cc52a12a7defec9a078ecb52`。两包未做 Authenticode 签名。

实际 Pro 打包程序通过 `platform-package-smoke` 与 `release-desktop-smoke`；CAgent 安装器的原始 payload 通过真实 CMD PTY、TLS、权限限制和停止测试，原生窗口的模型、自动化、外观及身份重启隔离通过。日志：`test-results/pro-schema3-*.log`、`test-results/cagent-schema3-*.log`。首次 CAgent 构建下载 Node 许可证超时，配置构建代理后重建成功，没有跳过许可证核验。

全量 Pro 回归初次为 792 项、787 通过、4 跳过、1 失败；唯一失败为新代理 RPC 未声明 API 暴露分类，`885e7d7` 已将其明确归入专用控制通道，目标 2 项回归通过。没有将初次全量结果改写为零失败；最终 CI 仍须使用整合后的源码执行。Android 输入与微信真实事件验收仍独立追踪，不能由这些 Windows 包测试替代。


## 原子授权提交后的最终 Windows Pro 候选

源码 `4403eb6`（含 `d262af3`）构建的 Pro 安装器为 123907587 字节，SHA-256 `8d02383b21255406766355d180be6d23974d495c290532a8bfe1f0b3ce2c7b54`。此摘要取代上文旧候选作为当前核验对象，尚未发布或安装到用户正式目录，Authenticode 仍未签名。

全量回归 794 项：790 通过、4 跳过、0 失败。实际包内程序再次通过 platform-package-smoke 与 release-desktop-smoke，覆盖 SSH/SFTP、同一 PTY 的可视化切换与历史、设置草稿和即时预览、分组持久化、重启及真实 MCP 握手。日志为 `test-results/final-atomic-regression.log` 与 `test-results/pro-final-atomic-{build,nsis,package-smoke,desktop-smoke}.log`。

身份代理授权在加密与临时文件准备完成后再次核验，与原子重命名同步提交；撤权发生在准备期间时，磁盘和内存均不出现新规则。该结果不替代尚未完成的 Android 触控和微信真实事件验收。

## 终端焦点修复后的候选

`ca92ec4` 修复切换终端后延迟 RAF 抢走搜索框焦点，并取消失效页面的激活任务。真实 Edge 时序复现中旧逻辑稳定失败，新逻辑通过；新增真实浏览器 RAF 验证，避免仅手动调度器覆盖不足。首次抽取 helper 的 `88004b3` 因浏览器方法接收者丢失导致实际生命周期测试失败，已由 `ca92ec4` 修正，失败产物没有进入打包或发布。

最新 Pro 安装器：123907652 字节，SHA-256 `81dafe0c9ef8f100e962ab5bafb15bf655439d9abab80f9f9a9984c1904659ec`。真实 connection-lifecycle 验证临时重连、原历史搜索、主题和无重放通过；包内 platform-package-smoke 与 release-desktop-smoke 再次通过。日志 `test-results/pro-focus-native-*.log`。此包取代上文 Windows Pro 候选，CAgent 源码未受影响，不重复重建。完整跨平台最终矩阵仍在运行，手机输入和微信事件仍待实机关闭缺口。
