# AnyModelBot

任意模型的个人 AI 助手：一个机器人 = 人设 + 默认模型 + 渠道（飞书 / 微信）。
模型来自 **[Modelflare](https://modelflare.dev)**：首次启动登录（或注册）Modelflare 账户，GPT、Claude、Grok、Gemini 等模型自动列出；也可以直接粘贴一个 API Key。
请求经过内置的 [magpie](https://github.com/yetone/magpie) 网关转发（实现细节，界面里不出现）。

- 飞书：官方机器人，长连接（WSClient）接收事件，CardKit 流式卡片回复
- 微信：官方 iLink 通道（移植自 Tencent/openclaw-weixin），扫码登录
- 三种运行方式，同一套代码：**桌面版（Electron）**、**命令行 `npm start`**、**Docker**

> 定位：自用、单用户。每个机器人对应一个飞书应用。

## 目录

```
src/
  core/        统一消息类型、会话队列与去重、运行时（/model /reset、流式）
  llm/         OpenAI 兼容客户端（模型接入接口）
  magpie/      内置 magpie 守护：隔离目录、空闲端口、自动生成密钥、健康检查、崩溃重启、干净退出
  channels/    feishu/（长连接 + CardKit）  weixin/（iLink，MIT 声明见 LICENSE.openclaw-weixin）
  store/       SQLite（node:sqlite，无需原生编译）
  modelflare.ts  Modelflare 线路、密钥校验（GET /v1/models）、模型路由与归因
  account/     Modelflare 账户：PKCE 回环登录、令牌轮换、余额与提醒、机器人预算 Key、模型能力与参考价
  web/         管理界面服务（JSON API + 流式对话 SSE）
  cli/         init 首次设置向导、weixin-login
  main.ts      命令行入口
electron/      桌面版主进程（启动器 + 托盘）
ui/            管理界面（Preact + htm，无构建步骤）：tokens.css、css/、lib/、components/、screens/、main.js
scripts/       setup / build-magpie / fetch-cua-driver / electron-smoke
vendor/magpie  magpie 源码（git 子模块，构建时编译）
```

## 快速开始（命令行）

需要 Node.js 22.13+、Go 1.26.8+（用于从源码编译 magpie）。

```bash
npm install
npm run setup        # 拉取 vendor/magpie 子模块并编译到 build/bin/
npm run init         # 可选：终端里的首次设置（登录 Modelflare 账户或粘贴 API Key、飞书凭据）
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

- 数据目录：`<userData>/data`（macOS `~/Library/Application Support/anymodel bot/data`，Windows `%APPDATA%\anymodel bot\data`，Linux `~/.config/anymodel bot/data`）
- 单实例；关闭窗口默认隐藏到托盘（设置 → 常规 可改为退出）；托盘菜单：打开 / 在浏览器中打开 / 开机自启（macOS、Windows）/ 打开数据目录 / 退出
- macOS 下窗口无标题栏，红绿灯嵌在侧栏顶部；窗口最小宽度 860
- 界面只监听 127.0.0.1，且每次启动生成随机访问令牌，其他本机程序无法直接调用管理接口
- 退出时先停渠道、再停 magpie；若上次被强杀残留 magpie 进程，下次启动会自动清理（Linux/macOS）

## Docker

```bash
git submodule update --init --depth 1 vendor/magpie
docker build -t anymodel-bot .
docker run -d --name amb -p 3600:3600 -v amb-data:/data anymodel-bot
docker exec amb cat /data/ui-token     # 打开 http://<主机>:3600/?token=<令牌>
```

容器内界面监听 0.0.0.0，因此强制令牌访问。微信扫码在对话页的信息面板（点顶部机器人名称）→「渠道」里完成。

## 模型（Modelflare）

- 首次启动只有一个按钮「登录 / 注册 Modelflare」：在系统浏览器里登录（没有账户可当场注册）并点「继续」授权，回到本程序后自动为这台电脑签发一把专用 API Key 并连接 → 选默认模型 → 开始对话。Docker 或远程部署收不到浏览器登录的回调，首次启动页改为填写 API Key（校验 `GET https://modelflare.dev/v1/models`）。
- 登录方式：OIDC 授权码 + PKCE（RFC 7636），按 RFC 8252 作为原生应用——本程序是公共客户端（`client_id` 为 `anymodel-bot`，没有也不需要客户端密钥），授权结果回调到本机 `127.0.0.1` 的临时端口。在 Modelflare 网页个人资料页的「已授权的应用」里可以随时撤销；撤销后本程序会发现并回到登录页。
- 账户凭据（refresh token）存在数据目录的 `modelflare-account.json`（权限 600），桌面版用系统钥匙串加密（Electron safeStorage）；界面只拿到账户名称。「退出登录」会撤销这台电脑的授权，Modelflare 同时删除登录时为它和各机器人签发的 Key。
- 余额：侧栏左下角和 设置 → Modelflare 显示账户钱包余额（只用 API Key 时读 `/v1/dashboard/billing/credit_grants`）；「充值」打开 Modelflare 网页，回到窗口时自动刷新。余额低于提醒线（默认 $1，可改或关闭）时在应用里提醒一次，也可以设置让机器人发到你的微信 / 飞书。
- 登录后还能在 设置 → Modelflare 查看按天、按模型的用量，Modelflare 发来的通知，以及复制邀请链接。
- 机器人预算（需要登录）：机器人设置 → 预算，开启后这个机器人用自己的 Key（内置网关里单独的 provider），最多花设定的美元数；关闭后回到共用的 Key。
- 生图 / 生视频：代理模式下机器人有 `generate_image`、`generate_video` 工具，由本程序带着该机器人用的 Key 调 Modelflare，结果存进机器人工作区的 `media/`，再交付到聊天。
- 模型选择器里显示上下文长度、视觉 / 工具 / 推理能力，以及每百万 tokens 输入 / 输出的起步参考价（来自公开价格目录，以账单为准）。
- 调用归因：经 Modelflare 的请求都带 `X-Modelflare-Skill: anymodel-bot/<版本>`，链接都带 `utm_source=anymodelbot`。
- 线路：默认国际线路 `https://modelflare.dev/v1`；中国大陆可在「高级」或 设置 → Modelflare → 线路 选「中国大陆优化」（`https://origin.modelflare.dev/v1`）。线路由你选定，不自动切换。
- 设置 → Modelflare：账户、余额与充值、余额提醒、用量、通知、邀请；连接状态（只显示 Key 尾号）；未登录时可更换密钥或断开（机器人与会话保留，断开后回到首次连接页）；默认模型、刷新模型列表。
- 对话中输入框右侧的模型按钮可为当前会话切换模型（也可设为机器人默认）；`/model`、`/reset`、`/new`、`/status`、`/help` 照常可用。
- 内置网关：magpie 以 `--gateway` 模式运行，使用本程序数据目录内独立的 HOME/配置目录；**不读取**你电脑上已有的 Claude/Codex 等订阅凭据，**不改写**任何 agent 配置，关闭自动更新与账户发现。它只供本进程内部调用，界面不再反代它的页面或 `/v1`。
- API Key 只保存在内置网关的隔离配置中，不经过命令行参数、不写日志，前端只拿到尾号。
- 开发/测试：设置 `AMB_MAGPIE_BASE_URL` 可直接使用一个 OpenAI 兼容端点（不启动内置网关，界面视为已连接，账户功能不可用）；`AMB_MODELFLARE_BASE_URL` 可把 Modelflare 基址指向本地 mock，`AMB_MODELFLARE_ISSUER` 把登录与账户接口指向本地 mock。

## 界面

- 侧栏：机器人列表（头像 + 名称 + 最近一条消息），＋ 新建，右键 重命名 / 删除；左下角账户按钮打开设置（`⌘/Ctrl+,`）。
- 对话页：顶部悬浮的机器人名称胶囊打开信息面板（`⌘/Ctrl+⇧+I`：渠道、待审批、记忆、最近会话，⚙ 进机器人设置）；回复流式显示（Markdown、代码块一键复制），可随时停止（`Esc`）；审批与提问以卡片形式出现在对话里；向上翻阅时不会被拉回底部。
- 命令面板 `⌘/Ctrl+K`；外观（跟随系统 / 浅色 / 深色）在 设置 → 常规。
- 视觉：中性色与组件改编自 magpie 的界面（MIT），强调色为 Modelflare 荧光黄绿 `#d7ff00`。

## 电脑操作（Computer Use）

每个机器人可在 机器人设置（信息面板的 ⚙）→ 电脑操作 中开关、选择后端和审批方式；`/status` 与设置页会显示当前后端、是否可用及原因。

- **后端**
  - **Cua Driver（默认，三平台）**：随安装包附带官方预编译的 [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) 0.37.0（MIT），构建时由 `scripts/fetch-cua-driver.mjs` 按平台/架构下载并校验 SHA256。作为内置 MCP 服务器 `cua-driver mcp` 运行，始终使用 `CUA_DRIVER_PERMISSION_MODE=bounded` + 能力清单，**从不**使用 `--dangerously-bypass-approvals`；子进程环境经过清理，不传任何密钥，关闭遥测，禁用 `run_script`。只开放所需的 24 个工具（读取窗口/截图、启动应用、点击、输入、按键、组合键、滚动、拖拽、设值、菜单等），其余工具（脚本、结束进程、剪贴板、浏览器注入、录制、更新等）对模型不可见且会被拒绝。清单列出本机已安装的图形应用（Linux 读 .desktop、macOS 读 /Applications、Windows 读开始菜单），并允许整屏输入；清单最长 24 小时有效，到期前自动重启驱动。
  - **Codex Computer Use 桥（可选，仅 macOS）**：kimi-computer-use，需要本机已安装 OpenAI Codex Computer Use；不可用时自动回退到 Cua Driver。
- **审批**：默认所有电脑操作（读取、截图、点击、输入、按键、滚动、拖拽、设值）**自动执行，无需审批**；可选「点击、输入等改变界面的操作先问我」（读取界面仍自动）。升级时已有机器人（含默认机器人）会被迁移为自动执行。权限预设为「只读」的机器人只开放读取类工具。
- **平台说明**
  - macOS：需在「系统设置 → 隐私与安全性」中给本应用授予「辅助功能」与「屏幕录制」权限；以 `--direct` 方式运行驱动（尚未在真机验证）。
  - Linux：X11 下通过 AT-SPI 读取界面（需要 at-spi2-core，应用需开启无障碍）；Wayland 会降级——只能操作 XWayland 应用的前台窗口，界面会给出提示。没有图形会话（DISPLAY/WAYLAND_DISPLAY）时不可用。
  - Windows：必须在已登录用户的交互式桌面会话中运行（服务/计划任务的非交互会话不可用）。
- 截图只发给（支持视觉的）模型使用，不会被转发到微信/飞书聊天中；只有用户要求时才会作为文件发送。
- 未打包：cua-perception、OmniParser（AGPL）以及任何 Cua Spaces（FSL）组件。

## 飞书应用配置

1. 打开 [飞书开放平台](https://open.feishu.cn/app) → 创建企业自建应用，添加「机器人」能力。
2. 权限管理开通：
   - `im:message.p2p_msg:readonly`（读取用户发给机器人的单聊消息）
   - `im:message:send_as_bot`（以应用身份发消息）
   - `cardkit:card:write`（创建与更新卡片，用于流式回复）
3. 先在本程序信息面板的「渠道 → 飞书」里填入 App ID / App Secret 并保存（长连接需要程序在线才能保存下一步）。
4. 事件与回调 → 订阅方式选「**使用长连接接收事件**」，添加事件 `im.message.receive_v1`。
5. 发布版本并在可用范围内添加自己，然后在飞书里私聊机器人。

说明：当前只处理单聊（p2p），群聊消息会被忽略。

## 微信（iLink）

- 信息面板「渠道」→ 微信 → 「扫码登录」，用微信扫描二维码并确认；或命令行 `npm run weixin:login`（终端显示二维码，同时保存 PNG 到数据目录）。
- 登录态、同步游标、context_token 保存在数据目录，重启后自动续用。
- 平台限制：用户每发来一条消息后 24 小时内最多可回复 10 条；回复在生成结束后一次发出，超过 4000 字自动分段；生成期间显示“正在输入”。
- 登录过期（错误码 -14）时自动暂停并在界面提示，重新扫码即可。

## 开发与测试

```bash
npm run typecheck
npm test            # 单元测试 + 离线端到端（模拟飞书/iLink/Modelflare，含流式对话与停止）+ 内置网关集成测试（需已编译 magpie）
```

## 许可

MIT，见 `LICENSE`；第三方组件（magpie MIT——含界面样式改编、Tencent openclaw-weixin MIT 等）见 `THIRD_PARTY_NOTICES.md`，也可在 设置 → 关于 中查看。
