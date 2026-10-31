# README 素材

[README.md](../../README.md)（中文）和 [README_en.md](../../README_en.md)（英文）共用这里的素材。应用界面目前只有简体中文，所以截图和录屏没有英文版。

- **脚本生成**：品牌、图表和机器人形象由 [`_src/make-assets.py`](./_src/make-assets.py) 生成，改了规格就重新运行它，不要手工修图。
- **录制脚本**：应用截图和功能 GIF 由 [`_src/record/`](./_src/record/README.md) 录制：真实的 `ui/` 界面 + 演示数据的模拟后端 + 无头 Chromium，用法见文末。也可以换成实机录屏（录制环境与编码流程见下文），放到对应路径即可。

改了素材之后跑 `npm run docs:check`（CI 也会跑）核对是否存在、尺寸与体积。

## 总表

| # | 文件 | 类型 | 尺寸 | 时长 | 帧率 | 体积上限 | 来源 |
|---|---|---|---|---|---|---|---|
| 1 | `brand/logo-eyes.webp` | 动画 WebP（透明，无限循环） | 240×240（显示 120×120） | 6 s | 20 | 80 KB | 脚本 |
| 2 | `brand/logo-eyes.svg` | 静态 SVG | viewBox 100×100 | — | — | 2 KB | 脚本 |
| 3 | `brand/wordmark-light.svg` | SVG（文字转曲线） | viewBox 520×96 | — | — | 12 KB | 脚本 |
| 4 | `brand/wordmark-dark.svg` | SVG（文字转曲线） | viewBox 520×96 | — | — | 12 KB | 脚本 |
| 5 | `brand/social-preview.png` | PNG | 1280×640 | — | — | 400 KB | 脚本 |
| 6 | `hero/hero-demo.gif` | GIF | 960×656 | 20 s | 12 | 5 MB | 录制脚本 G1（`_src/record`） |
| 7 | `modelflare/modelflare-logo.png` | PNG | 512×512（显示 120×120） | — | — | 40 KB | 原样取自 `https://modelflare.dev/logo.png` |
| 8 | `download/install-windows.gif` | GIF | 960×540 | 12 s | 10 | 2.5 MB | 录制脚本 G2（`_src/record`） |
| 9–18 | `screenshots/{chat,agent,models,memory,modelflare}-{light,dark}.webp` | 静态 WebP（质量 82） | 1600×1093 | — | — | 300 KB | 录制脚本截图（`_src/record`） |
| 19–20 | `screenshots/bots-{light,dark}.webp` | 静态 WebP（质量 82） | 1600×480 | — | — | 300 KB | 脚本 |
| 21 | `features/agent-files.gif` | GIF | 960×656（体积超限，按下文顺序压到 800×547、8 fps） | 15 s | 10 | 3 MB | 录制脚本 G3（`_src/record`） |
| 22 | `features/computer-use.gif` | GIF | 960×540 | 18 s | 10 | 3 MB | 录制脚本 G4（`_src/record`） |
| 23 | `features/media-generation.gif` | GIF | 960×656 | 14 s | 10 | 3 MB | 录制脚本 G5（`_src/record`） |
| 24 | `features/first-run.gif` | GIF | 960×656 | 16 s | 10 | 3 MB | 录制脚本 G6（`_src/record`） |
| 25 | `features/model-switch.gif` | GIF | 960×656 | 12 s | 10 | 3 MB | 录制脚本 G7（`_src/record`） |
| 26 | `features/memory.gif` | GIF | 960×656（体积超限，按下文顺序压到 800×547、8 fps） | 16 s | 10 | 3 MB | 录制脚本 G8（`_src/record`） |
| 27 | `features/channels-wechat.gif` | GIF | 960×540 | 18 s | 10 | 3 MB | 录制脚本 G9（`_src/record`） |
| 28 | `features/characters-eyes.gif` | GIF | 960×300 | 6 s | 15 | 1.5 MB | 脚本 |
| 29–30 | `diagrams/data-flow-{light,dark}.svg` | SVG（文字转曲线） | viewBox 1200×520 | — | — | 60 KB | 脚本 |
| 31–32 | `diagrams/architecture-{light,dark}.svg` | SVG（文字转曲线） | viewBox 1200×520 | — | — | 60 KB | 脚本 |

