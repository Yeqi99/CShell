# 发布自动化后续方案

本文件与 signed-manifest.mjs 是独立、未部署的准备工作，不改变当前 Cloudflare Worker、路由或凭据。当前生产仍使用内嵌已核验清单。

## 已落地的加速

0.8.19 stage 41409186876 于 07:53:38Z–08:09:45Z 完成 30 件源站完整下载、长度与 SHA-256 验证，并上传两份完整 draft。publish 41411833458 在 08:16:34/35Z 公开两版，直接核对两个 draft 的来源、标签、全部附件数量、名称、长度和 GitHub SHA-256；不再重复下载约 2.50 GB。缺件或不一致直接拒绝，不在 publish 中补传。当前发布流程仅保留首次 stage 全量下载，未来 stage 每件打印名称、字节数与验证耗时，日志不含凭据或签名 URL。

## 一次部署、之后只发布清单

建议最终只保留两条固定路由：

- shell.canp.ai/downloads/opensource/*
- shell.canp.ai/downloads/pro/*

固定路由不是允许任意代理。Worker 仍必须只接受 manifest 中精确附件路径，复用当前方法、Range、重定向来源和字节长度校验；其他路径拒绝或按明确站点策略返回，不能由 URL 指定任意上游。

发布器仅在两版正式 public、完整附件摘要与 SHA256SUMS 均核验后签名 manifest。脚本使用 Ed25519，签名载荷包含发行时间和完整 manifest；生产 Worker 固定公钥，校验签名、来源、版本下限、两个渠道及每件精确附件，再启用清单。代码中的 validateManifest/verifyManifest 提供发布端验证和测试，尚不是已上线的 Worker 加载器。

脚本：node services/update-edge/signed-manifest.mjs manifest.json PRIVATE_KEY_FILE signed-manifest.json

私钥不得进入仓库或输出日志。最终部署需要用户拥有的 GitHub Actions secret 或其他既有签名设施、公钥一次部署，以及明确的清单发布位置；目前未创建任何生产密钥、secret 或路由。测试只使用临时内存密钥。

上线前还必须实现并验证 Worker 的 WebCrypto 验签、固定清单来源、大小上限、缓存/回退策略和回滚防护。坏签名、未知路径、跨渠道、缺附件或获取失败不得回退到任意源；可以在明确有效期内继续使用上次验证过的清单。首次迁移保留旧路由，验收通过才移除冗余路由。回滚只撤销当前新版本选择，不移动旧标签或覆盖附件。

## 构建与传输

保留精确 source/tree 与各平台产物来源；纯文档和测试调整不重复构建运行内容不变的平台。官方下载 Artifact ZIP 先核 GitHub digest，解包后再核最终每件 SHA；香港直接拉取官方短时签名 URL 可以替代慢速逐件 SFTP。URL 只进入私有临时文件并清理。Windows 本机构建文件仍按实际收据独立传输，不接受 release 目录模糊匹配。
