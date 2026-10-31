# 录制工具：README 的应用截图和功能 GIF

`docs/assets/` 里的 10 张应用截图（`screenshots/{chat,agent,models,memory,modelflare}-{light,dark}.webp`）和 9 个功能 GIF（G1–G9）由这里的脚本生成：

- **界面是真的**：直接加载仓库里的 `ui/`（Preact + htm），不改任何应用代码；
- **后端是模拟的**：`mock-server.mjs` 用演示数据实现界面实际调用的 `/amb/api/*` 接口，响应格式照抄 `src/web/server.ts`；代理回合（活动步骤、审批卡片、提问卡片、回复、文件卡片）按 `scenes.mjs` 里的脚本分段推送，审批卡片要等界面上点了允许才继续；
- **录制**：无头 Chromium（playwright-core）驱动鼠标和键盘，`Page.startScreencast` 带时间戳收帧，`encode.py` 按目标帧率重采样，用 Pillow 编码 GIF / WebP；
- **验证全靠程序**：DOM 断言、页面控制台、未实现的接口、尺寸、帧数、时长、体积、像素统计（有没有全空白或全黑的帧段）。

## 依赖

| 依赖 | 说明 |
|---|---|
| Node.js ≥ 22 | 模拟后端零依赖，只用内置模块 |
| preact、htm | 界面的运行时。仓库根目录 `npm ci` 之后在 `node_modules` 里；或用 `AMB_NODE_MODULES` 指向任何装了这两个包的 `node_modules` |
| playwright-core 1.64 + 对应的 Chromium | 默认找 `site/node_modules/playwright-core`（`cd site && npm install`）；或用 `PLAYWRIGHT_CORE` 指定目录、`CHROMIUM_PATH` 指定浏览器（headless shell 156 / revision 1248） |
| Python 3 + Pillow ≥ 10 | 编码与核对（`encode.py`）、生图演示的成图（`make-illustration.py`）。不需要 ffmpeg、gifski、cwebp |
| 字体 | Noto Sans SC（`/usr/share/fonts/truetype/noto-cjk/`）和 DejaVu Sans Mono。录制时自动生成一份 fontconfig，把界面字体栈落到的 `system-ui` / `sans-serif` 指向 Noto Sans SC |

## 用法

在仓库根目录：

```bash
# 录全部（5 对截图 + 9 个 GIF，约 6 分钟）
node docs/assets/_src/record/record.mjs

# 只重录某几个：名字里含这段文字即可，可以给多个
node docs/assets/_src/record/record.mjs model-switch
node docs/assets/_src/record/record.mjs shot-chat shot-models hero

# 列出全部素材的名字和输出路径
node docs/assets/_src/record/record.mjs --list

# 核对成品（不开浏览器）：尺寸、帧数、时长、帧率、体积上限、空白 / 全黑帧段，以及上次录制留下的报错记录
node docs/assets/_src/record/record.mjs --check
python3 docs/assets/_src/record/encode.py --verify docs/assets/features/model-switch.gif   # 单个文件的明细
npm run docs:check
```

环境变量：`PLAYWRIGHT_CORE`、`CHROMIUM_PATH`、`AMB_NODE_MODULES`（见上表）；`REC_TMP` 放帧和中间文件的目录（默认系统临时目录下的 `amb-record`）；`REC_KEEP_FRAMES=1` 编码后保留原始帧。

每个素材录完会在 `$REC_TMP/<名字>/report.json` 里留下：编码结果、时间线（每次点击、输入、关键画面出现的秒数，用来对照 GIF 卡片的时间点）、页面控制台的报错和警告、失败的请求、模拟后端收到的未实现接口。全部录完后汇总到 `$REC_TMP/summary.json`，并在终端打印这几类问题的条数。

单独启动模拟后端，在浏览器里手动看演示数据：

```bash
node docs/assets/_src/record/mock-server.mjs --scene demo --port 4173        # 演示就绪：已登录、六个机器人
node docs/assets/_src/record/mock-server.mjs --scene signed-out --port 4173  # 退出登录后（在终端按回车模拟浏览器里的授权）
node docs/assets/_src/record/mock-server.mjs --scene fresh --port 4173       # 全新安装：只有「我的助手」
```

## 文件

| 文件 | 作用 |
|---|---|
| `record.mjs` | 入口：起模拟后端和浏览器、跑 `scenes.mjs` 里的脚本、收帧、调 `encode.py` 编码并核对、汇总报错 |
| `scenes.mjs` | 每个素材的数据场景、代理回合脚本（步骤、审批、回复）、鼠标与键盘动作和时间点 |
| `mock-server.mjs` | 模拟后端：静态文件、`/amb/api/*`、流式回复（SSE）、审批等待、微信扫码与收消息 |
| `demo-data.mjs` | 演示数据：六个机器人、模型目录与参考价、会话、记忆、账户（余额 12.40 美元）、用量 |
| `stage/` | 录制舞台：应用窗口（iframe）、假鼠标，以及应用之外的示意窗口 |
| `encode.py` | 重采样与编码（GIF / WebP），超出体积上限时按 `docs/assets/README.md` 的顺序压缩；`--verify` 核对成品 |
| `make-illustration.py` | 生图演示的成图：用 `ui/design/bots/yellow.webp` 合成"黄色小机器人趴在键盘上打瞌睡"的扁平插画 |

