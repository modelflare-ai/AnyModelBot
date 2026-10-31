# 数据与隐私

简体中文 | [English](./privacy_en.md)

**一句话结论：** 对话、记忆、文件和密钥存在你的设备上；发给模型的内容会经过 Modelflare 转发到你选定的模型供应商。我们不声称能做到万无一失——凡是发给模型的内容，都会离开你的设备。

这份文档说明 AnyModelBot 把什么存在哪里、什么会离开你的设备、怎么删除。有问题可以发邮件到 [support@anymodel.bot](mailto:support@anymodel.bot)。

## 数据目录

| 运行方式 | 数据目录 |
| :--- | :--- |
| 桌面版 · Windows | `%APPDATA%\anymodel bot\data` |
| 桌面版 · macOS | `~/Library/Application Support/anymodel bot/data` |
| 桌面版 · Linux | `~/.config/anymodel bot/data` |
| 命令行 `npm start` | `./data`（环境变量 `AMB_DATA_DIR` 可改） |
| Docker | 容器内 `/data`（README 示例里挂载为卷 `amb-data`） |

## 数据清单

| 数据 | 存放位置（数据目录内） | 会离开设备吗 | 去向 |
| :--- | :--- | :--- | :--- |
| 对话与会话 | `anymodel.db`（SQLite） | 回答需要的那部分会 | 作为模型请求的上下文，经 Modelflare 发给你选定的供应商 |
| 记忆 | `memory/`（Markdown：`bots/`、`groups/`、`team/`） | 被用到时会 | 作为上下文进入模型请求；写入前会过滤看起来像密钥的内容 |
| 机器人工作区文件 | `workspaces/<机器人>/`（含收到的文件 `inbox/`、生成的图片和视频 `media/`） | 机器人读取并发给模型时会 | 同上 |
| Modelflare 登录凭据 | `modelflare-account.json`（权限 600；桌面版用系统钥匙串加密） | 只在刷新令牌时发给 modelflare.dev | Modelflare |
| API Key | 内置网关的隔离配置 `magpie/config/` | 每次模型请求作为鉴权发给 Modelflare | Modelflare |
| 微信登录态与同步游标 | 数据目录内（`weixin/` 等） | 与微信 iLink 接口通信时会 | 腾讯微信 |
| 飞书 App ID / Secret | 数据目录内的配置 | 与飞书开放平台建立长连接时会 | 飞书 |
| 允许名单与使用请求 | `anymodel.db`：谁能用哪个机器人、陌生人发来的第一条消息（截断，帮你认出是谁） | 不会 | — |
| 待发送的回复 | `anymodel.db` 的出站队列：还没发出去的消息内容和原因，包括等对方下次发消息再发的微信消息（最多留 7 天；发出去的留 7 天、发不出去的留 30 天后删除） | 发送时会 | 微信 / 飞书 |
| 设置 | `config.json` | 不会 | — |
| 日志 | `logs/app.log`（按大小轮转） | 不会；「复制诊断信息」由你手动复制，密钥已替换成 `***` | — |
| 屏幕截图（电脑操作） | 不长期保存 | 会 | 作为模型请求的一部分，经 Modelflare 发给支持视觉的模型；不会转发到微信或飞书聊天，除非你要求作为文件发送 |

## 本地控制台的访问控制

- 管理界面默认只监听 `127.0.0.1:3600`，局域网和公网访问不到。
- 桌面版每次启动都会生成一个随机访问令牌，其他本机程序无法直接调用管理接口。
- 监听非回环地址时（例如 Docker 里的 `0.0.0.0`）强制令牌访问，令牌在数据目录的 `ui-token`（Docker：`docker exec amb cat /data/ui-token`）。
- 不要把 3600 端口直接暴露到公网；需要远程访问时，请放在你自己控制的 VPN 或带鉴权的反向代理后面。

## 登录 Modelflare

- 使用 OIDC 授权码 + PKCE（RFC 7636），按 RFC 8252 作为原生应用：AnyModelBot 是公共客户端，没有客户端密钥，授权结果回调到本机回环地址的临时端口。
- 登录过程在 modelflare.dev 完成，AnyModelBot 看不到你的 Modelflare 密码。
- 在 Modelflare 个人资料页的「已授权的应用」里可以随时撤销这台设备的授权；应用里「退出登录」也会撤销授权，并删除为这台设备和各个机器人签发的 Key。

## 模型请求与 Modelflare

- 模型请求由内置的 magpie 网关发往 Modelflare，再由 Modelflare 转给你选定的模型供应商。
- 请求里包含模型回答所需的内容：提示词、对话上下文、被用到的记忆、文件内容、工具结果，以及电脑操作时的截图。
- 请求带有 `X-Modelflare-Skill: anymodel-bot/<版本>` 头，用于在 Modelflare 侧标识来源；应用里打开的 Modelflare 链接带 `utm_source=anymodelbot`。
- Modelflare 会保留请求日志；保留什么、保留多久，见 [Modelflare 信任中心](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)。各模型供应商对数据的处理，以它们各自的条款为准。

## 遥测

- 内置电脑操作驱动（Cua Driver）的遥测通过环境变量 `CUA_TELEMETRY_ENABLED=0`、`CUA_DRIVER_RS_TELEMETRY_ENABLED=0` 关闭。
- 内置网关 magpie 以关闭自动更新、关闭账户发现的方式运行，不读取你电脑上已有的其他 AI 工具凭据。
- AnyModelBot 自有代码（`src`、`electron`、`ui`、`scripts`、`dsh-runtime/plugins`）里没有分析或遥测上报：搜索 telemetry、analytics、sentry、posthog、mixpanel，只命中上面 Cua 的两个环境变量。
- 随附的第三方组件各自的行为以它们的文档为准，这里不作保证。

## 应用自己会发起的其他网络请求

除模型请求外，应用还会在以下情况联网：

- 读取 Modelflare 的模型目录、余额、用量和通知（你的账户数据，发往 modelflare.dev）。
- 生成图片或视频时，从 docs.modelflare.dev 读取该模型的请求格式。
- 微信渠道：与 `ilinkai.weixin.qq.com` 通信，并从微信 CDN 下载你发来的图片和文件。
- 飞书渠道：与飞书开放平台保持长连接。
- Windows 上开启代理模式且系统里没有可用的 PowerShell 7 时，从微软官方发布地址下载 PowerShell 7（可用 `AMB_PWSH_AUTO_INSTALL=0` 关闭，详见[开发文档](./development.md)）。

## 电脑操作与截图

- 读取屏幕会截图，截图作为模型请求的一部分发给支持视觉的模型。
- 默认所有电脑操作自动执行；可以在 机器人设置 → 电脑操作 改为「改变界面的操作先问我」，读取屏幕仍然自动。
- 权限预设为「只读」的机器人只开放读取类工具。

## 渠道

- 你在微信、飞书里和机器人收发的消息，会经过腾讯、飞书的服务器，受这两个平台各自的隐私政策约束。
- 默认只有主人和你允许的人能和机器人对话；其他人发来的消息不会交给模型，只登记成使用请求（见 [开发文档](./development.md#谁能使用机器人)）。

## 如何删除数据

1. 退出 AnyModelBot（托盘菜单 → 退出）。
2. 删除上面表格里的数据目录。Docker：`docker rm -f amb && docker volume rm amb-data`。
3. 在 Modelflare 个人资料页的「已授权的应用」里撤销 AnyModelBot 的授权。
4. 如有需要，在飞书开放平台停用你创建的应用，在微信里解除与机器人的绑定。
