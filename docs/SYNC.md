# 手动同步

设置页可选择 WebDAV 或 Google Drive；两者使用相同的词本合并规则，只在点击“立即同步”时执行。切换方式会保留已有本地词本，各种连接与上次同步记录独立保存在本机。

## WebDAV 操作

1. 在提供商账户开启应用连接，取得 HTTPS WebDAV 文件夹地址、连接账号和应用密码。InfiniCLOUD 对应 WebDAV Connection URL、Connection ID 和 Apps Password。[提供商说明](https://infini-cloud.net/en/support_account_login-settings_apps.html)
2. 在设置页选择 **WebDAV**，填写三个字段，点击 **保存并验证连接**。浏览器只为该地址申请可选主机权限；服务器需支持 Basic 认证与 PROPFIND、MKCOL、GET、PUT。填写有效信息并允许地址访问后，先保存本机连接，再读取服务器文件夹属性验证。验证失败也保留连接，并显示具体原因，刷新后可修改应用密码或点击同步重试。[Chrome 可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions#method-request)、[WebDAV 标准](https://www.rfc-editor.org/rfc/rfc4918.html)
3. 点击 **立即同步**。首次同步创建指定目录的 `LexiTrail/` 子文件夹；每台设备保存自己的 `lexitrail-device-<id>.json`。其他设备填写同一地址与账号并分别同步，A→B→A 可以让两台设备获取最新合并结果。
4. 密码保存后输入框清空，留空保存可沿用同一地址与账号的原密码。修改地址或账号时需要填写密码。**清除本机连接** 删除保存的地址、账号与密码，云端文件继续保留。

WebDAV 支持 Chrome / Edge 140+，账号应具备该目录的读写与创建文件夹权限。请求使用 HTTPS、30 秒超时，拒绝重定向，避免密码随跳转发送；请填写提供商给出的最终地址。文件清单只处理指定同步目录内的设备 JSON，限制为最多 1,000 台设备，单个文件最多 8 MB。401 表示服务器拒绝账号或应用密码；403 表示权限不足；其他失败请检查路径、网络和剩余空间。

WebDAV 地址、账号、密码属于本机受限的扩展存储；设置页只获取地址、账号和配置状态，已保存密码由后台使用。网页脚本的请求、云端快照与词本备份均无法取得连接凭据。主题偏好同样保留在本机。云端词本为 JSON，包含收藏原文语境，应按个人学习资料管理。

## Google Drive 同步

LexiTrail 使用 Google Drive 应用数据区保存每台设备的 JSON 快照；插件直接调用 Drive API。本地词本使用 `storage.local`，Google 登录采用 Chrome 原生 `identity.getAuthToken`，访问令牌由 Chrome 缓存并处理到期。扩展仅在您点击登录时显示授权界面；点击同步时使用已有授权。[Chrome 官方说明](https://developer.chrome.com/docs/extensions/reference/api/identity#getAuthToken)

应用数据权限为 `https://www.googleapis.com/auth/drive.appdata`，Google Drive 普通文件列表会隐藏快照。[Google 官方说明](https://developers.google.com/workspace/drive/api/guides/appdata)

## 用户操作

当前标准安装包已完成应用登记，设置页只需点击 **使用 Google 登录**，授权应用数据权限，再点击 **立即同步**。第二台电脑安装同一包、使用同一 Google 账号登录，再同步即可。设置页显示连接情况、上次同步时间和待同步变化。

Google 登录当前面向 Chrome；阅读与本地词本功能支持 Chrome / Edge 140+。登录使用当前 Chrome 资料中的 Google 账号。需要换账号时，使用相应 Chrome 资料。断开连接清除本机缓存令牌和连接状态；云端快照继续保留，账号授权可从 Google 账号的第三方应用管理中撤销。

## 开发者一次登记

2026-10-04 已完成独立项目 **LexiTrail**（项目 ID `mercurial-song-510623-e1`）的一次登记。Google Drive API 已启用，数据访问仅配置 `drive.appdata`；应用为 External / Testing，已加入项目所有者当前 Google 账号作为唯一测试用户。公开 Chrome Client ID 已写入 manifest：`323945631645-0nto05j21h67bqfh3e6jsl1rng6mhuj7.apps.googleusercontent.com`。

Google 提示配置生效可能需要 5 分钟到几小时；刚构建后出现客户端错误可稍后重试。测试模式下其他账号需由项目所有者加入测试用户列表。以下步骤供后续维护或重新登记使用：

1. 打开 [LexiTrail Google Auth Platform](https://console.cloud.google.com/auth/overview?project=mercurial-song-510623-e1)。应用名称填 LexiTrail，用户支持和联系邮箱使用项目所有者邮箱；受众选择 External / 外部，个人开发保持 Testing / 测试。
2. 阅读并确认 **Google API 服务：用户数据政策**，完成应用登记。
3. 在项目 API 库启用 **Google Drive API**；Google Auth Platform → 数据访问，添加 `https://www.googleapis.com/auth/drive.appdata`。目标对象 → 测试用户，加入自己用于同步的 Google 账号。
4. Google Auth Platform → 客户端 → 创建客户端，类型选择 **Chrome Extension / Chrome 扩展程序**，名称 LexiTrail Chrome。Item ID 填 **`pabcjgpefkpmodichjomkgiflicagkec`**；该值由当前 manifest 中的公开扩展身份 key 导出，各电脑保持一致。[Chrome 官方登记指南](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth#create-an-oauth-client-id)
5. 复制 **Client ID**，在项目目录运行：

```sh
node scripts/configure-google.js YOUR_CLIENT_ID.apps.googleusercontent.com
npm run check
npm test
npm run build
```

该命令把公开 Client ID 写入 `extension/manifest.json` 的 `oauth2.client_id`，scope 固定为应用数据权限。用户使用构建后的包即可登录。

## 配置与安全

Client ID 和 manifest `key` 均为公开应用标识，可以随源码与安装包分发。授权令牌由 Chrome 管理，取得后仅用于向 Google 的 HTTPS API 发送 Bearer 请求。DeepSeek Key 保存在本机受限的 `storage.local`，设置页可访问；Google 令牌与 Key 均从词本同步和本地备份中排除。此实现使用 Chrome 原生 OAuth 流程，旧版 `launchWebAuthFlow` 的 token response 和扩展 `driveAuth` 会话存储已移除。

固定身份 key 用于本地开发安装；此版本未上传 Chrome 商店。日后商店分发需要核对商店所分配的扩展身份及 OAuth 客户端。旧版按目录生成的身份升级到固定身份时，按 [UPGRADE.md](UPGRADE.md) 导出并恢复词本。

## 同步规则

同步三个个人词本的状态、中文义、保存的 AI 定义和双语例句、原文语境、阅读标注开关和初始等级记录。DeepSeek Key、WebDAV/Google 凭据、临时查询缓存及设备连接配置保留在各设备本地。

每个安装实例拥有独立设备 ID 和一个 `lexitrail-device-<id>.json` 文件。同步读取各设备快照，合并后保存本设备的文件；各设备分别点击同步，获取与上传最新变化。

- 学习状态按显式标记时间合并；初始 CEFR 导入采用基线时间，新设备初始化会保留已有学习进度。
- 原文语境按文本去重，保留最近十条；已保存 AI 材料优先保留首次有效查询。
- 阅读开关使用独立更新时间；各设备时间须正常。同一时间的状态冲突按生词→学习中→已掌握顺序取后者。
- 同步期间的新标记保留在本地，完成后显示“有本地变更待同步”，再次同步即可上传；网络失败保留本地词本并可重试。

单次快照最多 8 MB、50,000 词，文件损坏或超限会提示。首版采用手动同步；自动后台同步、单词删除和更细的冲突历史留待后续定义。

## 验证边界

0.0.6 的 WebDAV 连接/独立快照读写、两客户端合并、地址权限、凭据清除、异常 XML/JSON 和并发本地编辑通过模拟服务测试。提供商真实连接本轮由生产模块与独立 HTTP 客户端各尝试一次，均返回 401；临时凭据已清理，服务器未创建测试目录，真实往返需有效应用凭据后补验。设置页两种配色与模拟 WebDAV 保存/同步已在 Chrome 本地测试页验证。0.0.6 增加认证失败后仍保存、刷新恢复与按钮旁反馈的完整页面回归测试；保存仅表示本机配置持久化，服务器验证结果和真实同步成功分别显示。

原生 OAuth 响应、授权过期、Drive 分页/读写、数据合并与并发本地编辑已使用模拟服务测试。真实 Client ID 和 Cloud 配置已登记并在控制台核对；实际 Google 登录和双设备云端往返需在加载后的扩展中验收。开发夹具标注模拟服务，真实账号尚无本轮词本上传。