## 录制约定

- 视口 1200×820（应用默认窗口大小，只录内容区）；截图 `deviceScaleFactor` 2 截 2400×1640，缩到 1600×1093，WebP 质量 82；明暗两张是同一页面同一时刻，只切系统配色（界面「跟随系统」），截图时禁用动画、隐藏输入光标、鼠标停在窗口边缘的空白处。
- GIF 一律深色。屏幕帧按卡片的尺寸和帧率重采样，最后一帧停 1 秒，无限循环；全局调色板、不抖动；第 2 帧起只存变化区域、区域里没变的像素记成透明，写完再解码一遍逐帧比对。超出体积上限时依次有损 → 帧率 8 → 宽度 800：`agent-files` 和 `memory` 走到了最后一档（800×547、8 fps），其余 7 个原样就在上限内。
- 假鼠标是默认箭头，跟着 Playwright 的真实鼠标事件走（所以悬停效果是真的），按下时缩一下并出一圈淡环；每次移动不少于 0.6 秒，点击前停 0.3 秒；打字逐字输入，每条提示词不超过 4 秒。
- 用户代理是 Windows 的 Chrome（界面会加上 `.win`），路径和命令按 Windows 写（代理用 `pwsh`）。

## 和 GIF / 截图卡片不一致的地方（按应用的真实行为录）

| 素材 | 卡片 | 实际画面与原因 |
|---|---|---|
| 所有回复 | "流式回复""看到回复开头" | 桌面版默认是代理模式（`agent.mode` 默认 `dsh`），代理回合的回复在结束时一次给出（`src/core/runtime.ts` handleAgent 只发 `stream.finish`），过程中是"思考中 · 等待 <模型> 回复"和活动步骤 |
| `agent` 截图 | 活动列表的最后一步是审批卡片 | 审批卡片插在回复状态行的上方（`ui/screens/chat.js` 的 `card()`），活动列表在它下面，最后一步是"进行中"的那条 pwsh 命令；活动列表默认折叠，点状态行展开 |
| `models` 截图 | 搜索框为空时列表至少 8 个模型 | 不筛选时模型按族折叠，只展开当前模型所在的族（Claude）；脚本点开了 GPT 族，列表滚到 GPT 的第一个模型，视野里是 GPT 4 个 + Claude 4 个；悬停的是视野里的第三行 |
| `modelflare` 截图 | 近 7 天用量 | 用量在「用量 → 查看」打开的弹窗里；弹窗只压暗不模糊，下面的「默认模型」行可见，余额显示在左下角账户按钮上（余额那一行大半被弹窗挡住） |
| G1 | 全新启动的欢迎页，登录后"小黄被选中，模型已就绪" | 全新安装只有应用自建的「我的助手」（`src/app.ts` seedDefaultBot），所以录的是"退出登录后再登录"：欢迎页是同一个；登录回来先到选模型页（"已连接 · 找到 N 个模型"），点「开始对话」才进主界面 |
| G1、G3 | 活动列表逐步出现 | 点一下回复上方的状态行把它展开（默认折叠），之后步骤逐条出现 |
| G2 | 系统的未知应用提示 | 没有模拟系统的安全提示；安装向导按 `package.json` 的 NSIS 配置（`oneClick: false`、可改安装目录）走：安装选项 → 安装位置 → 进度 → 完成（勾选"运行"） |
| G5 | 成图出现在聊天里 | 聊天里成图是文件卡片（`present` 交付的文件，界面不预览图片）；卡片出现后旁边弹出一个示意的看图窗口展示成图。确认卡片是生图前的提问卡片：鼠标在另一个模型选项上停 1 秒，再点默认模型确认 |
| G6 | 欢迎页 → 授权 → 模型列表 → 对话 | 全新安装的机器人是「我的助手」（蓝色）；登录回来的选模型页里点了 claude-sonnet-5-5 再点「开始对话」 |
| G7 | 搜索 claude 后的列表 | 除了 4 个 Claude 模型，最后还有一行「使用「claude」 自定义模型 ID」（输入的不是现成 ID 时界面给的） |
| G8 | 记忆区新条目高亮 1 秒 | 界面没有高亮效果，记忆行也不响应悬停；改为鼠标指着新条目停 1 秒。"新建对话"用的是对话顶栏的「开始新的一段对话」（发 `/new`），旧消息仍留在页面上 |
| G9 | 桌面应用里同一段对话同步出现 | 微信会话出现在 信息面板 → 最近会话（每 8 秒刷新一次），点开是对话记录弹层；二维码到"已连接"之间是界面自己的刷新（每 1.5 秒），脚本把状态切换对齐到刷新前，没有剪辑 |

## 风格化示意（不是真实界面）

都在 `stage/`，中性的深色窗口，不仿任何系统或第三方产品：

- G1、G6：浏览器窗口和 Modelflare 授权页（地址栏 modelflare.dev，一张"AnyModelBot 想连接你的 Modelflare 账户 / 继续"的卡片）；
- G2：桌面、下载文件夹窗口、安装向导；
- G4：桌面、文本编辑器窗口（记事本）和它的另存为对话框、桌面图标；
- G5：看图窗口；
- G9：手机聊天界面（通用样式，没有腾讯标志，不照抄微信），以及信息面板里的二维码（装饰性图案，不能扫）。
