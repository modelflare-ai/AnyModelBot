# 第三方声明 / Third-Party Notices

anymodel bot 自身以 MIT 许可发布（见 LICENSE）。以下组件随本程序分发或被移植，各自保留原许可。

部分代码移植/改编自 Fei2411/DS-Bot（Apache-2.0），见下文「DS Bot」一节。

## magpie（内置模型网关，以二进制形式随附；界面样式部分改编自它）

来源：https://github.com/yetone/magpie （vendor/magpie 子模块，v0.1.1720）

- 以二进制形式随附：内置模型网关。
- 改编：`ui/design/tokens/semantic.css`、`ui/design/components/`（`button.css`、`list.css`、`seg.css`、
  `popover.css`、`toast.css`）、`ui/css/settings.css` 中的中性色、圆角、动效与组件样式
  （`.list` / `.row`、分段控件 `.seg`、弹出菜单 `.pop`、设置页页签、"已保存"胶囊）改编自
  `internal/gui/assets/app.css`。未使用 magpie 的名称、喜鹊标志、`assets/icons/` 中的厂商 logo、
  赞助商/合作方图片或官网截图。

```
MIT License

Copyright (c) 2026 yetone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## openclaw-weixin（微信 iLink 通道，src/channels/weixin 中的部分代码移植自此项目）

来源：https://github.com/Tencent/openclaw-weixin

```
Tencent is pleased to support the open source community by making openclaw-weixin available. 

Copyright (C) 2026 Tencent.  All rights reserved. 

openclaw-weixin is licensed under the MIT.


Terms of the MIT:
--------------------------------------------------------------------
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## npm 依赖（运行时）

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0（见包内 LICENSE）

传递依赖的许可证随各自包保存在 node_modules 中。桌面版另含 Electron（MIT）及 Chromium 等组件，其许可证位于安装目录的 LICENSE 与 LICENSES.chromium.html。

## DeepSeek Harness（DSH）代理运行时 — MIT

桌面版与 Docker 镜像在 `dsh/`（源码运行时为 `dsh-runtime/`）中附带未经修改的 npm 包
`@deepseek-ai/dsh@0.2.1-rc.4` 与 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.4`，作为独立子进程运行。

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

DSH 的传递依赖以未修改形式随附，各自许可证保存在包目录内。大部分为 MIT / Apache-2.0 / BSD / ISC；
另含 `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5`（MPL-2.0，源码见 LibreOffice 项目）与
`@img/sharp-libvips-*`（LGPL-3.0-or-later，可单独替换的动态库）。

`dsh-runtime/plugins/amb-bridge.mjs`（审批 / 读取围栏插件）为本项目原创代码（MIT）。

聊天规则（`src/agent/prompts/system.ts`）、每次模型请求现读的系统提示词段（`dsh-runtime/plugins/amb-prompt.mjs`）、
提示词约定测试与字符数上限（`test/prompts.unit.test.ts`）的思路参考了 DeepSeek 的 dsh-superagent
（MIT，Copyright (c) 2026 DeepSeek Harness Team）：它的注意力原则、按请求重算的 system-prompt 段与 prompt 测试。
文字和代码为本项目重写，未复制其代码。

## DS Bot（长期记忆、上下文管家、机器人设置 — Apache-2.0）

来源：https://github.com/Fei2411/DS-Bot

以下内容移植或改编自 DS Bot，并按 Apache License 2.0 第 4 条作了修改（改写为 TypeScript、接入本项目的存储与渠道、中文提示）：

- src/agent/memory.ts：三层记忆（团队 / 机器人 / 群）的 MEMORY.md + 主题文件格式、大小上限、秘密过滤的模式（改编自 ds-bot/src/host/memory.js）。
- src/agent/steward.ts、src/agent/manager.ts：上下文管家的阈值算法与判定提示词（压缩 / 开新段 + 交接），冻结的记忆前缀（改编自 ds-bot/src/host/steward.js 与 docs/plans/2026-10-09-context-and-memory.md）。
- src/agent/settings.ts：每个机器人的权限预设与设置思路。

DS Bot 的 NOTICE 原文（节选其版权声明）：

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

DS Bot 在其 NOTICE 中说明，记忆的 Markdown 格式（每行一条、带 [key: value] 元数据、MEMORY.md 索引链接主题文件）的思路来自 AgentMemoryRepo（MIT）；交接便条与何时压缩的思路参考了 OpenAI Codex、OpenCode、goose、pi、Gemini CLI、Hermes Agent 等项目（均未复制其代码）。

Apache License 2.0 全文见 LICENSES/Apache-2.0.txt（随程序分发），亦可见 https://www.apache.org/licenses/LICENSE-2.0 。

## kimi-computer-use（macOS 电脑操作 MCP 桥 — MIT）

来源：https://github.com/songkeys/kimi-computer-use （vendor/kimi-computer-use 子模块；macOS 安装包随附 bin/、skills/、LICENSE、NOTICE）

本项目随附其 stdio MCP 桥（bin/computer-use-mcp-bridge.mjs，原样使用）与改写了工具名的 skills/computer-use/SKILL.md。它是独立的非官方项目，不随附也不再分发 OpenAI、Kimi 或其他厂商的软件；电脑操作依赖用户自己在 macOS 14.4+ 上安装的 OpenAI Codex Computer Use 与 ChatGPT/Codex 应用。

```
MIT License

Copyright (c) 2026 Songkeys

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Cua Driver（跨平台电脑操作驱动 — MIT）

来源：https://github.com/trycua/cua （libs/cua-driver，发布版 cua-driver-rs-v0.37.0）

安装包按平台随附官方预编译的 `cua-driver` 可执行文件（未修改），以及其 LICENSE 与 THIRD_PARTY_NOTICES.md（位于安装目录 resources/cua-driver/）。构建脚本 scripts/fetch-cua-driver.mjs 固定版本并校验每个发布包的 SHA256。本项目的 dsh-runtime/plugins/amb-cua-mcp.mjs 只是在其 stdio MCP 前面做工具过滤与清单生成，未复制其代码。

**未随附**：cua-perception、OmniParser 等任何 AGPL 组件，以及 Cua Spaces 等 FSL 许可的内容。

```
MIT License

Copyright (c) 2025 Cua AI, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Cua Driver 自身依赖的第三方组件声明见其随附的 THIRD_PARTY_NOTICES.md。