体积预算：所有 GIF 合计不超过 30 MB。GIF 超出上限时依次处理：`gifsicle --lossy` 加到 80 → 帧率降到 8 → 宽度降到 800；三步之后仍超就缩短时长，不要放宽上限。

alt 文案以两份 README 里的为准，换素材时不要改动画面含义，否则同步改 alt。

## 录制环境（所有截图和 GIF）

| 项 | 要求 |
|---|---|
| 机器 | Windows 11 x64，显示器 1920×1080，缩放 100%（拍静态截图时改 200%）；新建一个干净的 Windows 用户 `demo` |
| 应用 | 安装最新 Release 的 `win-x64` 安装包；窗口保持默认 1200×820，不最大化、不拖拽缩放 |
| 数据 | 从第一次启动开始录的素材（G1、G2、G6）先删除 `%APPDATA%\anymodel bot\data`；其余使用「演示就绪」快照：登录完成、建好六个机器人后，把整个数据目录压成 `demo-ready.zip`，每次录制前还原 |
| Modelflare 账户 | 专门的演示账户，不含真实个人信息，钱包余额不少于 5 美元（生图需要）；浏览器不登录其他账号，书签栏和扩展图标隐藏 |
| 机器人 | 六个：小黄（黄，默认助手人设）、小蓝、小绿、小橙、小紫、小红；默认模型统一选一个支持工具调用和图片输入的主流模型 |
| 演示文件夹 | 桌面上建 `demo-files`，放 24 个混合文件：`1..24 \| % { New-Item "$env:USERPROFILE\Desktop\demo-files\file$_.$(('pdf','png','docx','xlsx','zip','mp3')[$_ % 6])" -Force }`（PowerShell） |
| 主题 | GIF 一律深色；截图明暗各拍一套（设置 → 常规 → 外观） |
| 隐私 | 画面里不能出现真实 Key、邮箱、微信昵称、路径里的真实用户名；托盘图标收起；通知关闭（专注助手 → 仅闹钟） |
| 鼠标 | 默认指针；每次移动不少于 0.6 s；点击前停 0.3 s；不要快速来回晃动 |
| 打字 | 自然速度真实敲字；每条提示词输入不超过 4 s，超过就缩短提示词 |
| 结尾 | 每个 GIF 最后一帧停 1 s 再循环；无音频、无水印、无文字叠层 |

## 编码流程

**GIF**

```bash
# 1) OBS：窗口捕获「anymodel bot」，画布 1200×820，30 fps，录成 mkv，再无损转 mp4
ffmpeg -i raw.mkv -c copy raw.mp4
# 2) 剪辑（时间点见下面的卡片），去音轨
ffmpeg -ss 00:00:02 -i raw.mp4 -t 15 -an -c:v libx264 -crf 14 clip.mp4
# 3) 抽帧并缩放（宽 960；帧率见总表）
mkdir frames && ffmpeg -i clip.mp4 -vf "fps=10,scale=960:-2:flags=lanczos" frames/%04d.png
# 4) 编码
gifski --fps 10 --width 960 --quality 85 -o out.gif frames/*.png
# 5) 超出体积上限时压缩
gifsicle -O3 --lossy=80 out.gif -o out.gif
```

**静态截图（明暗成对）**：Windows 显示缩放调到 200%，用 ShareX「窗口截图」截应用窗口，得到 2400×1640 的 PNG：

```bash
cwebp -q 82 -resize 1600 1093 in.png -o chat-light.webp
```

明暗两张必须是同一份数据、同一时刻的状态，只换主题。截图时鼠标移出窗口，没有悬停提示，取没有输入光标的那一帧。

## 截图卡片

