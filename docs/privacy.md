# 数据与隐私

简体中文 | [繁體中文（台灣）](./privacy_zh-TW.md) | [English](./privacy_en.md) | [日本語](./privacy_ja.md) | [한국어](./privacy_ko.md) | [Русский](./privacy_ru.md) | [Español](./privacy_es.md) | [Português (Brasil)](./privacy_pt.md) | [Türkçe](./privacy_tr.md)

**一句话结论：** 对话、记忆、文件和密钥存在你的设备上；发给模型的内容会发到你选定的模型供应商：用官方 API Key 时直连，否则经过 Modelflare 转发。我们不声称能做到万无一失——凡是发给模型的内容，都会离开你的设备。

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
| 导入的技能 | `skills/<机器人 ID>/`；启用项复制到 `dsh/<机器人 ID>/skills/` | 名称和说明、使用时读取的正文与资料会 | 作为上下文发给所选模型；导入仅上传到你使用的 AnyModelBot 实例，不访问 GitHub |
| 聊天搜索索引 | `anymodel.db` 的 `message_search` 及其全文索引 | 不会 | 在实例内搜索已保存的消息，不调用模型 |
| 记忆 | `memory/`（Markdown：`bots/`、`groups/`；关于我：`about-me.json`，含 30 天变更历史；`team/` 是升级前的团队记忆，已搬进关于我、不再读取） | 被用到时会 | 作为上下文进入模型请求；写入前会过滤看起来像密钥的内容，证件号、银行卡号不存，地址、电话、邮箱要你确认才存进关于我 |
| 机器人工作区文件 | `workspaces/<机器人>/`（含收到的文件 `inbox/`、生成的图片和视频 `media/`） | 机器人读取并发给模型时会 | 同上 |
| 消息附件 | `attachments/`（在对话里粘贴的图片、拖入的图片和文本文件的副本，随机文件名；图片是去掉 EXIF 等元信息后的版本）。没发出的最长留 24 小时，随消息发出的留 30 天，之后删除 | 发送那条消息时会 | 图片和文件的完整文字随那条消息作为模型请求发给你选定的供应商；删除本机副本收不回已经发出的内容 |
| Modelflare 登录凭据 | `modelflare-account.json`（权限 600） | 只在刷新令牌时发给 modelflare.dev | Modelflare |
| API Key | 内置网关的隔离配置 `magpie/config/` | 每次模型请求作为鉴权发给 Modelflare | Modelflare |
| 官方 API Key（如果你填了） | 内置网关的隔离配置 `magpie/config/` | 每次模型请求作为鉴权发给对应的厂商 | 对应的模型厂商 |
| 微信登录态与同步游标 | 数据目录内（`weixin/` 等） | 与微信 iLink 接口通信时会 | 腾讯微信 |
| 飞书聊天账号的 App ID / Secret | `anymodel.db` | 与飞书开放平台建立长连接时会 | 飞书 |
| Telegram、Slack、Discord 的 token | `anymodel.db` | 与对应平台通信时会 | 你接入的平台 |
| 允许名单与使用请求 | `anymodel.db`：谁能用哪个渠道账号、陌生人发来的第一条消息（截断，帮你认出是谁） | 不会 | — |
| 待发送的回复 | `anymodel.db` 的出站队列：还没发出去的消息内容和原因，包括等对方下次发消息再发的微信消息（最多留 7 天；发出去的留 7 天、发不出去的留 30 天后删除） | 发送时会 | 微信 / 飞书 |
| 后台任务和规则 | `anymodel.db`（任务、规则、运行记录，留 30 天）；任务文件夹在 `workspaces/<机器人>/tasks/`，30 天没动过会删除（先在「需要你」里告诉你）；它们的会话记录在 `dsh/<机器人>/sessions/`，随任务一起删除 | 运行时会 | 同对话：作为模型请求的上下文，经 Modelflare 发给你选定的供应商 |
| 设置 | `config.json` | 不会 | — |
| 日志 | `logs/app.log`（按大小轮转） | 默认不会；「复制诊断信息」由你手动复制，密钥已替换成 `***`；在「需求与反馈」的「遇到问题」里勾选附带运行状态和最近日志并发送时，最近 120 行（密钥已替换）会随这次提交发出 | 你的 Modelflare 私有工单（只在你发送时） |
| 连接应用的凭证（你连接了才有）：授权登录的令牌、粘贴的令牌和 Key、专属链接、自定义 MCP 的请求头 / 查询参数 / 环境变量 | `app-secrets.json`（权限 600，不在数据库里）；日志、诊断包和界面里都打码 | 每次读写时作为鉴权发给对应的服务；本地命令的环境变量只交给你添加的那个本地程序 | 你连接的应用（飞书、腾讯文档、钉钉、高德地图、语雀、Notion、GitHub、Linear、Atlassian、Canva），或你添加的自定义 MCP 服务 |
| 连接的名称、地址、状态和工具清单 | `anymodel.db`（专属链接、带 Key 的地址只存打码后的样子） | 不会 | — |
| 机器人从已连接的应用里读到的内容（文档、消息、工单…） | 不单独保存，进入对话后和对话存在一起 | 会 | 作为模型请求的上下文，经 Modelflare 发给你选定的供应商 |
| 屏幕截图（电脑操作） | 不长期保存 | 会 | 作为模型请求的一部分，经 Modelflare 发给支持视觉的模型；不会转发到微信或飞书聊天，除非你要求作为文件发送 |

