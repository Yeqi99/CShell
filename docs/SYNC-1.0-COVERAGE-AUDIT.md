# 1.0 同步覆盖审计（2026-11-04）

## 已核对的真实路径

- 桌面与 CAgent 共用 `CloudSync`：三向合并按稳定 ID 保留并发新增、排序和身份；权限并发冲突拒绝自动合并扩权。
- CAgent 的 `cloud.ts` 缓存完整 bundle，根节点 passthrough，store/devices/http/assets 原样保留；导出只替换本机实际消费的 AI 与已核验能力包选择。
- Android 的 `CloudSync.java` 以完整 JSONObject 保存 bundle；上传时在副本内合并 profile、更新 theme，保留没有消费的扩展、权限和附加字段。仅字段保留不等于对应功能已在 Android 生效。
- Android `publicData` 通过 CloudPortableSettings 安全投影 UI 字体、终端字体/字号/行高和插件启用选择。字体实际应用到现有及新终端；插件选择在扩展页按需展开显示。Android 没有桌面插件运行时，因此保留选择但不冒充执行插件，也不据此开启手机远程服务。账号切换缓存携带这些字段，空账号恢复默认。

## 本轮修复与验证

- 增加 `X-CShell-Vault-Max-Bytes` 能力声明。桌面、CAgent 与 Android 按本机内存预算声明安全容量（最多 256 MiB），并协商分块协议；未声明的旧端按 64 MiB 处理。
- 服务端读取密文前先检查 byte_size。超出客户端容量时返回明确提示并保留云数据，避免先加载超大密文后客户端才失败。
- `test_vault_capacity.py` 验证旧端拒绝、非法声明、容量边界以及失败后数据保留。
- 23 项现有回归通过：CAgent 访客/账号隔离、外观并发写、导入期间新增连接与分组不丢失、回滚冲突、三向排序、权限精确还原。

- 新增真实 JVM org.json roundtrip 通过：偏好/扩展安全投影、秘密排除、原对象不变、未知字段及空分组保留、空账号重置。测试为 CloudPortableSettingsTest。
- Android Java 编译通过；build-android.mjs、mobile-smoke.ts 通过；新增 mobile-sync-ui-smoke.ts 用真实移动 DOM 验证云字体与插件选择落地、损坏缓存恢复、远程服务未被隐式开启。

## 未完成门槛

- 已实现 1 MiB 密文块上传/下载、摘要核验、断点恢复、CAS 原子提交与版本/容量协商；65 MiB 实际加密数据经真实 HTTP 往返及完整 CloudSync 恢复通过。不是独立分块加密：现有端到端 AES envelope 格式保留，客户端最终解密仍需要完整数据，容量按内存预算限制。Android JVM 已验收断点恢复，手机 256 MiB 实机能力不作保证。细节见 VAULT-CHUNK-TRANSPORT-1.0.md。
- 桌面侧边栏尺寸/布局、外部插件可执行包、桌面快捷键不适用于手机，保留于加密 bundle，不映射成手机已启用能力。真实设备跨端往返验收仍需补齐（当前未连接 USB 设备）。
- 本轮没有操作或重写本机真实账号配置，没有发布。

## 生产数据库迁移演练

2026-11-04 在香港服务器受限临时目录内，通过 SQLite online backup 只读复制现有生产库。候选代码仅运行于副本与随机 loopback 端口；未重启或替换生产服务。9 个现有关键表逐列摘要一致（账号、密码摘要、密钥箱、会员、会话、密文、版本、设备、旧 MCP bridge）；迁移后 integrity_check=ok，共 38 表。健康、旧 bridge 列表与域名鉴权路由通过。没有输出个人信息、令牌或密文。部署脚本 scripts/deploy-cloud-sync-1.0.sh 默认仅演练，需显式 --apply 才停服备份并切换；分块数据一旦提交不可回退不识别分块的旧 server。
