# 开发文档

简体中文 | [English](./development_en.md) | [日本語](./development_ja.md) | [한국어](./development_ko.md) | [Русский](./development_ru.md) | [Español](./development_es.md) | [Português (Brasil)](./development_pt.md)

这份文档给想从源码运行、打包或参与开发的人看。普通用户直接从 [Releases](https://github.com/modelflare-ai/AnyModelBot/releases) 下载安装包即可，见 [README](../README.md#-下载与运行)。

- 一个机器人 = 人设 + 默认模型 + 记忆。账号是全局的（设置 › 聊天渠道），所有机器人共用，同一个服务可以加多个。定位：自用、单用户。
- 模型来自 Modelflare 账户或用户自己的官方 API Key。[Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)：首次启动登录（或注册）Modelflare 账户，模型自动列出。请求经过内置的 [magpie](https://github.com/yetone/magpie) 网关转发。
- 三种运行方式，同一套代码：**桌面版（Electron）**、**命令行 `npm start`**、**Docker**。

## 目录结构

```
src/
  core/          统一消息类型、会话队列与去重、运行时（/model /reset、流式）、重启后的提醒、准入（主人 + 允许名单）、持久化出站队列
  delivery/      主动消息的投递：免打扰、每天上限、合并摘要、微信 24 小时窗口和续期提醒
  agent/         代理模式：DSH 宿主与桥接、审批、权限预设、记忆与上下文管家、DSH 会话目录
    prompts/     交给代理模型的全部提示词：人设、聊天规则、记忆说明、每段第一条消息、技能说明
  tools/         代理用的能力：联网搜索（search.ts）、生图 / 生视频（media/）、电脑操作（computer-use/）、Windows PowerShell（pwsh/）、连接应用——内置应用连接器和自定义 MCP（apps/）、现有的 Notion / 飞书账号（accounts/）
  llm/           OpenAI 兼容客户端（模型接入接口）
  magpie/        内置 magpie 守护：隔离目录、空闲端口、自动生成密钥、健康检查、崩溃重启、干净退出
  channels/      feishu/（长连接 + CardKit）  weixin/（iLink，MIT 声明见 LICENSE.openclaw-weixin）  messenger/（Telegram、Slack、Discord，共用一套收发）
  tasks/         后台任务和规则：运行、阶段、花费、保留与清理、时间表
  botkit/        目录 Bot 框架：包格式、检查、打包签名、目录、安装、界面静态路由（见 docs/bot-framework.md）
  skills/        用户自己装的技能（ZIP 包）
  store/         SQLite（node:sqlite，无需原生编译）
  domain/        纯数据形状和规则：机器人设置、免打扰时段、时间表、目录 Bot 记录、代理步骤；不做 I/O，只依赖 i18n。store 只依赖它（依赖方向由 test/architecture.unit.test.ts 检查）
  account/       Modelflare 账户：PKCE 回环登录、令牌轮换、余额与提醒、机器人预算 Key、模型能力与参考价
  web/           管理界面服务：server.ts 启动、鉴权、分发；routes/ 按领域放接口（JSON API + 流式对话 SSE）；http.ts 是共用的小函数
  cli/           init 首次设置向导、weixin-login
  providers/     模型从哪来：modelflare.ts（线路、密钥校验 GET /v1/models、模型路由与归因）、modelflare-domains.ts（线路测速）、official.ts（官方 API 厂商表，地址写死）
  updates/       更新：check.ts（检查新版本）、desktop.ts（桌面版的下载与重启）
  guide.ts       上手清单的进度
  i18n/          服务端多语言：报错、状态文字、托盘菜单、机器人发出的系统消息（messages/<命名空间>.ts）
  diagnostics.ts 故障排查：探测、日志尾部、脱敏的诊断报告
  version.ts     应用版本号（package.json）
  main.ts        命令行入口
electron/        桌面版主进程（启动器 + 托盘）
ui/              管理界面（Preact + htm，无构建步骤）
  design/        设计系统：tokens/、base/、components/、机器人形象 bots/
  locales/       界面文案：zh-CN/ 与 en/，每个命名空间一个文件
  css/ lib/ components/ screens/ assets/ main.js
dsh-runtime/     DSH 代理运行时的依赖清单与 AnyModelBot 插件（plugins/）
scripts/         setup / build-magpie / fetch-cua-driver / prepare-dsh / bundle-dsh / electron-smoke / check-readme 等
vendor/          git 子模块：magpie（构建时编译）、deepseek-harness、kimi-computer-use
site/            官网（Astro 静态站），说明见 site/README.md
docs/            开发文档、隐私说明、README 素材（docs/assets/）
```

## 从源码运行（命令行）

需要 Node.js 22.13+、Go 1.26.8+（用于从源码编译 magpie）。

```bash
npm install
npm run setup        # 拉取 vendor/magpie 子模块并编译到 build/bin/
npm run init         # 可选：终端里的首次设置（登录 Modelflare 账户、飞书凭据）
npm start            # 启动全部：内置网关 + 机器人 + 管理界面 http://127.0.0.1:3600/
```

数据默认在 `./data`（`AMB_DATA_DIR` 可改）。其余环境变量见 `.env.example`。

## 桌面版（Electron）

```bash
npm run electron:dev     # 开发运行
npm run electron:smoke   # 冒烟测试（Linux 无显示器时自动用 xvfb-run）
npm run dist             # 打包当前平台（magpie 随附在 resources/magpie/）
npm run dist:linux | dist:mac | dist:win
npm run test:dsh-bundle  # 用 Electron 跑真实 DSH 集成测试，加载打包后的 build/dsh（需先 prepare:dsh + bundle:dsh）
```

- DSH 代理运行时：`scripts/prepare-dsh.mjs` 按目标平台安装 `dsh-runtime/`，`scripts/bundle-dsh.mjs` 把它打成 `resources/dsh/dsh.asar`（全部 JS，一个文件）加上 `resources/dsh/node_modules/`（只有原生包，约 55 个文件）。Electron 主进程和 `ELECTRON_RUN_AS_NODE` 子进程直接读 asar，无需首启解压；安装包因此只需解出几百个文件（Windows 上解压与杀毒逐个扫描是安装慢的主因）。开发时仍直接用 `dsh-runtime/`。
- Windows 上代理执行命令用的 PowerShell：经沙箱时 Windows PowerShell 5.1 每条命令要二三十秒，PowerShell 7 约 1 秒。应用按这个顺序选：系统里能用的 PowerShell 7（后台按 DSH 的方式试运行一次，什么都不下载）→ 应用内置的 PowerShell 7 → Windows PowerShell 5.1。没有能用的 7 且代理模式开着时，应用在后台自动下载官方 PowerShell 7.6.9（LTS）的 zip，装到 `%LOCALAPPDATA%\AnyModelBot\pwsh\`：不需要管理员权限，不写注册表、不改 PATH，不影响你自己的 PowerShell。版本和 x64 / arm64 两个 zip 的 SHA256 写死在 `src/tools/pwsh/private.ts`（升级用 `node scripts/pwsh-hashes.mjs <版本>`），下载后核对哈希、解压后核对微软 Authenticode 签名，再按 DSH 的方式试运行（版本、读写临时文件、拉起外部程序）通过才用；装失败或装了一半的不会被用，下次启动会清掉。装的时候对话页和 设置 → 常规 显示进度，`/status` 也有，装好之前命令照常用 5.1；装好后空闲的代理进程在后台换用它，不用重启应用。运行中代理拉不起它（被杀毒软件删除或隔离、被策略拦截）就自动退回上一种并提示原因；设置 → 故障排查 可以安装、重新安装、改回系统默认。Windows 10 1607 / Server 2016 以前的系统不下载。桌面版下载走系统代理（Chromium 网络栈）；命令行版用 Node 的 fetch（较新的 Node 设 `NODE_USE_ENV_PROXY=1` 后认 `HTTPS_PROXY`）；`AMB_PWSH_MIRROR` 可换成镜像前缀（照样核对哈希和签名），`AMB_PWSH_AUTO_INSTALL=0` 关掉自动安装。
- 代理执行的命令能联网（沙箱只限制写文件），用的是你的代理：应用环境变量里的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`（及小写）和证书、软件源变量（`SSL_CERT_FILE`、`REQUESTS_CA_BUNDLE`、`NODE_EXTRA_CA_CERTS`、`PIP_INDEX_URL`、`npm_config_registry`、`GOPROXY` 等）原样传下去；环境里没设代理时，桌面版每次拉起代理进程都问一次系统代理（系统设置和 PAC），按 `http://主机:端口` 传下去（见 `src/agent/proxy-env.ts`）。本机地址（`127.0.0.1`、`localhost`、`::1`）总是并进 `NO_PROXY`，永不走代理。
- 数据目录：`<userData>/data`（macOS `~/Library/Application Support/anymodel bot/data`，Windows `%APPDATA%\anymodel bot\data`，Linux `~/.config/anymodel bot/data`）。日志在数据目录的 `logs/app.log`。
- 启动诊断（自 0.1.34 起，协助排查 #71）：进入桌面主进程后、申请单实例锁之前，另写 `logs/startup-<时间>-<PID>.log`，记录实际数据目录、平台、版本、锁结果和启动阶段。每个进程单独写，主实例保留最近 20 份，不影响正常 `app.log`。数据目录无法写入时尝试系统临时目录下的 `anymodel-bot-startup-*`。带 `--diagnose-startup` 启动时，未获得单实例锁会显示日志位置；普通的第二次启动仍交给已有实例。
- Windows 秒退排查：目录名是带空格的 `anymodel bot`。`--help` 显示 Node.js usage 不能证明程序使用 Node SEA；Electron 的 `ELECTRON_RUN_AS_NODE` 环境变量会在应用代码执行前切到 Node 模式，这时应用自己的日志也不会初始化。先检查该变量，并在单次启动的子进程环境中清除它；不要把跳过单实例锁作为修复。需要原生启动日志时可使用 Electron 的 `--enable-logging=file --log-file="<可写路径>"`。这些路径与开关的实际结果应一并提供给维护者。
- 单实例；关闭窗口默认隐藏到托盘（设置 → 常规 可改为退出）；托盘菜单：打开 / 在浏览器中打开 / 开机自启（macOS、Windows）/ 打开数据目录 / 退出。
- macOS 下窗口无标题栏，红绿灯嵌在侧栏顶部；窗口最小宽度 860。
- 界面只监听 127.0.0.1，且每次启动生成随机访问令牌，其他本机程序无法直接调用管理接口。
- 退出时先停渠道、再停 magpie；若上次被强杀残留 magpie 进程，下次启动会自动清理（Linux/macOS）。

发布：在 `CHANGELOG.md`、`CHANGELOG_en.md`、`CHANGELOG_ja.md`、`CHANGELOG_ko.md`、`CHANGELOG_ru.md`、`CHANGELOG_es.md` 和 `CHANGELOG_pt.md` 写好这个版本的更新日志（用户能感受到的变化，不写网站和内部改动。官网英文页不显示提到微信、飞书的行），改 `package.json` 的版本号并提交，推送 `v<版本>` 标签。这个版本没写更新日志时，发布流程开始就会失败；写了就作为 GitHub Release 的说明，官网更新日志页也显示它。应用里的「更新了什么」弹窗读的也是它：`CHANGELOG*.md` 随安装包和 Docker 镜像打包（`src/changelog.ts`），还没安装的新版本在用户点开时从那个版本标签下读取。`.github/workflows/release.yml` 会在六种系统 / 架构上各自打包，并把安装包和 `SHA256SUMS` 发到 GitHub Release。签名与公证所需的仓库密钥见该文件开头的注释。同一个标签还会触发 `.github/workflows/docker.yml`，把 x64 + arm64 镜像发布到 `ghcr.io/modelflare-ai/anymodel-bot`（`<版本>` 和 `latest` 两个标签）。 标签发版时 macOS 包必须带 Developer ID 签名并完成公证，打包后会对 .app 和 DMG 里的 .app 做 `spctl` 等校验，不通过就失败。正式包关闭开发者工具；需要调试包时用 `npm run dist:debug`，或在手动运行 Release 时勾选 `debug_build`（文件名带 `-debug-`，标签上不允许，`scripts/check-build-flavor.mjs` 会核对打包结果）。

每次发版必须同步官网、相关文档和各语言的 README。先运行 `npm --prefix site run sync` 同步官网内容；GitHub Release 和 Docker 发布后，按[官网部署说明](../site/README.md)更新线上官网，确认 `/download`、`/changelog` 和 `/bots` 的版本、下载链接与说明一致。只有线上官网也同步完成，才算本次发布完成。

应用内更新从 0.1.29 开始提供，使用 `electron-updater`，只在已打包的 macOS、Windows 和 Linux AppImage 中启用。`ui.autoDownloadUpdates` 默认 `true`，在「设置 → 常规」修改；下载完成只通知，不会在普通退出时安装，点击重启前会检查活动对话和后台任务。0.1.28 及以前的用户需手动安装一次包含更新器的版本。GitHub 构建为 macOS 同时生成 DMG 和更新用 ZIP，并发布按架构区分的 `latest-${arch}` 更新清单及 blockmap；所有文件上传完成后才公开 Release。CLI、Docker 和未打包的开发运行仍手动更新。

## Docker

用户直接用已发布的镜像：`docker run -d --name amb -p 3600:3600 -v amb-data:/data ghcr.io/modelflare-ai/anymodel-bot`。下面是从源码自己构建：

```bash
git submodule update --init --depth 1 vendor/magpie
docker build -t anymodel-bot .
docker run -d --name amb -p 3600:3600 -v amb-data:/data anymodel-bot
docker exec amb cat /data/ui-token     # 打开 http://<主机>:3600/?token=<令牌>
```

容器内界面监听 0.0.0.0，因此强制令牌访问。不要把 3600 端口直接暴露到公网。微信扫码在 设置 › 聊天渠道 里完成。

## 模型（Modelflare）

- 首次启动只有一个按钮「登录 / 注册 Modelflare」：在系统浏览器里登录（没有账户可当场注册）并点「继续」授权，回到本程序后自动为这台电脑签发一把专用 API Key 并连接 → 选默认模型 → 开始对话。Docker 或远程部署收不到浏览器登录的回调：登录后浏览器会跳到打不开的 `127.0.0.1` 地址，把地址栏里的链接贴回首次启动页即可（`POST /amb/api/account/login/complete`，state 和 PKCE 校验不变）。旧版本填过 API Key、没有登录的，升级后 Key 会从本机移除，需要重新登录。 浏览器里的回调页先显示「正在完成登录」，换令牌、读账户、签发本机 Key、接入网关全部成功后才显示「登录成功」（失败时显示原因）；桌面版注册了 `anymodelbot://` 链接，成功页加载后自动尝试打开一次应用，「打开 AnyModelBot」按钮可以重试，只有应用确实收到这次的链接才显示「已返回」。用自己的 API Key 的页面下方也能直接用 Modelflare 账号登录。第一次接入、全局默认模型还空着时，按 `src/account/first-model.ts` 的规则选一次首用模型（支持工具调用，单轮预占和一个代表性任务的花费都在体验额度内，优先 DeepSeek）；没有合适的就不预选，让用户自己选。
- 登录方式：OIDC 授权码 + PKCE（RFC 7636），按 RFC 8252 作为原生应用——本程序是公共客户端（`client_id` 为 `anymodel-bot`，没有也不需要客户端密钥），授权结果回调到本机 `127.0.0.1` 的临时端口。在 Modelflare 网页个人资料页的「已授权的应用」里可以随时撤销；撤销后本程序会发现并回到登录页。
- 账户凭据（refresh token）存在数据目录的 `modelflare-account.json`（权限 600），和内置网关的 API Key 一样只靠文件权限保护，不用系统钥匙串（0.1.30 及以前桌面版加密过的文件，第一次读到时改写成明文）；界面只拿到账户名称。「退出登录」会撤销这台电脑的授权，Modelflare 同时删除登录时为它和各机器人签发的 Key。
- 余额：不常驻显示，点侧栏左下角的头像弹出，设置 → 模型 里也有，显示账户钱包余额；「充值」打开 Modelflare 网页，回到窗口时自动刷新。余额低于提醒线（默认 1 美元，可改或关闭）时在应用里提醒一次，也可以设置让机器人发到你的微信 / 飞书。
- 登录后还能在 设置 → 模型 查看按天、按模型的用量，Modelflare 发来的通知，以及复制邀请链接。
- 机器人预算（需要登录）：机器人设置 → 预算，开启后这个机器人用自己的 Key（内置网关里单独的 provider），最多花设定的美元数；关闭后回到共用的 Key。
- 推理强度：在模型选择面板或 设置 → 模型 里选（自动 / 低 / 中 / 高），全局一个，下一轮生效。自动时不发任何参数，用模型默认。只对支持的模型生效：Responses 接口的推理模型、模型资料标了推理的 Chat 和 Claude（Claude 4.6 起用 adaptive + `output_config.effort`，更早的用 `budget_tokens`）。
- 生图 / 生视频：代理模式下机器人有 `media_models`（可用模型、默认模型、参数范围、参考价）、`media_docs`（从 docs.modelflare.dev 实时读该模型的请求格式）、`generate_image`、`generate_video` 四个工具，并自带一份 media 技能说明。各模型的参数格式不同，机器人按文档写请求体，工作区里的参考图写成 `workspace:路径` 即可；Key 始终只在本程序里，由本程序带着该机器人用的 Key 调 Modelflare，结果存进机器人工作区的 `media/`，再交付到聊天。
- 生成前确认：直接生成，不打扰你。机器人选了不是默认的模型、要求没说清，都不问：它按最合理的理解生成，再说一句用了什么。只在预计花费超过 $0.5 时（按参考价、张数、视频时长和分辨率估算；视频估不出来也算）先在聊天里问你这次用哪个模型（附提示词、参数、参考价和为什么问）。可以确认、换成别的模型或取消；微信回复编号或模型名，飞书 / 网页点选。10 分钟内没回答就不生成。想每次都确认：机器人设置 → 生图 / 生视频 → 生成前确认 →「每次都问」。
- 联网搜索：代理的 `web_search` 不用 DeepSeek 自带的搜索（它要 DeepSeek 的 Key），经 `amb-web-search` 插件交给本程序搜。默认免费、不用设置：依次试 Exa 的公开 MCP、必应、DuckDuckGo，上次成功的先试，出错的（限流、验证页、必应给出不相干的结果）跳过 10 分钟。设置 → 网络与访问 → 联网搜索 可以换成 Tavily、Exa、博查、智谱（填 Key）或自己的 SearXNG，填了就先用它，出错时退回免费的。Key 和渠道令牌一样存在本机数据库里，代理进程拿不到。桌面版搜索走系统代理；命令行版用 Node 的 fetch（设 `NODE_USE_ENV_PROXY=1` 后认 `HTTPS_PROXY`）。
- 聊天渠道账号（`src/core/routes.ts`）：微信、飞书、Telegram、Slack、Discord 的账号也是全局的，在设置 › 聊天渠道里添加，可以起别名。消息交给哪个机器人：这个人用 `/bot` 选过的 → 账号的默认机器人 → 第一个机器人。`/bot` 列出机器人，发一次 `/bot 名字` 就切换并记住，之后这个会话一直和它聊。每个机器人的系统提示词里都有其他机器人的名单和切换方法，用户问起时答得上来。名单和主人跟着账号走，能用这个账号的人可以和任何机器人聊。账号的 key 是命名空间：升级前的渠道 key 就是原来的机器人 id，登录态、配额、名单、队列都不用搬，默认机器人也是原来那个。删除机器人不影响账号。
- 连接应用（`src/tools/apps/service.ts`）：全局一份（头像菜单 › 连接应用），默认所有机器人都能用，可以按机器人、按工具收窄（机器人设置 › 应用）。一个应用在应用页只有一张卡片，下面可以有多个账号，比如对任何机器人说「看我第一个飞书和第二个飞书的消息」，账号用工具的 `account` 参数选（序号或名字）。
  - **内置应用**（`catalog.ts`）：飞书、腾讯文档、钉钉、高德地图、语雀、Notion、GitHub、Linear、Atlassian、Canva。认证方式和自定义连接器是同一套：授权登录（OAuth，动态注册，`oauth.ts`）、请求头、查询参数、专属链接；语雀是随安装包带的本地程序（`vendor/yuque-mcp`，`scripts/vendor-yuque-mcp.mjs` 生成），用户只粘贴 Token。
  - **自定义连接器**：远程 Streamable HTTP（连不上再试旧式 SSE）或本地命令，最多 20 个。粘贴识别和表单 ⇄ JSON 在 `ui/lib/connector-config.js`。本地命令用登录 shell 的 PATH（`shell-path.ts`），第一次要下载软件包的（npx、uvx）等得久一些。
  - **由主程序来连**（`mcp-client.ts`，官方 `@modelcontextprotocol/client`）：凭证只在主程序里，存在 `app-secrets.json`（权限 600，不进数据库，`secrets.ts`）；`amb-connections` 插件把每次工具调用经 bridge 交给本程序。MCP 连接的工具不一个个塞给模型，而是三个固定的工具：`app_tools` 找工具、`app_tool_schema` 看参数、`app_call` 执行，另有 `app_connect` 请用户去连接（对话里出卡片，连上后接着做）。
  - **审批**（`service.ts` 的 `gate`，问用户在 `agent/manager.ts`）：只读直接用；写入按机器人的权限档位（只读机器人不给，默认档位先问、可以「以后这个工具都允许」，完全权限直接执行）；删除和对外发送每次都问；「只观察」的规则不能写。工具的类别见 `classify.ts`：内置应用用内置的清单和官方标注，自定义连接器的标注只作初值、用户可改。
  - **现有的 Notion、飞书账号**（`src/tools/accounts/`）：升级前连好的照旧能用，不用重新授权，令牌在第一次启动时从数据库搬到 `app-secrets.json`。Notion（`notion.ts`）选一键授权或令牌：令牌走 REST API，一键授权用 OAuth + PKCE + 动态注册、回调到本机 `/oauth/notion/callback`，再调官方远程 MCP（`mcp.notion.com`）；模型看到的仍是 `notion_search`、`notion_read_page`、`notion_query_database`、`notion_create_page`、`notion_update_page`，没有删除。飞书（`feishu.ts`）的现有账号用用户身份只读消息（`feishu_list_chats`、`feishu_read_chat`、`feishu_search_messages`）；新连的飞书账号走官方远程 MCP（云文档读写 + 只读消息），现有账号重新授权后换成它。
- 默认图片 / 视频模型：首次设置时和默认文本模型一起选，之后在 设置 → 模型 修改；选「自动」时用推荐顺序里第一个不需要参考素材的模型。
- 模型选择器里显示上下文长度、视觉 / 工具 / 推理能力，以及每百万 tokens 输入 / 输出的起步参考价（来自公开价格目录，以账单为准）。
- 性价比（需要登录）：应用签发的 Key（本机 Key 和各机器人的预算 Key）都带 Modelflare Smart Key 的路由策略 `routing_strategy`——省钱 `low_cost`（倍率最低的分组先试）、均衡 `balanced`（默认，从价格居中的分组开始）、质量 `stable`（倍率最高的先试）。在 设置 → 模型 → 性价比 或模型选择器的第一个滑块里改，改的时候连同已有的 Key 一起改（`PATCH /api/connected-app/api-keys/<id>`），选择存在本机数据库（`account.routing`）。没选过的老用户第一次核对 Key 时把均衡应用到已有的 Key 上，只这一次（日志 `applied the default key routing strategy`）。Modelflare 回显了 `routing_strategy` 才算支持；拒绝（400 / 422）时不带这个字段再签一次，签发、核对、预算都不会因此失败，忽略（不回显）也一样记为不支持，这时界面不显示这个设置，一天后再试一次。
- 模型智能（模型选择器的第二个滑块）：在这个账户能用、又有 Artificial Analysis 数据的模型里，按智能指数（越高越好）和每次任务的花费（越低越好）取帕累托前沿，最多 5 档，最便宜的和最强的总在。智能取应用实际用的那一档：走 Responses 接口的推理模型默认发 medium，就用 AA 的 medium 那一行，其余用 AA 的默认那一行（`src/account/model-quality.ts`）。花费 = AA 的每次任务花费（官方定价）× 这个模型在当前性价比下的价格比例（可用公开分组的倍率 × 售价倍率：省钱取最低，质量取最高，均衡取居中；企业专用分组不算；没登录或不支持时按均衡估）。拖到哪一档就把模型换成那个；点模型名进完整列表，照样手动选，选了不在档上的模型时滑块显示「自定义」。前沿不到两档时选择器直接是列表。算法在 `ui/lib/frontier.js`。
- AA 数据在仓库里：`assets/model-quality.json`（`updatedAt`、`source`、只留用得到的字段，已经按 Modelflare 的模型 ID 对应好）。刷新：`node scripts/update-model-quality.mjs`，默认抓公开排行榜页面 https://artificialanalysis.ai/leaderboards/models 和 Modelflare 的公开价格目录；设了 `AA_API_KEY` 时改用官方 API（字段还没有拿 Key 核对过）。`--html <文件>`、`--pricing <文件>` 用保存下来的页面和目录，`--dry-run` 只打印。页面结构变了（找不到列、行的形状不对、数字解析不出来、行数太少、对上的模型太少）时退出码为 1 并说明是哪一项，原来的快照不动。名字按规则对不上的模型写在脚本的 `OVERRIDES` 里。数据来自 Artificial Analysis，选择器底部注明出处。
- 调用归因：经 Modelflare 的请求都带 `X-Modelflare-Skill: anymodel-bot/<版本>`，链接都带 `utm_source=anymodelbot&utm_campaign=amb_<位置>`（应用内 `amb_signup`、`amb_topup`、`amb_console` 等，README 与仓库文档 `amb_readme`，官网 `amb_homepage`；格式由 `test/utm.unit.test.ts` 固定）。
- API 域名：`https://modelflare.dev/v1`、`https://origin.modelflare.dev/v1` 和 `https://cf.modelflare.dev/v1` 均可选择。在 设置 → 模型 → API 域名 中选择，也可手动测速。测速从运行 AnyModelBot 的设备发起，不带密钥访问三个域名的 `/v1/models`，显示三次探测的响应时间中位数和成功次数；401 表示已收到 API 响应，不代表密钥有效或模型生成速度。域名不会自动切换；历史配置 `auto` / `global` 仍指向主域名，`cn` 指向 origin，`cf` 指向 cf，兼容值不代表地域或质量差异。
- 设置 → 模型：账户、余额与充值、余额提醒、用量、通知、邀请；性价比、推理强度；默认模型、刷新模型列表。
- 对话中输入框右侧的模型按钮可为当前会话切换模型（也可设为机器人默认）；`/model`、`/reset`、`/new`、`/status`、`/stop`、`/help` 照常可用。
- 处理过程：代理回合的每一步（模型请求及用时与 tokens、工具调用及参数与输出、重试、子代理）折叠在回复上方的"用时"一行里，点开查看；微信 / 飞书会话在信息面板 → 最近会话里看，正在处理的那一轮实时显示并可中止。
- 卡住的消息：`/stop`（任何渠道）或信息面板里的「中止」立即结束正在处理的回合；代理 10 分钟没有任何进展（模型不回、工具不动、只在重试；等你批准或回答不算）会自动中止，单回合最长 30 分钟（`AMB_AGENT_IDLE_TIMEOUT_MS`、`AMB_AGENT_TURN_TIMEOUT_MS` 可调）。中止只停这个会话的回合（经代理进程里的 amb-control 插件取消它），同一机器人的其它会话照常进行；10 秒内没停下（`AMB_STOP_GRACE_MS`）才重启代理进程。`/status` 显示它走到了哪一步、多久没有进展。网页对话里切到别的机器人或刷新窗口不会打断正在处理的消息，回来时接着显示（你的消息、到目前为止的回复和处理过程）；停止按钮在排队、代理启动中、等你批准时也能用，纯对话也一样。
- 插话：代理正在处理时又发来的消息（文字连同图片 / 文件）直接并入这一轮，模型在下一步就看到，回复一起给（先回一句"收到"，经出站队列发、10 分钟没发出去就不再发）；插话同样先过准入（不在允许名单里的人发的消息不会并入）；代理还没接手或正在收尾时照常排队，命令（`/model`、`/reset`…）也排队。网页对话在回复进行中同样可以接着发。
- 长命令转后台：命令跑过 30 秒（Windows PowerShell 60 秒）就转成后台任务、不再卡住这一轮，代理先回复"还在跑"；命令结束时代理被唤醒、拿到结果，回复作为一条新消息发到同一个会话（网页对话实时显示；微信、飞书和普通回复一样经出站队列发送：id 由代理会话和回合号推出、只发一次，微信发送时才查 24 小时窗口和配额，飞书回复你最近的那条消息，这条消息的 id 存在库里），处理过程里能看到后台命令的步骤，`/status`、中止、看门狗都认这一轮。
- 每个会话用自己的模型：同一个代理进程里各会话各走各的模型和接口（每种接口一个 provider，上下文窗口、最大输出按模型），换模型不重启代理进程；补丁里没列出的模型在运行中补上。
- 换新的代理进程：DSH 的 SDK 关不掉会话，后台任务和每次规则运行的会话都留在代理进程里，直到它重启（实测一个跑完、空闲的会话多占约 0.25–0.45 MB）。一个代理进程开过 100 个以上这样的会话后，等它完全空闲（没有聊天回合、没有在跑或收尾的任务和规则、没有等批准的、没有在压缩的会话、进程里没有后台命令）就在后台换一个新的；会话照常接着用，不中断任何东西，用户看不到。故障排查的代理状态里有 `taskSessions` 和 `recycles`；`AMB_DSH_RECYCLE_SESSIONS` 可改门槛。
- 重启后的提醒：应用退出或崩溃时还没处理完的消息（每个会话在数据库里留一个处理中的标记，处理完就删），下次启动时在原会话里说一次「上次的消息「…」因为应用重启没有处理完，请重新发送」，不会自动重发。网页对话记进会话历史；微信用存下的 context_token 发送、占用同一份回复配额，超过 24 小时窗口或配额用完时等你在那个会话里发下一条消息时先说；飞书发到原单聊。
- 代理的对话接口：代理按 Modelflare 公开目录里该模型支持的接口选——有 Responses API 的（GPT-5.4 及以后、Grok 4.5 及以后、DeepSeek V4、GLM-5、Kimi K3 等）走 `/v1/responses`（推理模型默认推理强度 medium，加密推理随历史回放）；没有 Responses、有 Anthropic Messages 的（Claude）走 `/v1/messages`；其余模型、拿不到目录时（例如离线）以及外部端点走 Chat Completions。接口按模型在代理进程里第一次用到它时选定（故障排查的代理状态里显示最近一轮的 `api` 和进程里的模型）；`AMB_AGENT_API=chat` 强制全部走 Chat Completions（排查用）。纯对话（非代理）仍走 Chat Completions。安全网：某个模型在 Responses / Messages 上的请求被上游拒绝（HTTP 400/404/405/415/422 或“不支持的参数 / 接口”，限流、余额、权限、上游故障、上下文过长不算）时，这个模型 24 小时内改走 Chat Completions（记在数据目录的 `dsh/api-fallback.json`，日志有警告，代理状态显示 `openai-completions (fallback: 原因)`）；这一轮如果还没调用过工具，这个会话换到 Chat 上自动重做一遍（不重启代理进程），用户照常收到回复，已经调用过工具的则照常报错、下一轮起走 Chat。
- 内置网关：magpie 以 `--gateway` 模式运行，使用本程序数据目录内独立的 HOME/配置目录；**不读取**你电脑上已有的 Claude/Codex 等订阅凭据，**不改写**任何 agent 配置，关闭自动更新与账户发现。它只供本进程内部调用，界面不再反代它的页面或 `/v1`。
- API Key 只保存在内置网关的隔离配置中，不经过命令行参数、不写日志，前端只拿到尾号。
- 开发/测试：设置 `AMB_MAGPIE_BASE_URL` 可直接使用一个 OpenAI 兼容端点（不启动内置网关，界面视为已连接，账户功能不可用）；`AMB_MODELFLARE_BASE_URL` 可把 Modelflare 基址指向本地 mock，`AMB_MODELFLARE_ISSUER` 把登录与账户接口指向本地 mock。

## 官方 API Key

- 引导页的「使用自己的 API Key」和 设置 → 模型 都能填。支持的厂商和地址写死在 `src/providers/official.ts`，接口（`GET /amb/api/official`、`PUT`/`DELETE /amb/api/official/<id>`）只认表里的 id，不能填地址。
- 每家是内置网关里的一个 provider，id 为 `official-<厂商>`，模型 id 为 `official-<厂商>/<模型>`，和 Modelflare 的同名模型分得开。Key 不经命令行参数：经网关本机接口的请求体写入隔离配置。
- 校验走网关的模型列表接口（代理、各家的鉴权写法都在网关里），通过才保存。模型每小时和厂商的列表核对一次，不能对话的（语音、图片、向量……）不进选择器。
- 代理的接口按厂商定：OpenAI 走 Responses，Anthropic 走 Messages，其余走 Chat Completions；上下文、价格、推理能力来自网关的模型目录（`/v1/models`）。只有官方 Key 时不读 Modelflare 的目录和账户。
- 走官方 API 的模型不带 `X-Modelflare-Skill`，不做服务端压缩（压缩端点来自 Modelflare 的目录），也不受机器人预算限制（预算是 Modelflare Key 的额度）。生图、生视频只有连着 Modelflare 时才有。
- 测试：`AMB_OFFICIAL_BASE_URL` 把所有厂商指向本地 mock（`test/official-providers.integration.test.ts`）。

## 界面

- 侧栏：机器人列表（头像 + 名称 + 最近一条消息），＋ 新建，右键 重命名 / 删除；列表分成可以新建、改名、删除、拖动排序的分组（默认「我的」和「上新」，存在服务端，各窗口共用），机器人、群聊和目录 Bot 可以拖到别的分组或用菜单里的「移到分组」，新上架的目录 Bot 自动进「上新」；左下角点头像看余额，点齿轮打开设置（`⌘/Ctrl+,`）。
- 群聊（`src/core/groups.ts`、`ui/screens/group.js`）：有两个以上机器人时，＋ 菜单里可以建群。每个成员在群里有自己的会话 `<机器人>:web:group:<群>`，模型、权限、记忆、审批、花费都和单聊走同一条路；用户的话存在会话 `group:<群>`，时间线由这些消息按 id 合并。@ 谁谁答（`@所有人` 全员），没 @ 时上一个回答的接着答；机器人回复里 @ 别的成员就接力，一条用户消息最多接力 6 次。同一个群一次只有一个机器人在答。
- 对话页：顶部悬浮的机器人名称胶囊打开信息面板（`⌘/Ctrl+⇧+I`：默认由它回复的渠道账号、待审批、任务和规则、记忆、最近会话，⚙ 进机器人设置）；回复流式显示（Markdown、代码块一键复制），可随时停止（`Esc`）；审批与提问以卡片形式出现在对话里；向上翻阅时不会被拉回底部。
- 命令面板 `⌘/Ctrl+K`；外观（跟随系统 / 浅色 / 深色）在 设置 → 常规。
- 语言：简体中文 / English / 日本語 / 한국어 / Русский / Español / Português (Brasil)，设置 → 常规 → 语言（引导页右上角、命令面板里也能切），默认跟随系统（系统语言不在已支持语言中时用英文）。偏好存在 config.json 的 `ui.lang`，托盘菜单、服务端报错和状态文字、机器人发到微信 / 飞书的系统消息（`/help`、审批提示等）都跟着它；命令行 / Docker 下"跟随系统"看 `AMB_LANG`，再看 `LC_ALL` / `LC_MESSAGES` / `LANG`，都没有时用简体中文。日志、发给模型的提示词和用户自己起的机器人名不翻译。
  - 界面文案在 `ui/locales/<语言>/<命名空间>.js`，代码里写 `t("命名空间.键", { 参数 })`（`ui/lib/i18n.js`）；服务端在 `src/i18n/messages/<命名空间>.ts`，键有类型检查。每个界面请求带 `x-amb-lang`，服务端在这个请求里用同一种语言回话。
  - 新增文案须补齐本次发布的所有目标语言；`node scripts/i18n-check.mjs [文件…]` 检查界面代码里有没有漏掉的中文、用到的键在不在、全部语言词典是否对齐（`npm test` 里的 `test/i18n.unit.test.ts` 也会查）。确需留在代码里的中文（字体名、匹配中文输入的正则）在那一行写 `// i18n-ignore`。
- 上手清单（新手引导）：对话空状态里是 6 步清单——打招呼、换模型、接到微信、让它动手、让它记住你、生成一张图。最后一步在引导里只放预置演示，不管账户有没有图片 / 视频模型都一样：和真的默认流程一样直接生成、图片显示在对话里，但不发给机器人、不调用模型、不扣费，图是客户端自带的 `ui/assets/guide-demo.svg`。目的是教会怎么操作，不替用户花钱；之后真的让它画图、收到图片也会算完成这一步。点「发送这句」直接试，点「带我去」或侧栏左下角的清单入口，会有一张引导卡片指着要点的地方（那里亮一圈）。做完自动打勾：对话里有了回复、换了模型、收到文件 / 图片、渠道连上、记忆写入；进度存在 config.json 的 `ui.guide`（接口 `/amb/api/guide`），老用户已经做过的步骤会自动算完成。清单可以收起到左下角或「不再显示」，设置 → 常规 → 上手清单 可以重新开始。 打招呼要有一条真正的回复（出错提示不算），渠道要真的连上（只填了配置不算）；「连接常用聊天工具」这一步可以选微信、飞书、Telegram、Slack、Discord，界面语言只决定推荐哪个。明确说「记住……」时回合后的记忆整理会马上做，不用等 90 秒。进度按用户分开存（登录了 Modelflare 按账户，存在 KV 的 `guide.owner.*`；没登录时仍写 config.json 的 `ui.guide`），全部做完是一个里程碑，之后自动收起、不再出现；自动弹出的引导卡片在输入框有草稿或任务运行时先不出来。
- 视觉：中性色与组件改编自 magpie 的界面（MIT），强调色为 Modelflare 荧光黄绿 `#d7ff00`。设计系统说明见 `ui/design/README.md`。

### 文档与网站预览

消息里的文件卡片、图片、HTTP(S) 链接和本地文件链接会打开右侧「预览」。普通对话、专业 Bot、群聊与历史消息共用入口；每个页面分别记住本次使用期间打开的内容，最多保留 12 项。面板支持切换、刷新、关闭、下载；桌面版还支持系统打开和在文件夹中显示。按 Ctrl/⌘ 点击网页链接仍使用浏览器的新标签页。

支持 Markdown、纯文本/代码、PDF、图片和 HTML。文本预览上限为 2 MB；Office 等不支持的格式保留下载与系统打开。外部网页使用隔离 iframe，网站可能禁止嵌入或要求登录，此时使用「打开 ↗」。不会通过反向代理绕过网站的嵌入限制。

文件读取沿用 `resolveFile` 的工作区/已交付文件边界。`GET /amb/api/conversations/:id/file/preview?path=` 返回预览描述，普通文件接口加 `download=1` 强制下载。生成的 HTML 经 `src/web/file-previews.ts` 获得 1 小时有效的随机访问地址；无需控制台 Cookie，只能读取入口文件所在目录内的允许类型资源，单个资源上限 32 MB。目录外、跨机器人、符号链接越界、硬链接和可执行附件均不开放；工作区外已交付的 HTML 只开放入口文件。HTML 使用不透明来源沙箱，可以加载相对 CSS、JS、图片及 HTTPS 静态资源，但不能访问控制台 API、父页面、表单提交或子框架。开发服务器、依赖后端接口的完整应用应通过外部网页入口访问。

预览状态与公共入口在 `ui/lib/resource-preview.js`，展示在 `ui/screens/resource-preview.js`。专业 Bot 的 `openFile`、`openUrl` 也进入该面板，仍保留用户点击/地址确认约束，文件权限仍限于 `app/`。

### 0.1.33：定时规则与机器人模板

侧栏时钟打开所有机器人的「定时」页。表单默认使用该机器人的桌面对话，支持先关闭；模板规则可暂不配置投递位置，启用时补选。聊天创建与修改的规则会附带卡片，撤销创建有 10 分钟恢复窗口；后续修改会使旧卡的撤销失效。调度、预算和撤销由 `src/tasks/` 统一管理，API 在 `src/web/routes/tasks.ts`。

日历类规则的补跑宽限最长 12 小时，每隔类不补跑；启动或唤醒约一分钟后只补最近一次。群日报读取所选群的消息，跨天补跑使用原定日期与截止时间。macOS 权限卡片保留原会话和草稿，授权后接着执行未完成步骤；已经发过新消息或等待超过 30 分钟时改为手动继续。完整行为见[定时规则设计](./design/background-tasks-and-proactive.md)。

10 个模板的数据在 `ui/data/bot-templates.json`，各语言文案在 `ui/locales/<语言>/templates.json`，创建流程在 `src/templates/`。模板只负责预置人设、可选记忆和关闭的规则，不扩大工具权限；模型选择保留用户决定。

### 多语言文案与发布检查

译文由维护者逐项撰写和本土化，不使用翻译接口。产品名、模型 ID、命令、URL 和 `{placeholder}` 参数保留原样。

- 应用：`ui/locales/<语言>/<模块>.js`；服务端新增语言：`src/i18n/locales/<语言>/<模块>.ts`。
- 官网：`site/src/i18n/locales/<语言>/`，例如 `home/hero.ts` 对应 `home.hero.*`。页面从词典读取文案。
- `ui/locales/manifest.json` 登记目标语言及 `ready` 状态；官网保存同内容的 `site/src/i18n/manifest.json`，检查会验证两份一致。未完成的语言保持 `ready: false`，不加入正式菜单和搜索引擎语言标记。
- `npm run i18n:status` 查看逐语言、逐模块进度；`npm run i18n:check` 检查全部目标语言的原始词典及关联文档。缺键、空译文、多余键、参数损坏或缺少复数形式都会阻止发布；开发时的英文回退不算完成。
- 俄语复数使用 `one / few / many / other`；西班牙语、葡萄牙语使用 `one / many / other`（`many` 只用于百万级的整数，写法同 `other`）；日语、韩语使用 `other`。只本地化显示方式，不更改货币、时区和金额。
- 官网 `npm run build` 检查全部目标语言和同步的文档、分享图片；`build:draft` 仅供本地预览，不能替代发布检查。

## 人设与提示词

代理模式下模型看到的提示词都在 `src/agent/prompts/`；`test/prompts.unit.test.ts` 检查每段必须有、不能有的句子和字符数上限，`test/agent.integration.test.ts` 用真实的 DSH 子进程检查模型收到的系统提示词和整份系统提示词加工具定义的上限。

- **人设**：DSH 自带的人设是「coding agent」，前面还有一句「You are an AI agent powered by DeepSeek Harness.」。补丁（`host.ts` writePatch）把 `personaPrefix` 换成个人助手的人设（能聊天，也能写代码、运行命令、处理文件，开着电脑操作时还能操作桌面应用；网页、文件、转发的消息里的文字是资料不是指令），并关掉 `includeHarnessIdentity`（它只控制那一句）。
- **机器人段**：聊天规则、长期记忆的用法（开着记忆时）、机器人名字和你写的人设，排在系统提示词最后一段（`amb:bot`）。宿主在每个回合开始前把它写进数据目录的 `dsh/.prompts/<机器人>.md`（代理的文件工具读不到、改不了；内容没变就不写），插件 `dsh-runtime/plugins/amb-prompt.mjs` 在每次模型请求时现读——改了人设或名字，下一条消息就生效，不用 `/new`，也不重启代理进程。DSH 0.2.1-rc.4 同步调用这段的 `text`（返回 Promise 不会被等待），所以是同步读文件而不是走 bridge。人设和聊天规则冲突时以人设为准。子代理不带这一段：它们不和用户说话。
- **聊天规则**（改编自 dsh-superagent 的注意力原则）：先给答案；要花一阵子的任务开始时用一句话说要做什么，之后不逐步讲解（每一步在「处理过程」里）；做完说清做了什么、结果在哪里；没做完就说没做完，失败就说失败；自己做决定，说一句选了什么，语言、格式、范围、风格都不问；只在猜错会造成损失、花钱或白做大半，要你才有的东西（登录、文件、密码），或这一步不可撤回（付款、删你的数据、给别人发消息）时才问，一次一个问题，有选项时用 `ask_user_question`；不说客套话；微信、飞书里回复要短。后台任务也一样：自己定，在结果里说明。
- **每段对话的第一条消息**：对话渠道（微信只显示纯文本，飞书和网页支持 Markdown）、当时的长期记忆快照、上一段的交接便条，再接你的消息。这些按会话不同（群记忆、渠道），记一条记忆就会变；放进系统提示词会让同一机器人所有会话共用的前缀缓存失效，所以留在这里，一段之内不变，之后的记忆变化用 `recall` 查。
- 前缀缓存：内容没变时系统提示词逐字节不变；人设变了只改最后一段，前面的部分照旧。升级前开始的对话第一条消息里还留着当时的人设，下一段（`/new` 或上下文管家换段）起不再有。

## 文件权限

代理模式下每个机器人有一个文件权限预设，在输入框左下角的权限胶囊或 机器人设置 → 权限 中切换，`/status` 会显示当前预设：

- **工作区可写**（默认）：命令在沙箱里运行，只能改这个机器人的工作区；越界操作先在聊天里问你。
- **只读**：不能改文件，命令在只读沙箱里运行。
- **完全权限**：给熟悉风险、嫌审批太多的用户。命令**不经沙箱**，以你的用户身份直接运行，越界操作不再请求批准——它可以读取和修改你电脑上的任何文件，包括 AnyModelBot 自己的数据目录（数据库、渠道令牌、密钥）。只有**递归删除**仍会先问你（同一套审批：微信回复编号、飞书 / 网页卡片）：`rm -r` / `-rf` / `--recursive`（含 `sudo`、`xargs`、`sh -c` 里的）、`find -delete`、`git clean`、`rsync --delete`，PowerShell 的 `Remove-Item` / `rm` / `del` / `rd` / `rmdir` 加 `-Recurse`（及其缩写），cmd 的 `rd /s`、`del /s`，`robocopy /MIR`，以及 Python `shutil.rmtree`、Node `fs.rm(…, { recursive })` 等常见写法；命令里点名的脚本文件也会检查。选它时界面会先弹出确认，权限胶囊和设置页用红色标出。
  - 这是防误删的保险，不是安全边界：检查的是命令文字，运行时才拼出来的命令（`eval "$(…)"`、`curl … | sh`）和 `make clean`、`npm run clean` 这类构建脚本看不到；拿不准时宁可多问。只在你信任当前模型和任务时开启。

## 谁能使用机器人

代理跑在你自己的电脑上（甚至可能是完全权限），所以默认**只有主人和你允许的人**能和机器人对话。按渠道账号分开算，能用这个账号的人可以和任何机器人聊（`src/core/access.ts`）：

- **主人**：微信是扫码登录的那个微信；飞书不管是扫码创建应用还是填 App ID / App Secret，连上之后**第一个给机器人发单聊消息的人**就是主人（先到先得）——连上后用你自己的飞书给机器人发一句话就完成绑定，这条消息照常回复。扫码时没拿到扫码者的微信也一样。机器人设置 → 谁能使用 里显示飞书主人，点「更换」（要确认）清掉主人，下一个发消息的人成为主人；换一个飞书应用或断开飞书时也会清掉。拒绝过的人不会成为主人。本机的网页对话不受限制。
- **其他人**发消息：只收到一句「你还没有被允许使用这个机器人，已通知主人」（同一个人每小时最多一次），不进队列、不调用模型、不花钱。请求出现在 设置 › 聊天渠道 里这个账号的「管理」（允许 / 拒绝），也会带 4 位配对码发给主人（每个账号每小时最多 3 条；主人 24 小时内在那个渠道说过话才发得出去），主人在聊天里回复「同意 1234」/「拒绝 1234」即可。配对码不会和工具审批的编号撞。被拒绝的人之后发什么都不回。
- 允许名单在 设置 › 聊天渠道 里这个账号的「管理」，可以移除（移除后他再发消息会重新申请）；`/status` 也会显示。
- 升级时，已经和机器人有单聊会话的人自动加入允许名单（标为「升级前已在使用」），不会被拦在外面；换一个微信重新扫码时，原来的主人也留在名单里。
- 群聊：目前没有渠道接入群聊（飞书只处理单聊，微信 iLink 没有群），群消息不受名单限制、保持原样；接入群聊时要在 `access.ts` 里补规则。

## 消息不会丢

最终回复、交付的文件、审批提示和通知先写进本地数据库的出站队列再发送（`src/core/outbox.ts`；流式卡片的中间内容和“正在输入”除外）：

- 同一会话按顺序一条一条发；网络或平台临时出错时自动重试（5 秒起，逐步拉长到 5 分钟），渠道没连上时等它连上。
- 应用退出或崩溃后，重启时接着发，已经发出去的不会再发（长回复分段发，从没发的那段接着发）。每条消息的 id 由收到的那条消息推出来，同一条消息被平台重复投递也只有一个最终回复；只有恰好在发送途中崩溃的那一段可能再发一次——它带着固定的飞书 `uuid`（飞书 1 小时内去重）和微信 `client_id`。
- 微信只能在对方 24 小时内发过消息时回复，每条消息之后最多回 10 条。这时发不了的消息不丢，先留着（held），等对方下次发消息时先发出去：几条文字合成一条「你不在时：…」（一条微信放得下就合，文件照原样），排在这次的回复前面，顺序不变、只发一次。留着的最多 7 天；“收到”、审批提示这类过一会儿就没意义的照旧按自己的期限。
- 再也发不出去的（平台多次拒绝、等待太久）标记出来并写明原因，记在日志和诊断信息里。

## 后台任务和规则

要跑一阵子的事在后台做，不占聊天（设计见 `docs/design/background-tasks-and-proactive.md`，代码在 `src/tasks/`）：

- **后台任务**：聊天代理用 `task_start` 开一个任务（自己的 DSH 会话 `task-<id>` 和工作区里的文件夹 `tasks/<名字>-<id6>/`），一句话说清在后台做什么；做完把结果发回原会话（微信引用、飞书回复那条消息可以接着问）。中途要问你的，一个会话一次只推一个问题。应用重启后接着做，已经做过的外部动作先查再做。`/tasks` 列出任务和规则，`/stop 编号` 停一个。
- **规则**：`rule_create` 或 机器人设置 › 主动消息 › 规则 建好，直接执行：你的原话就是授权，到点去查，有值得说的才发一句；改了原话也照样执行。观察要自己选（跟机器人说「先观察」，或在规则编辑器里选观察）：只读，不发消息，只记「本会发送」，好好观察 3 次后在「需要你」里问要不要改为执行。每次运行一个新会话，运行记录可以导出成 Markdown。
- **看得到、不打扰**：信息面板的「任务」组列着这个机器人的任务和规则（结束了的收在「已结束」里），点开看来自哪、最新进展、预算、文件夹和每次运行的处理过程；所有在等你的事在侧栏的「需要你」里。只推结果、要你决定的事和失败；免打扰（默认 22:00–08:00）、每天上限（微信 3 条、飞书 5 条）、合并成摘要都在 机器人设置 › 主动消息。
- **预算**：任务默认 $1，规则每次 $0.10、每月 $3（估算，按 Modelflare 的参考价）。用完时停下问你；任务详情里能改任务的预算，规则编辑器里能改规则的。机器人的预算 Key 剩不到 20% 时停后台工作，留给聊天。
- **暂停**：机器人设置 › 主动消息 › 暂停后台工作（或跟机器人说），任务和规则先停、主动消息排着，聊天照常。
- **保留与清理**：任务和运行记录留 30 天，30 天没动过的任务归档。任务文件夹 30 天没动过就删除，连同 DSH 里它的会话记录（`dsh/<机器人>/sessions/` 下；SDK 没有删会话的接口，由应用直接删，会话还开在代理进程里的等进程换过再删）；不问你、不发通知：第 27 天定下删除的日期，任务详情里写着，可以保留（至少 3 天后才删）。任务详情里能看到文件夹多大，也能直接删掉任务（连同文件夹）。

## 电脑操作（Computer Use）

每个机器人可在 机器人设置（信息面板的 ⚙）→ 电脑操作 中开关、选择后端和审批方式；`/status` 与设置页会显示当前后端、是否可用及原因。

- **后端**
  - **Cua Driver（默认，三平台）**：随安装包附带官方预编译的 [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) 0.37.0（MIT），构建时由 `scripts/fetch-cua-driver.mjs` 按平台/架构下载并校验 SHA256。作为内置 MCP 服务器 `cua-driver mcp` 运行，始终使用 `CUA_DRIVER_PERMISSION_MODE=bounded` + 能力清单，**从不**使用 `--dangerously-bypass-approvals`；子进程环境经过清理，不传任何密钥，关闭遥测，禁用 `run_script`。只开放所需的 24 个工具（读取窗口/截图、启动应用、点击、输入、按键、组合键、滚动、拖拽、设值、菜单等），其余工具（脚本、结束进程、剪贴板、浏览器注入、录制、更新等）对模型不可见且会被拒绝。清单列出本机已安装的图形应用（Linux 读 .desktop、macOS 读 /Applications、Windows 读开始菜单），并允许整屏输入；清单最长 24 小时有效，到期前自动重启驱动。
  - **Codex Computer Use 桥（可选，仅 macOS）**：kimi-computer-use，需要本机已安装 OpenAI Codex Computer Use；不可用时自动回退到 Cua Driver。
- **审批**：默认所有电脑操作（读取、截图、点击、输入、按键、滚动、拖拽、设值）**自动执行，无需审批**；可选「点击、输入等改变界面的操作先问我」（读取界面仍自动）。升级时已有机器人（含默认机器人）会被迁移为自动执行。权限预设为「只读」的机器人只开放读取类工具。
- **平台说明**
  - macOS：需在「系统设置 → 隐私与安全性」中给本应用授予「辅助功能」与「屏幕录制」权限；以 `--direct` 方式运行驱动（尚未在真机验证）。 缺这两项时，机器人调用电脑操作工具会被拦下，这一轮结束并说明「因缺少权限未能继续」，对话里按缺的那一项显示授权卡片（系统原生请求、打开对应的系统设置页、重新检测；屏幕录制改完通常要重新打开应用，卡片上可以直接重新打开，输入框里的草稿会带回来）。首次启动不索要任何权限。
  - Linux：X11 下通过 AT-SPI 读取界面（需要 at-spi2-core，应用需开启无障碍）；Wayland 会降级——只能操作 XWayland 应用的前台窗口，界面会给出提示。没有图形会话（DISPLAY/WAYLAND_DISPLAY）时不可用。
  - Windows：必须在已登录用户的交互式桌面会话中运行（服务/计划任务的非交互会话不可用）。
- 截图只发给（支持视觉的）模型使用，不会被转发到微信/飞书聊天中；只有用户要求时才会作为文件发送。
- 未打包：cua-perception、OmniParser（AGPL）以及任何 Cua Spaces（FSL）组件。

## 飞书应用配置

最省事的办法：设置 › 聊天渠道 → 飞书 →「连接」，用飞书扫码，自动创建机器人应用，然后在飞书里给它发条消息。

想用已有的企业自建应用，点「用已有应用」，按下面的步骤配置：

1. 打开 [飞书开放平台](https://open.feishu.cn/app) → 创建企业自建应用，添加「机器人」能力。
2. 权限管理开通：
   - `im:message.p2p_msg:readonly`（读取用户发给机器人的单聊消息）
   - `im:message:send_as_bot`（以应用身份发消息）
   - `cardkit:card:write`（创建与更新卡片，用于流式回复）
   - `im:message.history:readonly`（读取会话历史消息：飞书长连接不补推离线时发来的消息，程序启动、断线重连时从历史里补上 7 天内有过来往的单聊里、24 小时内的消息，每个会话最多 20 条；没开也能用，只是补不上，会提示一次）
3. 先在本程序 设置 › 聊天渠道 → 飞书 →「连接」→「改用已有应用」里填入 App ID / App Secret 并保存（长连接需要程序在线才能保存下一步）。
4. 事件与回调 → 订阅方式选「**使用长连接接收事件**」，添加事件 `im.message.receive_v1`。
5. 发布版本并在可用范围内添加自己，然后用你自己的飞书私聊机器人发一句话：连上后第一个发消息的人就是飞书主人（见「谁能使用机器人」）。

说明：当前只处理单聊（p2p），群聊消息会被忽略。

## 微信（iLink）

- 设置 › 聊天渠道 → 微信 →「连接」，用微信扫描二维码并确认；或命令行 `npm run weixin:login`（终端显示二维码，同时保存 PNG 到数据目录）。
- 登录态、同步游标、context_token 保存在数据目录，重启后自动续用。
- 平台限制：用户每发来一条消息后 24 小时内最多可回复 10 条；回复在生成结束后一次发出，超过 4000 字自动分段；生成期间显示“正在输入”。
- 图片、文件、视频：用户发来（或引用）的会从微信 CDN 下载解密（单个最大 50 MB）。代理模式下存进机器人工作区的 `inbox/`，消息里写明路径，代理可以读取、处理或当生图的参考图；能看图的模型（Claude、GPT-5/6、Gemini、Grok 4、Kimi K3、Muse Spark 等）同时直接收到图片本身，其余模型只拿到路径。Linux 版代理暂不直接收图（sharp 在 Electron 下会崩溃），只给路径。机器人交付的文件（present）按图片或文件发回微信。
- 登录过期（错误码 -14）时自动暂停并在界面提示，重新扫码即可。

## 开发与测试

```bash
npm run typecheck
npm test            # 单元测试 + 离线端到端（模拟飞书/iLink/Modelflare，含流式对话与停止）+ 内置网关集成测试（需已编译 magpie）
npm run docs:check  # README 自检：素材是否存在与体积、中英文结构一致、相对链接与锚点、禁用词、alt
```

README 的素材清单与录制规范见 [docs/assets/README.md](./assets/README.md)。

目录 Bot（带专属界面的预制 Bot）的开发见 [docs/bot-framework.md](./bot-framework.md)。

## 许可

MIT，见 `LICENSE`；第三方组件（magpie MIT——含界面样式改编、Tencent openclaw-weixin MIT 等）见 `THIRD_PARTY_NOTICES.md`，也可在 设置 → 关于 中查看。

## 用户技能与聊天记录搜索

用户入口与 ZIP 格式见[技能使用说明](./skills.md)。`src/skills/archive.ts` 校验 ZIP 路径、解压上限和 `SKILL.md`，`service.ts` 按机器人保存包、启用状态和版本指纹；`src/web/skills.ts` 提供预览与管理接口。DSH 空闲后部署启用项，变更不会中断运行中的回合、子代理或后台命令。`src/botkit/installer.ts` 在目录 Bot 升级时检查用户技能重名。

`src/store/chat-search.ts` 在 SQLite 中维护消息搜索索引，提供过滤、分页与原消息上下文；`ui/screens/message-search.js` 是全局搜索，`ui/components/chat-search.js` 负责当前聊天查找。搜索直接读取本机数据库，不经过模型。

相关测试：`test/skills*.test.ts`、`test/chat-search*.test.ts`。浏览器验收可使用 `AMB_TEST_CHROME` 指定 Chromium 路径；有 DSH 运行时时还会验证技能发现、加载、资源读取及运行中停用。
