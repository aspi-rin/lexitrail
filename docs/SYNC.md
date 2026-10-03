# Google Drive 同步

本版使用 Google Drive 的应用数据区保存每台设备的 JSON 快照。插件直接调用 Drive API；服务端维护工作集中在 Google 的账号授权和存储中。应用数据区使用 `drive.appdata` 权限，文件由本应用访问，Google Drive 普通文件列表会隐藏它们。[Google 官方说明](https://developers.google.com/workspace/drive/api/guides/appdata)

## 方案选择

| 方案 | 对当前词本的适合程度 |
| --- | --- |
| Google Drive 应用数据区 | 已采用。存储词本和例句快照，插件直接访问，一次设置 OAuth 客户端 |
| Chrome storage.sync | 适合少量配置，总量约 100 KB，单项约 8 KB；当前词库及 AI 材料需要更大的空间 |
| 独立数据库与后端 | 更适合账号体系、共享和高频实时同步；需要维护 API、鉴权、数据模型与服务部署 |

Chrome 容量限制来自 [官方 storage API 文档](https://developer.chrome.com/docs/extensions/reference/api/storage)。本地使用 `storage.local` 与 `unlimitedStorage` 权限，Google 令牌使用受限的 `storage.session`，后台暂停可恢复，浏览器重启后需重新连接。

## 首次设置

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，选择您的个人项目，或创建用于 LexiTrail 的项目；启用 **Google Drive API**。
2. 在 Google Auth Platform 配置应用名及受众。个人测试使用 External + Testing，并把自己的 Google 账号加入测试用户。权限添加 `https://www.googleapis.com/auth/drive.appdata`。
3. 创建类型为 **Web application** 的 OAuth 客户端。保存 **Client ID**；本插件只使用公开客户端 ID。
4. 打开插件设置 → Google Drive 同步 → 首次连接设置。复制“此设备回调地址”，在该 OAuth 客户端的 **Authorized redirect URIs** 中加入这个完整地址，含末尾路径。回调地址由 [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity) 根据实际扩展 ID 生成。
5. 把 Client ID 填入插件，点击“连接 Google Drive”，在 Google 页面选择账号并授权应用数据权限。
6. 点击“立即同步”。第二台设备使用同一个 Client ID，把第二台的回调地址也加入同一客户端；连接同一个 Google 账号后点击同步。

升级当前已加载的插件时继续使用原目录，保留现有扩展身份和词本。各电脑的解压目录与扩展 ID 可能不同，允许列表须包含各设备显示的回调地址。

授权采用 Google 文档中的 token response，通过 Chrome `launchWebAuthFlow` 接收结果；实现校验回调来源、路径、随机 state、权限和过期时间。[Google OAuth 说明](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)

## 同步内容和规则

同步三个个人词本的状态、中文义、保存的 AI 定义和双语例句、原文语境，以及阅读标注开关和初始等级记录。DeepSeek Key、Google 凭据、临时查询缓存及设备连接配置保留在各设备本地。

每个安装实例拥有独立设备 ID 和一个 `lexitrail-device-<id>.json` 文件；同步读取各设备快照，合并后保存本设备的文件。某台设备的旧快照可由另一台读取，用户在另一台完成新变化后，原设备再同步即可获取这些变化。

- 学习状态按显式标记时间合并；初始 CEFR 导入使用基线时间，另一台新设备导入词库会保留已有的学习中/已掌握状态。
- 原文语境按文本去重，保留最近十条；已保存 AI 材料优先保留首次有效查询，状态变化继续保留材料。
- 阅读开关使用独立更新时间；各设备时间须正常。同一时间的状态冲突按生词→学习中→已掌握顺序取后者。
- 同步期间的新标记会保留在本地，完成后显示“有本地变更待同步”，再次同步即可上传；网络失败保留本地词本，可重试。

首版采用用户点击“立即同步”的方式，状态区显示连接情况、上次同步时间和待同步变化。令牌通常一小时到期，届时点击重新连接。断开连接清除本机令牌；云端快照继续保留，Google 账号的应用授权可在账号权限管理中撤销。

单次快照最多 8 MB，词条数最多 50,000；超限或损坏文件会给出提示。此版按词保存完整 JSON 快照，适合个人词本；自动后台同步、单词删除和更细的冲突历史留待后续版本定义。

## 验证边界

OAuth 响应、Drive 文件分页/读写、数据合并、授权错误和并发本地编辑已使用模拟服务测试。实际 Google 授权和两台设备的云端往返需要完成上述客户端登记，并在已加载的扩展中验收。开发夹具使用模拟 Google Drive，不会写入真实账号。
