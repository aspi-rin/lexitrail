# 安装身份与旧词本升级

0.0.4 标准包使用固定扩展 ID `pabcjgpefkpmodichjomkgiflicagkec`。后续各版本保持这个公开身份 key；更新同一固定目录并重新加载，会沿用标准包的词本。ZIP 内目录固定为 `lexitrail/`，外层 ZIP 文件名包含版本号。

旧版 0.0.3 及本地 0.1.0/0.2.0 预览使用按路径生成的 ID，旧词本存储属于原来的安装。一次迁移按以下步骤完成：

1. 保留词本最完整的旧扩展。在其“详细信息”中找到加载路径。
2. 解压 **lexitrail-0.0.4-migration.zip**，将 `lexitrail-migration/` 内文件覆盖到上述旧路径，确保 `manifest.json` 仍在原位置。迁移包沿用旧版无 key 的身份方式，Google 登录处于待配置状态。
3. 在旧扩展卡片点击“重新加载”；打开设置 → 词本备份与迁移 → **导出词本备份**，保存 JSON 文件。
4. 解压标准 **lexitrail-0.0.4.zip**，把 `lexitrail/` 放在以后固定使用的目录，加载此目录。标准版应显示上面的固定 ID。
5. 在标准版设置中 **导入词本备份**。导入将合并现有词本，保留学习状态、AI 材料、原文语境和阅读开关。检查三个词本与例句后，可停用旧扩展；保留 JSON 备份。
6. 在标准版重新填写 DeepSeek Key；Google 应用登记完成后，点击 **使用 Google 登录**。

备份排除 DeepSeek Key、Google 凭据和设备连接配置。备份包含您收藏的原文语境，请作为个人文件妥善保管。最多支持 8 MB 的单份备份；无效文件会拒绝导入并保留现有词本。

后续更新：把新版 `lexitrail/` 内的文件覆盖到标准版原目录，点击同一扩展卡片的“重新加载”，再刷新阅读网页。[Chrome 官方更新说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload-the-extension)
