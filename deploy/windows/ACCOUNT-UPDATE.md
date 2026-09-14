# 海拓：手机号自主注册与 API 余额入口

新使用者直接在登录页点击「首次注册」，填写称呼、本人手机号和自己设置的密码。系统自动创建只属于该手机号的个人工作区并立即登录，无需平台人员建公司、管理员开户、发卡或转发初始密码。再次使用时直接输入手机号和密码。原有公司账号和平台维护账号继续兼容。

API 余额入口位于「系统配置 → API 余额」。目前明确显示计费服务尚未接入，没有模拟余额、充值或扣费。自主注册使用手机号加密码，不依赖短信服务。继承的管理员操作保持原有权限校验。

安全行为：手机号全局唯一，数据库仅保存 scrypt 密码哈希。每次自主注册都会在事务中同时建立独立租户、个人使用者角色、成员身份和组织根节点，任一步失败即整体回滚。接口按来源地址限流；注册成功后建立正常登录会话。不同注册者的业务数据通过独立 tenant_id 隔离。

## 云服务器更新

此更新用于已完成部署的 C:\Haituo，需已安装 Node.js、npm 依赖、MySQL，且现有配置使用 PORT=4188。

1. 将更新 ZIP 上传到服务器并解压。
2. 在管理员 PowerShell 中运行解压目录的 install-account-update.ps1（可用 `powershell -NoProfile -ExecutionPolicy Bypass -File "完整路径\install-account-update.ps1"`）。
3. 成功后使用 https://demo.linqiagent.cn 并按 Ctrl+F5 刷新。

安装脚本校验文件清单与 SHA-256，先备份将要替换的文件至 C:\HaituoData\update-backups，只停止确认属于海拓的 4188 端口进程，然后复制编译结果。保留 .env、现有数据库与 Caddy 配置。新增的 must_change_password 列由应用启动时自动迁移，旧账号默认为 false。

更新后使用 Windows 计划任务 HaituoWeb 在系统启动时运行，并在异常退出后尝试重启。服务输出位于 C:\HaituoData\logs。首次更新会结束原先手动启动海拓的进程，以后不必保持那个 PowerShell 窗口打开。

若启动检查失败，脚本恢复被替换的旧文件；额外新增的数据库列保留，兼容旧代码。首次安装计划任务失败时可能需要手动重新启动旧服务，请查看错误和日志。安装脚本已做语法校验，实际任务注册和云端验证须在目标 Windows 服务器完成。

## 本地验证

运行 `scripts/test-haituo-accounts.cjs` 前须构建 backend、frontend 和 whatsapp-plugin 的服务端。
显式设置 HAITUO_TEST_ADMIN_URL 为本机 MySQL 管理连接；可设置 HAITUO_TEST_BROWSER_PATH 使用已安装的 Chromium。测试创建随机命名的独立数据库和专用用户，执行真实 HTTP/数据库/浏览器流程后清理该测试数据库与用户，不使用业务数据库。测试用例覆盖开户权限、跨公司拒绝、CSRF、密码哈希、限用途凭证、首次改密、凭证重放、重启持久性及页面入口。
