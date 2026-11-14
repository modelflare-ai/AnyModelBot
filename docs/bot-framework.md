# 目录 Bot 开发框架

[English](./bot-framework_en.md)

一个 Bot 就是一个目录。App 里不放任何单个 Bot 的代码，上架新 Bot 不用发版。不管谁来做、做多少个，都过同一道约束检查，风格和安全由框架保证。

目录为空时，现有用户看不到任何变化：侧边栏没有新入口，新手流程和原来一样。

## 上手

需要 Node.js 22.13+：

```bash
git clone git@github.com:modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run bot -- new <id>            # 从模板起一个目录：bots/<id>/
npm run bot -- check bots/<id>     # 静态检查，模板里的 TODO 填完才能过
```

`check` 通过后，请人看一眼值不值得上，然后直接提交到 master。不用提 PR。

## 架构

```text
作者（人 / Claude + 开发技能 / 以后的流水线）
        │
        ▼
Bot 包：bots/<id>/ ──► 约束检查 ──► 人看一眼 ──► dist/catalog ──► App 安装包
                                                              │
                                                              ▼
App：本地目录 · 运行时（沙箱 iframe、桥接、状态文件）· 界面套件 · Bot 进程
```

| 部分 | 位置 | 做什么 |
| --- | --- | --- |
| 包格式 | `src/botkit/format.ts`、`schema.ts` | `bot.json` 的结构、权限、上限，数据约定用的 JSON Schema 子集 |
| 约束检查 | `src/botkit/check.ts`、`render.ts`、`evals.ts` | 静态规则、渲染、真实模型评测 |
| 打包发布 | `src/botkit/bundle.ts`、`pack.ts`、`sign.ts` | 内容寻址的包、签名的目录、下架 |
| 目录加载 | `src/botkit/catalog.ts`、`config.ts` | 默认读内置目录、校验并解压本地包；显式配置才使用远程目录 |
| 实例 | `src/botkit/installer.ts`、`app-skill.ts` | 第一次使用时安装，升级、下架、移除 |
| 服务端 | `src/web/botapp.ts`、`src/botkit/static.ts` | 目录和实例的接口；界面的静态路由和 CSP（`amb-bot check` 渲染也用） |
| 界面套件 | `ui/botkit/` | Bot 的界面唯一能引用的东西 |
| 容器 | `ui/screens/bot-app.js`、`discover.js`、`ui/lib/bot-bridge.js` | iframe、桥接、输入框、发现页 |
| 权限 | `src/agent/host.ts`、`dsh-runtime/plugins/amb-bot-gate.mjs` | 没声明的权限运行时拒绝 |
| 工具 | `src/cli/amb-bot.ts`、`assets/bot-template/` | `amb-bot` 命令和模板 |

## Bot 包

```text
bots/<id>/
  bot.json           元数据：名称、一句话、头像、权限、可点的话、引入的技能、版本
  persona.md         人设和系统提示
  skills/            技能。引入的技能也放这里，随目录一起发布
  ui/                界面：index.html、静态资源、locales/
  state.schema.json  界面和 Bot 之间的数据约定
  sample.<lang>.json 示例数据，打开时按用户的语言显示。zh-CN、en 必须有，其余语言缺了退回 en
  evals/             tasks.json（评测任务）、injection.json（提示注入用例）
  cover/             可选：发现页封面 light.png、dark.png
```

### 封面

发现页卡片上方是一张封面：`cover/light.png`、`cover/dark.png`，跟着界面主题换。打包时先用它，没有时退回 `.check/` 里的界面截图，再没有就显示头像。

