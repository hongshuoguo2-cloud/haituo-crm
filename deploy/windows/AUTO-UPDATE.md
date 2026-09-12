# 海拓云服务器自动更新

稳定版本发布到 GitHub Release 后，Windows 云服务器会自动检查、下载并安装更新，无需重复上传和解压文件。

## 发布流程

1. 在分支完成修改和测试，合并到准备发布的分支。
2. 创建语义版本标签，例如 `v0.1.1`，然后推送该标签。
3. GitHub Actions 自动安装依赖、构建所有模块、验证更新包并创建 Release。
4. 云服务器每 15 分钟读取最新稳定 Release；预发布版本和草稿不会自动安装。

## 云服务器首次启用

先安装一份包含自动更新脚本的海拓更新包，然后在管理员 PowerShell 中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Haituo\deploy\windows\install-haituo-auto-update.ps1" -Repository "GitHub用户名/仓库名"
```

此操作只需要执行一次。计划任务名为 `HaituoAutoUpdate`，默认每 15 分钟运行，也会在服务器启动时运行。第一次仍需把“自动更新初始化包”上传到当前服务器；之后发布稳定版本便不再手动上传。

## 重置平台管理员密码

如果首次部署生成的随机密码无法通过远程桌面剪贴板取回，在管理员 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Haituo\deploy\windows\reset-haituo-admin-password.ps1"
```

命令会隐藏输入并要求重复确认新密码，只更新 `INITIAL_ADMIN_EMAIL` 对应的有效平台管理员，然后重启 `HaituoWeb` 并进行健康检查。密码不会作为命令行参数或日志内容保存。

## 安全与恢复

- 只读取 GitHub 的最新稳定 Release。
- 下载 ZIP 和独立 SHA-256 文件并核对；ZIP 内部再逐文件核对 manifest。
- 更新前使用 `mysqldump` 备份数据库，并备份所有将被替换的文件。
- 依赖锁文件变化时，旧 `node_modules` 会先移入备份目录，安装失败时恢复。
- 新版本启动后必须通过 `http://127.0.0.1:4188/api/health`；失败就恢复旧文件、旧依赖和旧启动任务。
- `.env`、数据库、客户资料和 Caddy 配置不包含在更新包内，也不会被覆盖。

备份位于 `C:\HaituoData\update-backups`，自动更新日志位于 `C:\HaituoData\updater\logs`。
