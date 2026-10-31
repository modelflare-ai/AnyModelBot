# 开发文档

简体中文 | [English](./development_en.md)

这份文档给想从源码运行、打包或参与开发的人看。普通用户直接从 [Releases](https://github.com/modelflare-ai/AnyModelBot/releases) 下载安装包即可，见 [README](../README.md#-下载)。

- 一个机器人 = 人设 + 默认模型 + 渠道（飞书 / 微信）。定位：自用、单用户；每个机器人对应一个飞书应用。
- 模型来自 [Modelflare](https://modelflare.dev)：首次启动登录（或注册）Modelflare 账户，模型自动列出；也可以直接粘贴一个 API Key。请求经过内置的 [magpie](https://github.com/yetone/magpie) 网关转发。
- 三种运行方式，同一套代码：**桌面版（Electron）**、**命令行 `npm start`**、**Docker**。

## 目录结构

```
src/
  core/          统一消息类型、会话队列与去重、运行时（/model /reset、流式）、重启后的提醒
  agent/         代理模式：DSH 宿主与桥接、审批、权限预设、记忆与上下文管家、生图 / 生视频、电脑操作、Windows PowerShell
    prompts/     交给代理模型的全部提示词：人设、聊天规则、记忆说明、每段第一条消息、技能说明
  llm/           OpenAI 兼容客户端（模型接入接口）
  magpie/        内置 magpie 守护：隔离目录、空闲端口、自动生成密钥、健康检查、崩溃重启、干净退出
  channels/      feishu/（长连接 + CardKit）  weixin/（iLink，MIT 声明见 LICENSE.openclaw-weixin）
  store/         SQLite（node:sqlite，无需原生编译）
  account/       Modelflare 账户：PKCE 回环登录、令牌轮换、余额与提醒、机器人预算 Key、模型能力与参考价
  web/           管理界面服务（JSON API + 流式对话 SSE）
  cli/           init 首次设置向导、weixin-login
  modelflare.ts  Modelflare 线路、密钥校验（GET /v1/models）、模型路由与归因
  diagnostics.ts 故障排查：探测、日志尾部、脱敏的诊断报告
  main.ts        命令行入口
electron/        桌面版主进程（启动器 + 托盘）
ui/              管理界面（Preact + htm，无构建步骤）
  design/        设计系统：tokens/、base/、components/、机器人形象 bots/
  css/ lib/ components/ screens/ assets/ main.js
dsh-runtime/     DSH 代理运行时的依赖清单与 AnyModelBot 插件（plugins/）
scripts/         setup / build-magpie / fetch-cua-driver / prepare-dsh / bundle-dsh / electron-smoke / check-readme 等
vendor/          git 子模块：magpie（构建时编译）、deepseek-harness、kimi-computer-use
docs/            开发文档、隐私说明、README 素材（docs/assets/）
```

## 从源码运行（命令行）

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
- Windows 上代理执行命令用的 PowerShell：经沙箱时 Windows PowerShell 5.1 每条命令要二三十秒，PowerShell 7 约 1 秒。应用按这个顺序选：系统里能用的 PowerShell 7（后台按 DSH 的方式试运行一次，什么都不下载）→ 应用内置的 PowerShell 7 → Windows PowerShell 5.1。没有能用的 7 且代理模式开着时，应用在后台自动下载官方 PowerShell 7.6.9（LTS）的 zip，装到 `%LOCALAPPDATA%\AnyModelBot\pwsh\`：不需要管理员权限，不写注册表、不改 PATH，不影响你自己的 PowerShell。版本和 x64 / arm64 两个 zip 的 SHA256 写死在 `src/agent/pwsh-private.ts`（升级用 `node scripts/pwsh-hashes.mjs <版本>`），下载后核对哈希、解压后核对微软 Authenticode 签名，再按 DSH 的方式试运行（版本、读写临时文件、拉起外部程序）通过才用；装失败或装了一半的不会被用，下次启动会清掉。装的时候对话页和 设置 → 常规 显示进度，`/status` 也有，装好之前命令照常用 5.1；装好后空闲的代理进程在后台换用它，不用重启应用。运行中代理拉不起它（被杀毒软件删除或隔离、被策略拦截）就自动退回上一种并提示原因；设置 → 故障排查 可以安装、重新安装、改回系统默认。Windows 10 1607 / Server 2016 以前的系统不下载。桌面版下载走系统代理（Chromium 网络栈）；命令行版用 Node 的 fetch（较新的 Node 设 `NODE_USE_ENV_PROXY=1` 后认 `HTTPS_PROXY`）；`AMB_PWSH_MIRROR` 可换成镜像前缀（照样核对哈希和签名），`AMB_PWSH_AUTO_INSTALL=0` 关掉自动安装。
- 数据目录：`<userData>/data`（macOS `~/Library/Application Support/anymodel bot/data`，Windows `%APPDATA%\anymodel bot\data`，Linux `~/.config/anymodel bot/data`）。日志在数据目录的 `logs/app.log`。
- 单实例；关闭窗口默认隐藏到托盘（设置 → 常规 可改为退出）；托盘菜单：打开 / 在浏览器中打开 / 开机自启（macOS、Windows）/ 打开数据目录 / 退出。
- macOS 下窗口无标题栏，红绿灯嵌在侧栏顶部；窗口最小宽度 860。
- 界面只监听 127.0.0.1，且每次启动生成随机访问令牌，其他本机程序无法直接调用管理接口。
- 退出时先停渠道、再停 magpie；若上次被强杀残留 magpie 进程，下次启动会自动清理（Linux/macOS）。

发布：改 `package.json` 的版本号并提交，推送 `v<版本>` 标签，`.github/workflows/release.yml` 会在六种系统 / 架构上各自打包，并把安装包和 `SHA256SUMS` 发到 GitHub Release。签名与公证所需的仓库密钥见该文件开头的注释。

## Docker

```bash
git submodule update --init --depth 1 vendor/magpie
docker build -t anymodel-bot .
docker run -d --name amb -p 3600:3600 -v amb-data:/data anymodel-bot
docker exec amb cat /data/ui-token     # 打开 http://<主机>:3600/?token=<令牌>
```

容器内界面监听 0.0.0.0，因此强制令牌访问。不要把 3600 端口直接暴露到公网。微信扫码在对话页的信息面板（点顶部机器人名称）→「渠道」里完成。

## 模型（Modelflare）

- 首次启动只有一个按钮「登录 / 注册 Modelflare」：在系统浏览器里登录（没有账户可当场注册）并点「继续」授权，回到本程序后自动为这台电脑签发一把专用 API Key 并连接 → 选默认模型 → 开始对话。Docker 或远程部署收不到浏览器登录的回调，首次启动页改为填写 API Key（校验 `GET https://modelflare.dev/v1/models`）。
- 登录方式：OIDC 授权码 + PKCE（RFC 7636），按 RFC 8252 作为原生应用——本程序是公共客户端（`client_id` 为 `anymodel-bot`，没有也不需要客户端密钥），授权结果回调到本机 `127.0.0.1` 的临时端口。在 Modelflare 网页个人资料页的「已授权的应用」里可以随时撤销；撤销后本程序会发现并回到登录页。
- 账户凭据（refresh token）存在数据目录的 `modelflare-account.json`（权限 600），桌面版用系统钥匙串加密（Electron safeStorage）；界面只拿到账户名称。「退出登录」会撤销这台电脑的授权，Modelflare 同时删除登录时为它和各机器人签发的 Key。
- 余额：侧栏左下角和 设置 → Modelflare 显示账户钱包余额（只用 API Key 时读 `/v1/dashboard/billing/credit_grants`）；「充值」打开 Modelflare 网页，回到窗口时自动刷新。余额低于提醒线（默认 1 美元，可改或关闭）时在应用里提醒一次，也可以设置让机器人发到你的微信 / 飞书。
- 登录后还能在 设置 → Modelflare 查看按天、按模型的用量，Modelflare 发来的通知，以及复制邀请链接。
- 机器人预算（需要登录）：机器人设置 → 预算，开启后这个机器人用自己的 Key（内置网关里单独的 provider），最多花设定的美元数；关闭后回到共用的 Key。
- 生图 / 生视频：代理模式下机器人有 `media_models`（可用模型、默认模型、参数范围、参考价）、`media_docs`（从 docs.modelflare.dev 实时读该模型的请求格式）、`generate_image`、`generate_video` 四个工具，并自带一份 media 技能说明。各模型的参数格式不同，机器人按文档写请求体，工作区里的参考图写成 `workspace:路径` 即可；Key 始终只在本程序里，由本程序带着该机器人用的 Key 调 Modelflare，结果存进机器人工作区的 `media/`，再交付到聊天。
- 生成前确认：用默认模型、预计花费不超过 $0.5 时直接生成，不打扰你。只在这几种情况先在聊天里问你这次用哪个模型（附提示词、参数、参考价和为什么问）：机器人要换用不是默认的模型（你点名的除外，代理传 `confirm: false`）、预计花费超过 $0.5（按参考价、张数、视频时长和分辨率估算；视频估不出来也问）、要求不明确（代理传 `confirm: true`）。可以确认、换成别的模型或取消；微信回复编号或模型名，飞书 / 网页点选。10 分钟内没回答就不生成。想每次都确认：机器人设置 → 生图 / 生视频 → 生成前确认 →「每次都问」。
- 默认图片 / 视频模型：首次设置时和默认文本模型一起选，之后在 设置 → Modelflare 修改；选「自动」时用推荐顺序里第一个不需要参考素材的模型。
- 模型选择器里显示上下文长度、视觉 / 工具 / 推理能力，以及每百万 tokens 输入 / 输出的起步参考价（来自公开价格目录，以账单为准）。
- 调用归因：经 Modelflare 的请求都带 `X-Modelflare-Skill: anymodel-bot/<版本>`，链接都带 `utm_source=anymodelbot`。
- 线路：默认国际线路 `https://modelflare.dev/v1`；中国大陆可在「高级」或 设置 → Modelflare → 线路 选「中国大陆优化」（`https://origin.modelflare.dev/v1`）。线路由你选定，不自动切换。
- 设置 → Modelflare：账户、余额与充值、余额提醒、用量、通知、邀请；连接状态（只显示 Key 尾号）；未登录时可更换密钥或断开（机器人与会话保留，断开后回到首次连接页）；默认模型、刷新模型列表。
- 对话中输入框右侧的模型按钮可为当前会话切换模型（也可设为机器人默认）；`/model`、`/reset`、`/new`、`/status`、`/stop`、`/help` 照常可用。
- 处理过程：代理回合的每一步（模型请求及用时与 tokens、工具调用及参数与输出、重试、子代理）折叠在回复上方的"用时"一行里，点开查看；微信 / 飞书会话在信息面板 → 最近会话里看，正在处理的那一轮实时显示并可中止。
- 卡住的消息：`/stop`（任何渠道）或信息面板里的「中止」立即结束正在处理的回合；代理 10 分钟没有任何进展（模型不回、工具不动、只在重试；等你批准或回答不算）会自动中止，单回合最长 30 分钟（`AMB_AGENT_IDLE_TIMEOUT_MS`、`AMB_AGENT_TURN_TIMEOUT_MS` 可调）。DSH 没有中断单个回合的接口，中止时会重启该机器人的代理进程。前一条还在处理时发来的新消息会先收到一句提示；`/status` 显示它走到了哪一步、多久没有进展。网页对话里切到别的机器人或刷新窗口不会打断正在处理的消息，回来时接着显示（你的消息、到目前为止的回复和处理过程）；停止按钮在排队、代理启动中、等你批准时也能用，纯对话也一样。
- 重启后的提醒：应用退出或崩溃时还没处理完的消息（每个会话在数据库里留一个处理中的标记，处理完就删），下次启动时在原会话里说一次「上次的消息「…」因为应用重启没有处理完，请重新发送」，不会自动重发。网页对话记进会话历史；微信用存下的 context_token 发送、占用同一份回复配额，超过 24 小时窗口或配额用完时等你在那个会话里发下一条消息时先说；飞书发到原单聊。
- 代理的对话接口：代理按 Modelflare 公开目录里该模型支持的接口选——有 Responses API 的（GPT-5.4 及以后、Grok 4.5 及以后、DeepSeek V4、GLM-5、Kimi K3 等）走 `/v1/responses`（推理模型默认推理强度 medium，加密推理随历史回放）；没有 Responses、有 Anthropic Messages 的（Claude）走 `/v1/messages`；其余模型、拿不到目录时（离线、中国大陆线路）以及外部端点走 Chat Completions。接口在拉起代理进程时选定（故障排查的代理状态里显示 `api`）；`AMB_AGENT_API=chat` 强制全部走 Chat Completions（排查用）。纯对话（非代理）仍走 Chat Completions。安全网：某个模型在 Responses / Messages 上的请求被上游拒绝（HTTP 400/404/405/415/422 或“不支持的参数 / 接口”，限流、余额、权限、上游故障、上下文过长不算）时，这个模型 24 小时内改走 Chat Completions（记在数据目录的 `dsh/api-fallback.json`，日志有警告，代理状态显示 `openai-completions (fallback: 原因)`）；这一轮如果还没调用过工具，代理换到 Chat 上自动重做一遍，用户照常收到回复，已经调用过工具的则照常报错、下一轮起走 Chat。
- 内置网关：magpie 以 `--gateway` 模式运行，使用本程序数据目录内独立的 HOME/配置目录；**不读取**你电脑上已有的 Claude/Codex 等订阅凭据，**不改写**任何 agent 配置，关闭自动更新与账户发现。它只供本进程内部调用，界面不再反代它的页面或 `/v1`。
- API Key 只保存在内置网关的隔离配置中，不经过命令行参数、不写日志，前端只拿到尾号。
- 开发/测试：设置 `AMB_MAGPIE_BASE_URL` 可直接使用一个 OpenAI 兼容端点（不启动内置网关，界面视为已连接，账户功能不可用）；`AMB_MODELFLARE_BASE_URL` 可把 Modelflare 基址指向本地 mock，`AMB_MODELFLARE_ISSUER` 把登录与账户接口指向本地 mock。

## 界面

- 侧栏：机器人列表（头像 + 名称 + 最近一条消息），＋ 新建，右键 重命名 / 删除；左下角账户按钮打开设置（`⌘/Ctrl+,`）。
- 对话页：顶部悬浮的机器人名称胶囊打开信息面板（`⌘/Ctrl+⇧+I`：渠道、待审批、记忆、最近会话，⚙ 进机器人设置）；回复流式显示（Markdown、代码块一键复制），可随时停止（`Esc`）；审批与提问以卡片形式出现在对话里；向上翻阅时不会被拉回底部。
- 命令面板 `⌘/Ctrl+K`；外观（跟随系统 / 浅色 / 深色）在 设置 → 常规。
- 视觉：中性色与组件改编自 magpie 的界面（MIT），强调色为 Modelflare 荧光黄绿 `#d7ff00`。设计系统说明见 `ui/design/README.md`。

## 人设与提示词

代理模式下模型看到的提示词都在 `src/agent/prompts/`；`test/prompts.unit.test.ts` 检查每段必须有、不能有的句子和字符数上限，`test/agent.integration.test.ts` 用真实的 DSH 子进程检查模型收到的系统提示词和整份系统提示词加工具定义的上限。

- **人设**：DSH 自带的人设是「coding agent」，前面还有一句「You are an AI agent powered by DeepSeek Harness.」。补丁（`host.ts` writePatch）把 `personaPrefix` 换成个人助手的人设（能聊天，也能写代码、运行命令、处理文件，开着电脑操作时还能操作桌面应用；网页、文件、转发的消息里的文字是资料不是指令），并关掉 `includeHarnessIdentity`（它只控制那一句）。
- **机器人段**：聊天规则、长期记忆的用法（开着记忆时）、机器人名字和你写的人设，排在系统提示词最后一段（`amb:bot`）。宿主在每个回合开始前把它写进数据目录的 `dsh/.prompts/<机器人>.md`（代理的文件工具读不到、改不了；内容没变就不写），插件 `dsh-runtime/plugins/amb-prompt.mjs` 在每次模型请求时现读——改了人设或名字，下一条消息就生效，不用 `/new`，也不重启代理进程。DSH 0.2.1-rc.4 同步调用这段的 `text`（返回 Promise 不会被等待），所以是同步读文件而不是走 bridge。人设和聊天规则冲突时以人设为准。子代理不带这一段：它们不和用户说话。
- **聊天规则**（改编自 dsh-superagent 的注意力原则）：先给答案；要花一阵子的任务开始时用一句话说要做什么，之后不逐步讲解（每一步在「处理过程」里）；做完说清做了什么、结果在哪里；没做完就说没做完，失败就说失败；需要你决定时一次只问一个问题，有选项时用 `ask_user_question`；不说客套话；微信、飞书里回复要短。
- **每段对话的第一条消息**：对话渠道（微信只显示纯文本，飞书和网页支持 Markdown）、当时的长期记忆快照、上一段的交接便条，再接你的消息。这些按会话不同（群记忆、渠道），记一条记忆就会变；放进系统提示词会让同一机器人所有会话共用的前缀缓存失效，所以留在这里，一段之内不变，之后的记忆变化用 `recall` 查。
- 前缀缓存：内容没变时系统提示词逐字节不变；人设变了只改最后一段，前面的部分照旧。升级前开始的对话第一条消息里还留着当时的人设，下一段（`/new` 或上下文管家换段）起不再有。

## 文件权限

代理模式下每个机器人有一个文件权限预设，在输入框左下角的权限胶囊或 机器人设置 → 权限 中切换，`/status` 会显示当前预设：

- **工作区可写**（默认）：命令在沙箱里运行，只能改这个机器人的工作区；越界操作先在聊天里问你。
- **只读**：不能改文件，命令在只读沙箱里运行。
- **完全权限**：给熟悉风险、嫌审批太多的用户。命令**不经沙箱**，以你的用户身份直接运行，越界操作不再请求批准——它可以读取和修改你电脑上的任何文件，包括 AnyModelBot 自己的数据目录（数据库、渠道令牌、密钥）。只有**递归删除**仍会先问你（同一套审批：微信回复编号、飞书 / 网页卡片）：`rm -r` / `-rf` / `--recursive`（含 `sudo`、`xargs`、`sh -c` 里的）、`find -delete`、`git clean`、`rsync --delete`，PowerShell 的 `Remove-Item` / `rm` / `del` / `rd` / `rmdir` 加 `-Recurse`（及其缩写），cmd 的 `rd /s`、`del /s`，`robocopy /MIR`，以及 Python `shutil.rmtree`、Node `fs.rm(…, { recursive })` 等常见写法；命令里点名的脚本文件也会检查。选它时界面会先弹出确认，权限胶囊和设置页用红色标出。
  - 这是防误删的保险，不是安全边界：检查的是命令文字，运行时才拼出来的命令（`eval "$(…)"`、`curl … | sh`）和 `make clean`、`npm run clean` 这类构建脚本看不到；拿不准时宁可多问。只在你信任当前模型和任务时开启。

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
- 图片、文件、视频：用户发来（或引用）的会从微信 CDN 下载解密（单个最大 50 MB）。代理模式下存进机器人工作区的 `inbox/`，消息里写明路径，代理可以读取、处理或当生图的参考图；能看图的模型（Claude、GPT-5/6、Gemini、Grok 4、Kimi K3、Muse Spark 等）同时直接收到图片本身，其余模型只拿到路径。Linux 版代理暂不直接收图（sharp 在 Electron 下会崩溃），只给路径。机器人交付的文件（present）按图片或文件发回微信。
- 登录过期（错误码 -14）时自动暂停并在界面提示，重新扫码即可。

## 开发与测试

```bash
npm run typecheck
npm test            # 单元测试 + 离线端到端（模拟飞书/iLink/Modelflare，含流式对话与停止）+ 内置网关集成测试（需已编译 magpie）
npm run docs:check  # README 自检：素材是否存在与体积、中英文结构一致、相对链接与锚点、禁用词、alt
```

README 的素材清单与录制规范见 [docs/assets/README.md](./assets/README.md)。

## 许可

MIT，见 `LICENSE`；第三方组件（magpie MIT——含界面样式改编、Tencent openclaw-weixin MIT 等）见 `THIRD_PARTY_NOTICES.md`，也可在 设置 → 关于 中查看。