| 文件前缀 | 画面状态 |
|---|---|
| `chat` | 左侧六个机器人都有会话，选中小黄；用户「用三句话讲讲 Raft 为什么要选主」，回复已完成，含一段 Markdown 列表和一个代码块；输入框旁的模型按钮清晰可见 |
| `agent` | 小黄正在处理「整理桌面上的 demo-files」：活动列表展开，4 至 5 个已完成步骤，最后一步是待处理的审批卡片，审批按钮可见 |
| `models` | 打开模型选择器，搜索框为空，列表至少 8 个模型，每行带上下文长度、能力标记和参考价；鼠标悬停在第三行 |
| `memory` | 打开信息面板：记忆区 4 条（偏好类），渠道区微信和飞书都已连接，最近会话 3 条 |
| `modelflare` | 设置 → Modelflare：演示账户已连接，余额 12.40 美元，近 7 天用量，默认模型已选 |
| `bots` | 脚本生成（六个形象横排，眼睛略向右看） |

## GIF 卡片

时间点以剪辑后的成片为准，误差 ±0.5 s。提示词用中文，因为界面是中文。

**G1 `hero/hero-demo.gif`**（960×656，20 s，12 fps，深色）
1. 0.0–1.5 s：全新启动的欢迎页，停在「登录 / 注册 Modelflare」按钮上。
2. 1.5–3.0 s：点击按钮；浏览器窗口（同样大小，盖在应用窗口位置）显示演示账户的授权页，点击授权。
3. 3.0–4.5 s：回到应用，进入主界面，小黄被选中，模型已就绪。
4. 4.5–8.0 s：输入「把桌面上 demo-files 文件夹里的文件按类型整理一下」，回车。
5. 8.0–13.0 s：活动列表逐步出现，随后弹出审批卡片，点击允许。
6. 13.0–18.0 s：步骤完成，回复里给出整理后的目录结构。
7. 18.0–20.0 s：停留。

**G2 `download/install-windows.gif`**（960×540，12 s，10 fps；录整个 1920×1080 屏幕再缩放）
1. 0.0–2.0 s：资源管理器里显示下载好的 `anymodel-bot-<版本>-win-x64.exe`，双击。
2. 2.0–8.0 s：安装向导依次走完（如果弹出系统的未知应用提示，如实录下，点「更多信息 → 仍要运行」）。
3. 8.0–10.0 s：应用自动启动，出现欢迎页。
4. 10.0–12.0 s：停在「登录 / 注册 Modelflare」按钮上。

**G3 `features/agent-files.gif`**（960×656，15 s，10 fps）
1. 0.0–3.5 s：输入「把 demo-files 里的文件按扩展名分到子文件夹，再把清单写到 整理清单.md 发给我」，回车。
2. 3.5–8.0 s：活动列表逐步出现：列出文件、制定方案。
3. 8.0–11.0 s：弹出审批卡片（要访问工作区之外的 demo-files），鼠标移到允许按钮停 0.5 s 后点击。
4. 11.0–14.0 s：移动完成，`整理清单.md` 作为文件卡片出现在聊天里。
5. 14.0–15.0 s：停留。

**G4 `features/computer-use.gif`**（960×540，18 s，10 fps；录屏幕左侧 1800×1012 区域，应用在左、记事本在右）
1. 开始前：小黄的电脑操作已开启，审批设为「改变界面前先问我」。
2. 0.0–3.0 s：输入「打开记事本，写一句『今天也要加油』，保存到桌面，文件名 note.txt」，回车。
3. 3.0–14.0 s：每次点击或输入前出现审批卡片，依次点击允许（2 至 3 次）；右侧记事本里文字逐步出现并保存。
4. 14.0–18.0 s：回复「已保存」，桌面出现 note.txt。

**G5 `features/media-generation.gif`**（960×656，14 s，10 fps）
1. 0.0–3.5 s：输入「画一只在键盘上打瞌睡的黄色小机器人，扁平插画」，回车。
2. 3.5–7.0 s：出现生成确认卡片（模型和提示词），鼠标指向换模型的入口停 1 s，然后点击确认。
3. 7.0–12.0 s：生成中，随后图片出现在聊天里。
4. 12.0–14.0 s：停留。

