# anymodel bot

任意模型的个人 AI 助手：一个机器人 = 人设 + 默认模型 + 渠道（飞书 / 微信）。
模型调用全部经过**内置的 [magpie](https://github.com/yetone/magpie) 模型网关**（OpenAI 兼容 `/v1`），在管理界面里加服务商、切模型、看用量。

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
  web/         管理界面服务 + /magpie/ 反向代理
  cli/         init 首次设置向导、weixin-login
  main.ts      命令行入口
electron/      桌面版主进程（启动器 + 托盘）
ui/            管理界面（Preact + htm，无构建步骤）
scripts/       setup / build-magpie / fetch-cua-driver / electron-smoke
vendor/magpie  magpie 源码（git 子模块，构建时编译）
```

## 快速开始（命令行）

需要 Node.js 22.13+、Go 1.26.8+（用于从源码编译 magpie）。

```bash
npm install
npm run setup        # 拉取 vendor/magpie 子模块并编译到 build/bin/
npm run init         # 可选：首次设置向导（模型服务商 Key、飞书凭据）
npm start            # 启动全部：magpie + 机器人 + 管理界面 http://127.0.0.1:3600/
```

数据默认在 `./data`（`AMB_DATA_DIR` 可改）。其余环境变量见 `.env.example`。

## 桌面版（Electron）

```bash
npm run electron:dev     # 开发运行
npm run electron:smoke   # 冒烟测试（Linux 无显示器时自动用 xvfb-run）
npm run dist             # 打包当前平台（magpie 随附在 resources/magpie/）
npm run dist:linux | dist:mac | dist:win
```

- 数据目录：`<userData>/data`（macOS `~/Library/Application Support/anymodel bot/data`，Windows `%APPDATA%\anymodel bot\data`，Linux `~/.config/anymodel bot/data`）
- 单实例；关闭窗口隐藏到托盘；托盘菜单：打开 / 在浏览器中打开 / 开机自启（macOS、Windows）/ 打开数据目录 / 退出
- 界面只监听 127.0.0.1，且每次启动生成随机访问令牌，其他本机程序无法直接调用管理接口
- 退出时先停渠道、再停 magpie；若上次被强杀残留 magpie 进程，下次启动会自动清理（Linux/macOS）

**签名与发布（需你本人完成）**：macOS 需 Apple Developer ID 证书 + 公证（`CSC_LINK`/`CSC_KEY_PASSWORD`、`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`），内置的 magpie 二进制也会被一并签名（hardened runtime）；Windows 建议 Authenticode 证书，否则 SmartScreen 会拦截。自动更新（electron-updater）需要发布地址与签名，暂未启用。

## Docker

```bash
git submodule update --init --depth 1 vendor/magpie
docker build -t anymodel-bot .
docker run -d --name amb -p 3600:3600 -v amb-data:/data anymodel-bot
docker exec amb cat /data/ui-token     # 打开 http://<主机>:3600/?token=<令牌>
```

容器内界面监听 0.0.0.0，因此强制令牌访问。微信扫码在界面「渠道」页完成。

## 模型（内置 magpie）

- 管理界面「概览」可快速添加预设服务商（DeepSeek、OpenAI、Anthropic、Kimi、通义等）；「模型」页内嵌 magpie 完整界面（自定义端点、路由、用量）。
- 对话中发送 `/model` 查看可用模型，`/model <名称>` 为当前会话切换模型；`/reset` 清空上下文。
- 隔离与安全：magpie 使用本程序数据目录内独立的 HOME/配置目录；**不读取**你电脑上已有的 Claude/Codex 等订阅凭据，**不改写**任何 agent 配置，关闭自动更新与账户发现；界面代理还会拦截 magpie 的 agent 接入、账户、更新等接口。
- API Key 只保存在 magpie 的隔离配置中，不经过命令行参数、不写日志。

## 电脑操作（Computer Use）

每个机器人可在「机器人 → 设置 → 电脑操作」中开关、选择后端和审批方式；`/status` 与设置页会显示当前后端、是否可用及原因。

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
3. 先在本程序界面「渠道」页填入 App ID / App Secret 并启用（长连接需要程序在线才能保存下一步）。
4. 事件与回调 → 订阅方式选「**使用长连接接收事件**」，添加事件 `im.message.receive_v1`。
5. 发布版本并在可用范围内添加自己，然后在飞书里私聊机器人。

说明：当前只处理单聊（p2p），群聊消息会被忽略。

## 微信（iLink）

- 界面「渠道」页 → 微信 → 「扫码登录」，用微信扫描二维码并确认；或命令行 `npm run weixin:login`（终端显示二维码，同时保存 PNG 到数据目录）。
- 登录态、同步游标、context_token 保存在数据目录，重启后自动续用。
- 平台限制：用户每发来一条消息后 24 小时内最多可回复 10 条；回复在生成结束后一次发出，超过 4000 字自动分段；生成期间显示“正在输入”。
- 登录过期（错误码 -14）时自动暂停并在界面提示，重新扫码即可。

## 开发与测试

```bash
npm run typecheck
npm test            # 单元测试 + 离线端到端（模拟飞书/iLink/OpenAI）+ magpie 集成测试（需已编译 magpie）
```

## 许可

MIT，见 `LICENSE`；第三方组件（magpie MIT、Tencent openclaw-weixin MIT 等）见 `THIRD_PARTY_NOTICES.md`。
