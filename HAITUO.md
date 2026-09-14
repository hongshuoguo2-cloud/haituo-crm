# 海拓 · 外贸客户工作台（独立演示版）

海拓基于 GoodJob CRM 二次开发，保留主要业务功能，并提供手机号自主注册、独立登录会话、本机运行环境和 Windows 云服务器部署。演示地址为 https://demo.linqiagent.cn 。

## 本机使用

双击外层目录中的“启动海拓.cmd”。网址：http://127.0.0.1:5288/ 。

新用户在登录页点击“首次注册”，填写称呼、本人手机号和自己设置的密码；系统自动创建相互隔离的个人工作区并立即登录。再次使用时直接输入手机号和密码。历史邮箱账号和已开户手机号继续兼容。

本机演示未配置外部 API 和邮箱，不会因登录自动接通收费服务。数据库从空库初始化，未复制 GoodJob 的客户、账号或 API Key。存在一个管理员通过真实开户接口创建的演示业务员。

## 隔离范围

| 项目 | 海拓 |
|---|---|
| 源码 | D:/外贸/Haituo，分支 haituo-demo，无远端推送地址 |
| 运行数据 | D:/外贸/Haituo-local，ASCII 别名 D:/HaituoRuntime |
| 网页 / API | 5288 / 4288，仅监听本机 |
| WhatsApp 页面 / API | 5293 / 3200，仅监听本机 |
| MySQL | 独立进程与数据目录，3328，haituo_demo，专用数据库用户 |
| 登录 | 独立随机 JWT 密钥，ht_session / ht_csrf，haituo 签发者与受众 |
| 更新数据目录 | 独立运行目录；稳定版本通过 GitHub Release 自动更新 |

当前为了复用本机已安装的依赖，node_modules 使用指向 GoodJob 依赖目录的目录联接，MySQL 复用同一份程序文件；业务源码、数据库、密钥、账号和上传文件不共享。不要把该本机目录直接当成云端发布包。未来部署时在海拓目录按 lockfile 安装独立依赖，并使用独立数据库配置。

Windows 启动脚本为当前 D 盘开发环境准备，会持续看护本机进程。它使用 development 运行模式，不是公网生产配置；APP_DATABASE_PROFILE=production 仅用于允许独立命名的持久数据库，并禁止加载上游演示种子，不代表已达到生产上线条件。

## 已验证

前端生产构建、插件前后端构建、后端 TypeScript 检查通过。scripts/verify-haituo-local.cjs 验证管理员登录、旧账号和旧 JWT 拒绝、独立 Cookie、独立数据库密钥、管理员开户、业务员权限、CSRF，以及插件会话。测试不会调用外部服务；会在不存在时创建 demo@haituo.local 演示业务员。结果在 ../Haituo-local/验证结果.json。

本轮未宣称全部继承业务功能已验收。原接口盘点中的限制仍适用，包括未配置的 AI/搜客服务与旧物流模拟实现。自主注册账号直接使用本人手机号和自设密码，不需要管理员开户或一次性初始密码；API 余额只部署入口，充值和扣费尚未接入。

## 云端发布与更新

服务器使用 C:\Haituo 保存应用，C:\HaituoData 保存数据库、上传、日志和更新备份；Caddy 为 demo.linqiagent.cn 提供 HTTPS。不要上传本机 .env、数据库管理员密码或登录信息文件。

推送 `vX.Y.Z` 标签后，[GitHub 工作流](.github/workflows/publish-haituo-update.yml)会构建并发布 Windows 云端更新包。服务器计划任务 `HaituoAutoUpdate` 默认每 15 分钟检查最新稳定 Release，校验下载和包内文件，备份数据库、旧文件及发生变化的依赖，然后更新和执行健康检查；失败时恢复旧文件、旧依赖和旧启动任务。详细说明见 [自动更新文档](deploy/windows/AUTO-UPDATE.md)。

## 开源归属

原项目：https://gitee.com/sendoh-huang/GoodJob 。保留原 LICENSE 与各模块版权说明，主项目 Apache-2.0，whatsapp-plugin 保留 GPLv3 及第三方归属文件。海拓修改涉及品牌、演示登录入口、Cookie/会话命名、本机端口和独立启动脚本；原 README 保留供开发参考。