- 画这个 Bot 在做的事（场景、道具），不画单独的机器人头像——头像已经在卡片的名字旁边。
- 官方 Bot 的封面是一套：用这个 Bot 头像的材质和配色，把它头顶的配件和工作里的道具做成一小组毛毡、布艺的静物（PPT 大师是薰衣草紫毛毡底座上的三张幻灯片卡，尽调助手是芥黄人字呢卷宗 + 黄铜放大镜，影视创作室是黑毛毡场记板 + 黄铜胶片盘，美股研报是黄绿毛绒柱 + 霓虹走势箭头）。浅中性灰无缝背景，物件居中、四周留足空白（大卡会再裁成 16:9），颜色只来自物件；不写字、不放标志、人物和机器人。深色版用图片编辑（images/edits）把浅色版换成炭灰底重新打光，构图不变。用 gpt-image-2.5 画 1536×1024，再裁成 16:10 压成 256 色 PNG：

  ```bash
  ffmpeg -i in.png -vf "crop=1536:960,scale=1200:750:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a" -compression_level 9 cover/light.png
  ```

- 必须是 PNG，单张不超过 500 KB（客户端取线上目录的缩略图时按界面包的上限拒绝），`amb-bot check` 会拦（`format.cover`）。

### bot.json

| 字段 | 说明 |
| --- | --- |
| `id` | 小写字母、数字、连字符，2–48 个字符 |
| `version`、`minAppVersion` | Bot 版本；App 版本不够的用户看不到这个 Bot |
| `name`、`summary` | 名称（≤ 24 字符）、一句话（≤ 80 字符） |
| `about` | 1–3 行说明，显示在信息面板 |
| `starters` | 2–3 句可点的话，每句都要让界面发生看得见的变化。还没用过时显示在输入框上方的一排单行胶囊里，放不下时省略、悬停看全文，写短一点（中文 20 字左右以内） |
| `avatar` | 基础角色 `blue`、`yellow`、`green`、`red`、`purple`、`orange`，或领域专家 `law`、`health`、`finance`、`code`、`design`、`writing`、`education`、`science`、`data`、`marketing`、`cooking`、`translate`；只决定长相。专家要新版 App 才认得，用了就把 `minAppVersion` 设到发布它们的那个版本。不能和目录里别的 Bot 撞头像（打包时拦）。`slides`、`film`、`dossier`、`ticker` 是 PPT 大师、影视创作室、尽调助手、美股研报的专属形象，别的 Bot 不能用 |
| `permissions` | 见下表 |
| `skills` | 引入的技能：`name`、`source`、`sha256`（`amb-bot hash` 算）、`author`、`license`、`url`。自己写的不用列 |

文案字段都写成 `{ "zh-CN": …, "en": … }`。框架要求这两种，`ja`、`ko`、`ru`、`es`、`pt` 缺了退回 `en`。这个仓库里上架的 Bot 七种语言都要有，文案、界面和示例数据都算，`test/bot-catalog-site.unit.test.ts` 会检查。

### 权限

| 权限 | 允许 | 没声明时 |
| --- | --- | --- |
| `workspace-write` | 写自己的工作区。因为要写 `app/state.json`，这项必须有 | 权限预设是只读 |
| `network` | 联网搜索、抓网页、命令联网。第一次用时问用户 | 工具被拒绝；Linux 上命令没有网络；脚本里联网过不了静态检查 |
| `channel-send` | 后台任务，结果会主动发到聊天渠道。第一次用时问用户 | `task_start`、`task_message` 被拒绝 |
| `computer-use` | 操作电脑 | 不加载 |
| `accounts` | 用户授权的账号（Notion、飞书数据） | 不加载 |

macOS 和 Windows 上，命令层面的断网靠静态扫描，运行时只拦工具调用。

## 界面

界面跑在 `sandbox="allow-scripts allow-forms"` 的 iframe 里，是不透明来源：不能联网（`connect-src 'none'`）、没有 Cookie、碰不到 App 的接口。所有数据都经桥接走父页面。

只能引用界面套件和自己目录里的文件：

```html
<link rel="stylesheet" href="/amb/botapp/kit/kit.css" />
<script type="module" src="./app.js"></script>
```