## 本地控制台的访问控制

- 管理界面默认只监听 `127.0.0.1:3600`，局域网和公网访问不到。
- 桌面版每次启动都会生成一个随机访问令牌，其他本机程序无法直接调用管理接口。
- 管理接口一律要访问令牌，本机回环地址也一样。桌面版的令牌只在内存里；命令行版和 Docker 没配置令牌时自动生成，存在数据目录的 `ui-token`（Docker：`docker exec amb cat /data/ui-token`），命令行版在终端里启动时会打印一次带令牌的地址。
- 不要把 3600 端口直接暴露到公网；需要远程访问时，请放在你自己控制的 VPN 或带鉴权的反向代理后面。

## 登录 Modelflare

- 使用 OIDC 授权码 + PKCE（RFC 7636），按 RFC 8252 作为原生应用：AnyModelBot 是公共客户端，没有客户端密钥，授权结果回调到本机回环地址的临时端口。
- 登录过程在 modelflare.dev 完成，AnyModelBot 看不到你的 Modelflare 密码。
- 在 Modelflare 个人资料页的「已授权的应用」里可以随时撤销这台设备的授权；应用里「退出登录」也会撤销授权，并删除为这台设备和各个机器人签发的 Key。

## 模型请求与 Modelflare

- 模型请求由内置的 magpie 网关发往 Modelflare，再由 Modelflare 转给你选定的模型供应商。
- 请求里包含模型回答所需的内容：提示词、对话上下文、被用到的记忆、文件内容、工具结果，以及电脑操作时的截图。
- 请求带有 `X-Modelflare-Skill: anymodel-bot/<版本>` 头，用于在 Modelflare 侧标识来源；应用里打开的 Modelflare 链接带 `utm_source=anymodelbot`。 从应用打开充值页时，网址 `#` 后面带着登录时 ID Token 里的账户标识（`#amb_account=…`，不是密钥），Modelflare 网页据此核对浏览器里登录的是不是同一个账户；`#` 后面的内容不会发给服务器、CDN 或统计脚本。「已切换 Key 配置」的提示只在本机用随机盐对 Key 算 HMAC 做比较，不保存、也不上传 Key 或它的摘要。
- Modelflare 会保留请求日志；保留什么、保留多久，见 [Modelflare 信任中心](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)。各模型供应商对数据的处理，以它们各自的条款为准。

## 用自己的官方 API Key

- 在引导页或 设置 → 模型 填入 OpenAI、Anthropic 等厂商的官方 Key 后，这些厂商的模型请求由内置网关直接发给厂商，不经过 Modelflare，也不带 `X-Modelflare-Skill` 头。这些内容的保留方式以对应厂商的条款为准。
- 厂商地址写死在应用里，界面和接口都不能改，Key 不会被发到别处。Key 只存在内置网关的隔离配置里（权限 600），不写日志、不进命令行参数，界面只显示末 4 位。
- 只填官方 Key、没有登录时，应用不会读取 Modelflare 的账户数据和价格目录。填写 Key 时，应用会用它向厂商读取一次模型列表来校验，之后每小时读一次来更新列表。
- 内置网关从 `models.dev` 读取公开的模型目录（上下文长度、参考价）。这个请求只下载，不带 Key 和对话内容。
- 生图和生视频只能通过 Modelflare 使用。

## 遥测

