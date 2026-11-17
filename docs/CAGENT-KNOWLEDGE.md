# 机器知识库

在 CAgent 应用市场安装“机器知识库”，在详情勾选并保存读写权限。库文件位于 cagent 数据目录下的 knowledge/records.sqlite。library 是库名，key 是分类。读取授权适用于机器上的全部库。应用详情可新增文本或检索记录。智能体使用 knowledge_put、knowledge_get、knowledge_search。procedure 正文为含 steps 字符串数组和 outcome 字符串的 JSON，可另外记录适用条件及验证证据。相同输入产生相同 ID，重复提交可以重试同步。

## 可选服务

配置启动 CAgent 的进程环境后重新启动。配置适用于后续写入，历史记录可重新提交。

- CAGENT_ALIST_DAV 填写百度网盘挂载下已有可写目录的完整 AList WebDAV URL。CAGENT_ALIST_AUTH 填写 用户名:密码。每条记录以独立 JSON 上传。
- CAGENT_EMBED_URL 填写兼容 embeddings 的完整 API 地址，CAGENT_EMBED_MODEL 指定模型，CAGENT_EMBED_TOKEN 可选。
- CAGENT_MILVUS_URL 填写 Milvus REST 服务地址，CAGENT_MILVUS_COLLECTION 指定专用集合，CAGENT_MILVUS_TOKEN 用于认证。预先建立 id（VARCHAR 主键，长度 64，关闭 autoID）、scope（VARCHAR，长度 64）、vector（FLOAT_VECTOR，与模型维度一致）字段，为 vector 建索引并加载集合。写入时生成向量，knowledge_similar 在相同库和分类内检索。切换模型时使用新集合并重新提交记录。
- 写入响应分别报告本机保存、向量索引和备份结果。外部服务失败时原文仍可查询。上传成功表示 WebDAV 端点接受文件。

## 1.1.2 收口回归

机器知识库属于当前 cagent 的磁盘数据。应用市场安装后，读取和写入分别授权。智能体检索与任务相关的记录，核对当前环境，并在验证成功后保存解决步骤与结果。密码和密钥不可写入经验记录。

自动回归使用真实 SQLite 和智能体工具调度，验证写入解决经验、关闭实例、新实例检索和读取完整步骤。模型回复由测试驱动。Milvus、嵌入服务与 WebDAV 的线上联调仍需要实际服务配置。

远程智能体的模型选择器列出当前账号同步的基座，官方模型使用该账号的会员额度。在模型与权限中点击“同步当前 CShell 账号”，通过已核验身份的连接将独立登录凭据交给目标 cagent。目标已有其他账号时需先在目标机器退出。基座凭据通过加密云同步恢复。账号同步不会将机器知识库文件上传为账号偏好。