```js
import { html, mount, useBot, Page, Card } from "/amb/botapp/kit/kit.js";

function App() {
  const bot = useBot();
  if (!bot.ready) return null;
  return html`<${Page} title=${bot.state?.title}>…<//>`;
}
mount(App);
```

### useBot()

| 字段 | 说明 |
| --- | --- |
| `ready` | 桥接就绪 |
| `state` | `app/state.json` 的内容，不合约定的部分已剪掉；Bot 改了文件自动更新 |
| `issues` | 不合约定的地方，给调试用 |
| `sample` | 还是示例数据（还没创建实例） |
| `busy` | Bot 正在回复 |
| `lang`、`t(key, params)` | 当前语言和 `ui/locales/<语言>.json` 里的文案 |
| `send(text, action)` | 以用户身份发消息。`action` 是界面操作，Bot 收到 `[ui-action] {…}` |
| `stop()` | 停止当前回合 |
| `pickFile({ accept, multiple })` | 让用户选文件，放进 `app/inbox/`，返回 `[{ name, size, path }]` |
| `readFile(path)` | 读 `app/` 下的其他文本文件（≤ 2 MB） |
| `readImage(path)` | 读 `app/` 下的图片（png、jpg、gif、webp、svg，≤ 16 MB），返回 `{ url }`，放进 `<img>`；需要实例，示例数据里的图放在 `ui/` 下用相对路径 |
| `readMedia(path)`、`releaseMedia(url)` | 0.1.23 起可预览 `app/` 下的音视频（单个 ≤ 200 MB，同时最多 4 个）。返回 `{ url, size }`，用于 `<video>` / `<audio>`；切换素材或卸载组件时释放 URL。数据经父页面传入，Blob URL 在沙箱内创建 |
| `openFile(path, { reveal })` | 打开 `app/` 下的文件。要在用户点击时调用。默认在右侧「预览」打开；不支持的格式提供下载与系统打开。桌面版 `{ reveal: true }` 仍在文件夹中显示 |
| `desktop` | 是桌面版，能用系统程序打开文件 |
| `expanded`、`setExpanded(boolean)` | 工作台是否展开；用户点击时可展开，收起保留当前编辑状态。新套件能力要求 App 0.1.33 起 |
| `openUrl(url)` | 在右侧预览外部网页：用户确认地址后才打开，只放行 http(s)，保留浏览器打开入口 |

主题、语言、字号、动效偏好由套件自动跟随，界面不用管。

### 组件

`Page`、`Section`、`Card`（`on` 时用高亮底色）、`Row`、`Stack`、`Grid`、`Button`、`Field`、`Notice`、`Empty`、`Meter`、`Table`、`Link`（外部链接，点开前让用户确认）。设计系统的类（`.btn`、`.field`、`.t-title`…）和 token（`--fg`、`--well`、`--space-*`、`--fs-*`）都能直接用，规范见 [ui/design/README.md](../ui/design/README.md)。JS 里的 `style` 同样不能写死颜色、间距和字号，只放算出来的值，比如条形的宽度。

### 桌面工作区

专属界面首先适配右侧面板。有多份作品（项目、研究、任务）的 Bot 使用套件的 `Workspace({ label, current, children })`：第一个子项是导航，后面是内容。`label` 为列表名称，`current` 为当前项目或新建页面的标题。新组件要求 App 0.1.33 起：

```js
html`<${Workspace} label=${listTitle} current=${selectedTitle}>
  <nav class="kit-ws-list">
    <div class="kit-list-head"><h2 class="t-label">项目</h2><button class="btn sm">新建</button></div>
    <button class="kit-item on"><span class="kit-item-title">名称</span><span class="kit-item-meta">…</span></button>
  </nav>
  <main class="kit-ws-main">
    <header class="kit-bar"><div class="kit-bar-text"><h1>当前这一份</h1><p>状态 · 一行说明</p></div><div class="kit-bar-actions">…</div></header>
    <div class="kit-ws-body"><div class="kit-tabs" role="tablist">…</div>…</div>
  </main>
<//>`;
```

- iframe 小于 1100px 时，导航收进顶部项目选择器，点击外部或按 Escape 关闭；到达 1100px 后常驻左侧。宿主提供「展开工作台 / 返回对话」，切换时不卸载 Bot 界面。
- `.kit-ws-main` 声明 `workspace-content` 容器，内部多栏用容器查询，按扣除导航后的实际宽度切换。外部 Bot 原有的直接 `<div class="kit-ws">` 结构仍可使用。
- Bot 的名字已经在容器顶栏里，界面里不再写大标题；免责声明这类每次都一样的话放在末尾的 `.kit-foot`，不占顶部。
- 主操作按进度给出「下一步」，其余收进「更多」。默认主分页保持四个左右；画布、设置等辅助工具按需进入。长描述、版本、任务历史使用局部折叠，当前生成状态展示在当前作品附近。
- 容器底部的示例是一排单行胶囊，可点的话写短一点，放不下时会被省略。
- 对话在主区、工作台在右侧；展开工作台时暂时隐藏对话，返回时恢复原有宽度和状态。Bot 不需要自己做聊天。
- 让新手和懂行的人都能上手，每个 Bot 做两样东西：列表顶上的「新建」是向导——点选几项，界面把要求写成一句话（发出前显示出来）再 `send`；另外至少一个懂行的人熟悉的专业视图，比如研报的关键数字、来源核对、放映、分镜表。

组件按真实需要加到 `ui/botkit/kit.js`：加进套件，不要在单个 Bot 里绕过。套件随 App 发布，所以往里加东西要发版。新能力登记在 `src/botkit/format.ts` 的 `KIT_SINCE`，用到它的 Bot 的 `minAppVersion` 不能更低，检查会拦（`ui.min-app-version`）。

### 桥接

`ui/lib/bot-bridge.js` 校验 `event.source`，只开放白名单方法，审批相关接口永远不开放。

| 方法 | 作用 |
| --- | --- |
| `init` | 下发语言、主题、字号、动效偏好、文案和 Bot 基本信息 |
| `readFile`、`readImage` | 只读工作区 `app/` 下的文件，走不出去 |
| `readMedia`、`releaseMedia` | 读取受限类型和大小的音视频，管理预览资源；不能读取 HTML 或脚本 |
| `openFile` | 预览 `app/` 下的文件，提供下载与系统打开。父页面确认用户刚点过才执行 |
| `send`、`stop` | 发消息、停止 |
| `subscribe` | 接收 `turn`、`file`、`env` 事件 |
| `pickFile` | 选文件 |
| `openChannels` | 打开连接设置，让用户绑定聊天渠道 |
| `openUrl` | 用户确认地址后在右侧预览外部网页 |
| `reportError`、`rendered` | 上报错误（退回对话视图）、渲染完成 |

一期不开放麦克风、摄像头和外部地图。确实需要时评估怎么安全地开放，加进桥接和约束检查。

## 数据约定

Bot 维护工作区里的 `app/state.json`，结构由 `state.schema.json` 规定。界面只读它，改数据只通过 `send` 让 Bot 去改。这样同一个 Bot 在聊天渠道里改的东西，回到电脑上界面也是新的。

每个目录 Bot 都自动带着宿主生成的 `amb-app` 技能（`src/botkit/app-skill.ts`）：告诉 Bot 怎么读写这份状态、怎么处理界面操作、在聊天渠道里怎么回复。这些不用写进 `persona.md`。

Schema 支持的关键字：`type`、`properties`、`required`、`additionalProperties`、`items`、`enum`、`const`、`minimum`、`maximum`、`minLength`、`maxLength`、`minItems`、`maxItems`。用了别的关键字，检查会报错。

模型不一定每次都照约定写，所以读文件时先校验：不合约定的字段去掉，缺必填字段的列表项去掉，界面能渲染多少渲染多少，同时写本地日志。

### 框架的边界

这几条是运行时的限制，设计 Bot 时要考虑：

- **不能注册工具**：Bot 的能力来自模型自带的工具、技能说明和技能里的脚本。
- **脚本调不到模型，也读不到用户的环境变量**：需要模型的步骤由 Bot 和它的子代理（`agent` 工具）完成；搜索用 `web_search`，App 设置里的搜索接口和 Key 由宿主管理。
- **后台任务只能写自己的文件夹**（`tasks/<slug>-<id>/`），写不了 `app/state.json`：要让界面实时更新的长任务放在当前回合里跑，单回合默认上限 30 分钟。
- **结果回到发起的会话**：在聊天渠道里发起就回到那个渠道，不能指定发到别的渠道。

## 用户怎么走

| 动作 | 发生什么 |
| --- | --- |
| 打开 | 从安装包解出界面，显示示例数据，顶部标明「示例」。不联网下载、不创建实例、不装技能、不起进程、不调模型 |
| 第一次发消息（打字或点可点的话） | 从安装包解出运行包，校验 sha256；创建实例 `cat-<id>`，示例数据写成初始状态，自动留在「我的」 |
| 之后 | 和普通 Bot 一样，也能在聊天渠道里用（`/bot` 能切到）。不进其他 Bot 的同伴名单 |
| App 升级带来新的 Bot 包 | 下次打开时替换技能和界面，保留项目数据。用户改过人设的不再跟随；正在工作的等下次 |
| 空闲 10 分钟 | 代理进程退出，下一条消息再拉起 |
| 移除 | 问一句是否保留数据。不保留就清掉工作区和技能；保留的话再次使用接着用 |

只看没用的 Bot 不留任何东西，被新上架的顶掉后，还能在发现页找到。

## 约束检查

```bash
npm run bot -- check bots/<id>          # 静态：几秒，每次改完都跑
npm run bot -- check bots/<id> --full   # 可选：再跑渲染和真实模型，上架不依赖它
```

| 类别 | 规则前缀 | 检查什么 |
| --- | --- | --- |
| 格式 | `format.*` | 必需文件齐全，`bot.json` 合法，TODO 填完，示例数据符合约定 |
| 来源 | `source.*` | 引入的技能有作者和原页面，许可证在白名单（MIT、MIT-0、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC、CC0-1.0），哈希对得上，没有符号链接；运行包文件数和解开后的大小不超限（客户端解包时同样的上限） |
| 权限 | `permissions.*`、`risk.*` | 脚本联网要声明；管道执行、删工作区外的文件、读密钥、混淆执行、留常驻项、提权一律不过 |
| 界面 | `ui.*` | CSS 和 JS 里都不写死颜色、间距、字号；没有内联脚本和外部资源，外部链接用 `Link`；不联网，不碰存储和外层页面；压缩后 ≤ 500 KB；中英文案键一致 |
| 渲染 | `render.*` | 浅色、深色、390px 没有报错、空白、溢出和对比度问题 |
| 行为 | `behavior.*` | 评测任务完成率 ≥ 80%，每句可点的话都让界面变化，写出的状态符合约定 |
| 安全 | `security.*` | 提示注入用例全部通过 |

不通过时会指出具体哪一条。每发现一类新问题，就在 `src/botkit/check.ts` 加一条规则，不靠人记。

渲染、行为、安全三类只在 `--full` 里跑。`--full` 是可选的，打包和上架都不依赖它。要跑的话需要两样东西：

- 渲染用 Playwright，不是 App 的依赖：`npm i --no-save playwright && npx playwright install chromium`。截图留在 `.check/`；没有画好的封面（见下）时，提交后打包时用作发现页缩略图；两样都没有时，发现页卡片显示头像。
- 评测连到运行中的 App：先装 Go 1.26.8+，运行 `npm run setup && npm start` 并登录 Modelflare（`--app <地址>`，默认本机配置的端口；有令牌时设 `AMB_UI_TOKEN`）。评测会真实安装并调用模型，跑完清掉。

评测任务写在 `evals/tasks.json`：`{ id, prompt, changed?, contains?, notContains?, file?, files? }`，至少 3 个。`file: { name, text }` 把文件放进 `app/inbox/`。`files` 检查产物，只信文件本身：`{ match（路径的正则）, minBytes?, zipHas?（zip 里要有的条目）, absent?（这样的文件不能存在） }`。评测时没人点审批：Bot 声明过的权限第一次用时的确认算通过，其余拒绝，Bot 的提问答“按你的建议继续”。注入用例写在 `evals/injection.json`：`{ id, prompt, file?: { name, text }, mustNotContain }`，至少 1 个。

## 发布和下架

官方 Bot 随 App 一起发布。`npm run build` 自动运行 `build:catalog`，检查 `bots/` 下的全部 Bot，把界面、各语言的示例数据、人设、技能和可用缩略图打到 `dist/catalog/`。Electron 的 `dist/**` 打包规则和 Docker 镜像都会包含这些资源，不需要目录签名私钥。首次预览和安装只从内置包读取，按 sha256 校验后解压到数据目录；旧的线上目录缓存不会覆盖内置目录。

`npm start`、`npm run dev` 和 `npm run init` 会先生成内置目录；直接运行 `tsx src/main.ts` 前，先执行 `npm run build:catalog`。官方 Bot 的上新、升级和下架跟随 App 版本发布。GitHub Release 工作流会用打包后的可执行文件验证所有内置 Bot 能在禁止网络请求的条件下加载和安装。

以下签名目录流程保留给显式配置远程目录的部署：

目录仓库的结构：

```text
bots/<id>/          每个 Bot 一个目录
catalog.json        { "featured": [id…], "removed": { id: { reason, security? } } }
catalog.lock.json   每个 Bot 上次发布的记录，由 pack 维护，留在发布机器上
```

```bash
npm run bot -- pack --root . --out dist-catalog            # 需要 AMB_CATALOG_PRIVATE_KEY
npm run bot -- takedown <id> --root . --reason "原因" [--security]
npm run bot -- who-uses <技能> --root .
```

- `pack` 把每个 Bot 过一遍静态检查，有一个不过就什么都不写。产物是 `index.json`、`index.json.sig`、`bundles/`、`thumbs/`，放到目录地址下就算发布。
- 显式使用远程目录的客户端启动时和之后每 6 小时拉一次（带 ETag），验签失败不更新；缓存也要验签。界面和技能按 sha256 校验。
- 下架后重新 `pack` 并发布，24 小时内客户端生效。普通下架只提示用户；`--security` 会立刻停掉进程、删掉技能，用户的数据不动。
- `.github/workflows/bot-catalog.yml` 在 `bots/**` 或 `catalog.json` 推到 master 时检查并打包，产物作为 CI artifact；怎么放到线上由发布环境决定。仓库还没配置 `AMB_CATALOG_PRIVATE_KEY` 时只检查，不打包。

### 可选的线上目录

默认使用 `dist/catalog/`，不连接 `anymodel.bot/catalog/`。只有显式设置 `AMB_CATALOG_URL` 才改用远程目录；`AMB_CATALOG_PUBKEY` 指定其公钥，未指定时沿用旧官方目录的公钥。

- **私钥**只放在发布机器上（`AMB_CATALOG_PRIVATE_KEY`），不要提交。丢了就要换公钥并发版，所以要另外备份。
- **远程发布**：在发布机器上拉最新的 master，运行 `pack`，把产物放到目录地址下；只影响显式连接该远程目录的客户端。
- **`catalog.lock.json`** 留在发布机器上，每次 `pack` 前放回仓库根目录。
- **官网**：`/bots` 页面的内容来自 `site/src/data/catalog-bots.json`。上架或改了 Bot 的文案后，在 `site/` 运行 `npm run sync` 并提交，再部署官网。
- **关闭目录**：设环境变量 `AMB_CATALOG=off`，内置和远程目录都会关闭。测试默认这样跑，内置目录有独立的离线测试。

本地联调可以不改代码：设环境变量 `AMB_CATALOG_URL` 和 `AMB_CATALOG_PUBKEY`。

### 签名密钥与恢复

发布机器的签名密钥保存在 `.runtime/catalog/signing.json`，包含 Ed25519 公私钥，目录权限为 `0700`、文件为 `0600`。`.runtime/` 和本机 `catalog.lock.json` 已加入 Git 忽略；发布进程读取 `privateKey` 后传给 `AMB_CATALOG_PRIVATE_KEY`，不要打印或写入命令历史。

age 用于加密私钥备份，不代替目录签名。当前沿用 Modelflare 的 age 收件人和备份存储：加密对象位于已配置备份目标的 `anymodelbot/catalog-signing/` 前缀下。本机 `.runtime/catalog/backup-receipt.json` 记录对象地址、大小和 SHA-256；上传后核对远端对象大小。

恢复时，从该前缀下载对应的 `.json.age`，用离线保管的 age 私钥解密，再将签名文件以 `0600` 权限放回上述路径。使用前从私钥推导公钥，与 `src/botkit/config.ts` 的 `CATALOG_PUBLIC_KEY` 比较；不一致时不能直接发布。0.1.23 因原私钥丢失而更换了目录公钥，旧版用户需要升级后才能加载新目录。

## 让 Claude 做 Bot

`.claude/skills/amb-bot-dev/` 是 Bot 开发技能：把这份文档的约束写成 Claude 照着做的步骤。跟 Claude 说要做什么，它从模板起目录，写到 `check` 通过为止。以后想要批量生成，流水线也只是多一个作者，产物一样过约束检查，架构不用改。

## 接口

都在 `/amb/api` 下。错误只返回 `code`，文案在界面词典 `botapp.errors.*` 里。

| 接口 | 说明 |
| --- | --- |
| `GET /catalog` | 目录列表 |
| `POST /catalog/sync` | 立刻同步 |
| `POST /catalog/dev`、`DELETE /catalog/dev/:id` | 登记、取消本机目录（只在回环模式） |
| `GET /catalog/:id` | 一个条目 |
| `POST /catalog/:id/preview` | 准备界面，返回地址；不创建实例 |
| `GET /catalog/:id/file?path=` | 还没有实例时读示例数据 |
| `POST /catalog/:id/install` | 创建实例 |
| `GET /bots/:id/app` | 实例的来源、版本、有没有新版本 |
| `POST /bots/:id/app/update` | 升级 |
| `GET /bots/:id/app/file?path=` | 读 `app/` 下的文件 |
| `GET /bots/:id/app/image?path=` | 读 `app/` 下的图片，返回 data URL |
| `GET /bots/:id/app/list` | 列出 `app/` 下的文件（评测用） |
| `GET /bots/:id/app/download?path=` | 读取 `app/` 下的文件；加 `download=1` 强制下载 |
| `GET /bots/:id/app/preview?path=` | 获取 `app/` 下文件的预览描述 |
| `POST /bots/:id/app/open` | 桌面版打开 `app/` 下的文件，或在文件夹中显示 |
| `POST /bots/:id/app/inbox` | 放文件进 `app/inbox/` |
| `GET /bots/:id/app/watch` | SSE：`app/` 下的文件变化 |

静态文件在 `/amb/botapp/` 下：`kit/`（套件和设计系统）、`b/<sha256>/`（界面包）、`d/<id>/`（开发目录）、`thumb/<sha256>`（缩略图）。这条路径不要令牌，因为沙箱页带不上 Cookie；这里没有用户数据。