- 内置电脑操作驱动（Cua Driver）的遥测通过环境变量 `CUA_TELEMETRY_ENABLED=0`、`CUA_DRIVER_RS_TELEMETRY_ENABLED=0` 关闭。
- 内置网关 magpie 以关闭自动更新、关闭账户发现的方式运行，不读取你电脑上已有的其他 AI 工具凭据。
- AnyModelBot 自有代码（`src`、`electron`、`ui`、`scripts`、`dsh-runtime/plugins`）里没有分析或遥测上报：搜索 telemetry、analytics、sentry、posthog、mixpanel，只命中上面 Cua 的两个环境变量。
- 随附的第三方组件各自的行为以它们的文档为准，这里不作保证。

## 应用自己会发起的其他网络请求

除模型请求外，应用还会在以下情况联网：

- 读取 Modelflare 的模型目录、余额、用量和通知（你的账户数据，发往 modelflare.dev）。
- 你在「需求与反馈」里发送时（使用场景与建议、遇到问题、企业与合作三选一），把你写的内容、补充的场景或企业背景、选择的角色、入口、版本和系统信息，以及你选择附带的报错和日志（密钥已替换成 `***`）发到 modelflare.dev，作为你 Modelflare 账户下的私有工单；客服回复会发邮件，也能在 Modelflare 的工单页查看。发送前可以查看完整的发送内容，不附带对话内容和截图。联系方式默认不带：只有你展开「愿意进一步聊聊」、勾选「同意就本次反馈联系我」并选择账号邮箱或填写邮箱 / 微信号时才随这次提交发出，只用于这次反馈的沟通；关闭窗口、登录、换账号后要重新确认。草稿只存在本机数据目录里（按账户分开、只有你能读、机器人读不到，闲置 7 天清理），不同步到云端。没登录 Modelflare 或使用外部网关时不能在应用内建工单，可以改用邮件或 GitHub（公开）自行提交，副本里不带联系方式和企业背景；「联系 Modelflare」打开商务联系页，不带任何你填写的内容。
- 生成图片或视频时，从 docs.modelflare.dev 读取该模型的请求格式。
- 微信渠道：与 `ilinkai.weixin.qq.com` 通信，并从微信 CDN 下载你发来的图片和文件。
- 飞书渠道：与飞书开放平台保持长连接。
- Telegram、Slack、Discord 渠道：接入后与 `api.telegram.org`、`slack.com`、`discord.com` 及其文件地址通信，用来收发消息和你发来的文件。
- Windows 上开启代理模式且系统里没有可用的 PowerShell 7 时，从微软官方发布地址下载 PowerShell 7（可用 `AMB_PWSH_AUTO_INSTALL=0` 关闭，详见[开发文档](./development.md)）。
- 桌面安装版启动后及每 6 小时向 GitHub 检查应用更新，默认后台下载更新文件；可在「设置 → 常规」关闭自动下载。请求不带账户凭据或聊天内容，安装需要你点击「重启并更新」，且没有正在运行的任务。
- 查看还没安装的新版本「更新了什么」时，从 GitHub（`raw.githubusercontent.com`）读取那个版本的更新日志。只在你点开时请求，不带账户凭据或聊天内容；已安装版本的更新日志随应用打包，不联网。
- 仅当你显式设置 `AMB_CATALOG_URL` 使用远程 Bot 目录时，才会读取远程列表并按需下载经过签名和哈希校验的包，不上传你的数据。默认的官方 Bot 目录、界面、示例数据和技能均随应用内置，打开和安装不发起这些网络请求。

## 电脑操作与截图

- 读取屏幕会截图，截图作为模型请求的一部分发给支持视觉的模型。
- 默认所有电脑操作自动执行；可以在 机器人设置 → 电脑操作 改为「改变界面的操作先问我」，读取屏幕仍然自动。
- 权限预设为「只读」的机器人只开放读取类工具。

## 渠道

- 你在微信、飞书、Telegram、Slack、Discord 里和机器人收发的消息，会经过这些平台的服务器，受它们各自的隐私政策约束。
- 默认只有主人和你允许的人能和机器人对话；其他人发来的消息不会交给模型，只登记成使用请求（见 [开发文档](./development.md#谁能使用机器人)）。

## 如何删除数据

1. 退出 AnyModelBot（托盘菜单 → 退出）。
2. 删除上面表格里的数据目录。Docker：`docker rm -f amb && docker volume rm amb-data`。
3. 在 Modelflare 个人资料页的「已授权的应用」里撤销 AnyModelBot 的授权。
4. 如有需要，在飞书开放平台停用你创建的应用（包括扫码时自动创建的），在微信里解除与机器人的绑定；在 Telegram（@BotFather）、Slack、Discord 上删除你创建的机器人；在各个应用自己的设置里（Notion、飞书、GitHub 等）断开 AnyModelBot 的授权，删除你创建的令牌和 Key。