**G6 `features/first-run.gif`**（960×656，16 s，10 fps；必须从全新数据目录开始）
1. 0.0–1.5 s：欢迎页。
2. 1.5–3.0 s：点击「登录 / 注册 Modelflare」。
3. 3.0–7.0 s：浏览器窗口（与应用同位置同大小）显示授权页，点击授权。
4. 7.0–10.0 s：回到应用，模型列表自动出现，选定默认模型。
5. 10.0–15.0 s：进入对话，输入「你好，介绍一下你自己」，看到流式回复。
6. 15.0–16.0 s：停留。

**G7 `features/model-switch.gif`**（960×656，12 s，10 fps）
1. 0.0–1.0 s：小黄的对话，模型按钮清晰可见。
2. 1.0–2.0 s：点击模型按钮，选择器打开。
3. 2.0–5.0 s：搜索框输入「claude」，列表过滤。
4. 5.0–8.0 s：鼠标依次悬停在两个结果上，各 1 s，上下文长度和参考价清晰可读。
5. 8.0–10.0 s：点击其中一个，选择器关闭，按钮上的模型名更新。
6. 10.0–12.0 s：输入「你现在是哪个模型？」并发送，看到回复开头。

**G8 `features/memory.gif`**（960×656，16 s，10 fps）
1. 0.0–4.0 s：输入「记住：我喜欢简短的回答，周报用中文」，回车，机器人确认。
2. 4.0–8.0 s：打开信息面板，记忆区出现新条目，高亮 1 s。
3. 8.0–10.0 s：新建对话。
4. 10.0–15.0 s：输入「帮我起一个周报的开头」，回复简短且是中文。
5. 15.0–16.0 s：停留。

**G9 `features/channels-wechat.gif`**（960×540，18 s，10 fps；左 720×540 桌面应用，右 240×540 手机录屏）
合成：`ffmpeg -i desk.mp4 -i phone.mp4 -filter_complex "[0]scale=720:-2,pad=720:540:0:(540-ih)/2:black[a];[1]scale=-2:540,pad=240:540:(240-iw)/2:0:black[b];[a][b]hstack" out.mp4`（手机用 scrcpy 录）。
1. 0.0–3.0 s：信息面板 → 渠道 → 微信，显示二维码；硬切到「已连接」（扫码环节不录）。
2. 3.0–8.0 s：手机微信里给机器人发「用一句话介绍你自己」。
3. 8.0–14.0 s：手机上机器人回复；桌面应用里同一段对话同步出现。
4. 14.0–18.0 s：停留。微信昵称用演示账号，头像用默认头像。

## `_src/`

| 文件 | 作用 |
|---|---|
| `make-assets.py` | 生成 Eyes 标志（SVG + 动画 WebP）、字标、社交预览图、数据流与架构图、机器人横排图和眼睛跟随 GIF，并下载 Modelflare 标志。用法见文件开头注释 |

### `_src/record/`：截图与 GIF 的录制工具

上表来源写着「录制脚本」的 19 个素材由 [`_src/record/`](./_src/record/README.md) 生成：加载仓库里真实的 `ui/` 界面，接一个用演示数据实现 `/amb/api/*` 的模拟后端，无头 Chromium 驱动鼠标键盘并逐帧录制，再用 Pillow 按上面的规格编码。依赖：Node.js ≥ 22、preact 与 htm（`npm ci`）、playwright-core 1.64 及对应的 Chromium、Python 3 + Pillow ≥ 10、Noto Sans SC 字体。

```bash
node docs/assets/_src/record/record.mjs                # 录全部
node docs/assets/_src/record/record.mjs model-switch   # 只重录名字里含这段文字的素材
node docs/assets/_src/record/record.mjs --list         # 列出全部素材
node docs/assets/_src/record/record.mjs --check        # 不开浏览器，核对尺寸、帧数、时长、体积和空白帧
```

环境变量、每个文件的作用、和卡片不一致的画面（按应用的真实行为录）、哪些窗口是风格化示意，见 [`_src/record/README.md`](./_src/record/README.md)。
