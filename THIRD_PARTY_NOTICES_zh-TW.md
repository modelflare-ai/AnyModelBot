# 第三方聲明 / Third-Party Notices

[简体中文](./THIRD_PARTY_NOTICES.md) | 繁體中文（台灣） | [English](./THIRD_PARTY_NOTICES_en.md) | [日本語](./THIRD_PARTY_NOTICES_ja.md) | [한국어](./THIRD_PARTY_NOTICES_ko.md) | [Русский](./THIRD_PARTY_NOTICES_ru.md) | [Español](./THIRD_PARTY_NOTICES_es.md) | [Português (Brasil)](./THIRD_PARTY_NOTICES_pt.md) | [Türkçe](./THIRD_PARTY_NOTICES_tr.md)

anymodel bot 自身以 MIT 授權發布（見 LICENSE）。以下元件隨本程式分發或被移植，各自保留原有授權條款。

部分程式碼移植/改編自 Fei2411/DS-Bot（Apache-2.0），見下文「DS Bot」一節。

## Heroicons（通用操作圖示）

通用操作圖示選自 Heroicons 2.2.0 的 Outline 圖形，以 SVG 節點資料形式隨應用程式分發，見 `ui/icons/heroicons.js`。Heroicons 使用 MIT 授權，版權屬於 Tailwind Labs, Inc.。完整授權條款見 [ui/icons/LICENSE](./ui/icons/LICENSE)，固定提交與來源驗證值見 `ui/icons/heroicons-source.json`。

https://github.com/tailwindlabs/heroicons/releases/tag/v2.2.0

## Lucide (panel-left / panel-right)

左右面板入口的 `panel-left` / `panel-right` 使用 Lucide 1.73.0，保留上一版圓角方框加豎線的圖形。原始碼與出處分別見 `ui/icons/lucide.js`、`ui/icons/lucide-source.json`；ISC / MIT 授權全文見 [ui/icons/lucide-LICENSE](./ui/icons/lucide-LICENSE)。

## highlight.js（右側預覽的程式碼著色）

右側預覽的程式碼檢視和 Markdown 程式碼塊使用 highlight.js 11.12.0 著色。只隨應用程式分發核心和常用的 31 種語言（官方 ES 模組建置，來自 npm 包 `@highlightjs/cdn-assets`），見 `ui/vendor/hljs/`，由 `scripts/vendor-hljs.mjs` 複製。highlight.js 使用 BSD-3-Clause 許可，版權屬於 Ivan Sagalaev 及貢獻者；完整授權條款見 [ui/vendor/hljs/LICENSE](./ui/vendor/hljs/LICENSE)。

https://github.com/highlightjs/highlight.js

## magpie（內建模型閘道，以二進制形式隨附；介面樣式部分改編自它）

來源：https://github.com/yetone/magpie （vendor/magpie 子模組，v0.1.1720）

- 以二進制形式隨附：內建模型閘道。
- 改編：`ui/design/tokens/semantic.css`、`ui/design/components/`（`button.css`、`list.css`、`seg.css`、
  `popover.css`、`toast.css`）、`ui/css/settings.css` 中的中性色、圓角、動效與元件樣式
  （`.list` / `.row`、分段控件 `.seg`、顯示選單 `.pop`、設定頁面頁簽、"已儲存"膠囊）改編自
  `internal/gui/assets/app.css`。未使用 magpie 的名稱、喜鵲標誌、`assets/icons/` 中的廠商 logo、
  贊助商/合作方圖片或官方網站螢幕截圖。

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

## openclaw-weixin（微信 iLink 通道，src/channels/weixin 中的部分程式碼移植自此專案）

來源：https://github.com/Tencent/openclaw-weixin

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

## npm 依賴（執行階段）

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0（見包內 LICENSE）
- ws 8.22.0 — MIT
- yauzl 3.4.0 — MIT
- yaml 2.9.1 — ISC
- electron-updater 6.8.12 — MIT
- @modelcontextprotocol/client 2.2.0 — MIT

傳遞依賴的授權條款隨各自包儲存在 node_modules 中。桌面版另含 Electron（MIT）及 Chromium 等元件，其授權條款位於安裝目錄的 LICENSE 與 LICENSES.chromium.html。

## DeepSeek Harness（DSH）代理執行階段 — MIT

桌面版與 Docker 映像檔在 `dsh/`（原始碼執行階段為 `dsh-runtime/`）中附帶未經修改的 npm 包
`@deepseek-ai/dsh@0.2.1-rc.4` 與 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.4`，作為獨立子程序執行。

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

DSH 的傳遞依賴以未修改形式隨附，各自授權條款儲存在包目錄內。大部分為 MIT / Apache-2.0 / BSD / ISC；
另含 `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5`（MPL-2.0，原始碼見 LibreOffice 專案）與
`@img/sharp-libvips-*`（LGPL-3.0-or-later，可單獨替換的動態庫）。

`dsh-runtime/plugins/amb-bridge.mjs`（核准 / 讀取圍欄外掛程式）為本專案原創程式碼（MIT）。

聊天規則（`src/agent/prompts/system.ts`）、每次模型請求現讀的系統提示詞段（`dsh-runtime/plugins/amb-prompt.mjs`）、
提示詞約定測試與字元數上限（`test/prompts.unit.test.ts`）的思路參考了 DeepSeek 的 dsh-superagent
（MIT，Copyright (c) 2026 DeepSeek Harness Team）：它的注意力原則、按請求重算的 system-prompt 段與 prompt 測試。
文字和程式碼為本專案重寫，未複製其程式碼。

## dsh-superagent（持久化出站佇列的設計 — MIT）

來源：https://github.com/deepseek-ai/dsh-superagent-prototype （DeepSeek Harness Team 的研究原型）

`src/core/outbox.ts`（持久化出站佇列）的設計改編自它的 `src/app/outbox.ts` 與 `src/app/effects.ts`：
訊息先寫回執再傳送、同一 id 只發一次、同一對話按順序發且前一條失敗會擋住後面的、`Later`（暫時不能發，不計失敗）、
指數退避重試、關機時把沒發完的留到下次啟動。程式碼按本專案的 sqlite 儲存與管道重新編寫，未直接複製。

```
MIT License

Copyright (c) 2026 DeepSeek Harness Team

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

## DS Bot（長期記憶、上下文管家、機器人設定 — Apache-2.0）

來源：https://github.com/Fei2411/DS-Bot

以下內容移植或改編自 DS Bot，並按 Apache License 2.0 第 4 條作了修改（改寫為 TypeScript、連接本專案的儲存與管道、中文提示）：

- src/agent/memory.ts：三層記憶（團隊 / 機器人 / 群）的 MEMORY.md + 主題檔案格式、大小上限、秘密過濾的模式（改編自 ds-bot/src/host/memory.js）。
- src/agent/steward.ts、src/agent/manager.ts：上下文管家的閾值演算法與判定提示詞（壓縮 / 開新段 + 交接），凍結的記憶前綴（改編自 ds-bot/src/host/steward.js 與 docs/plans/2026-10-09-context-and-memory.md）。
- src/agent/settings.ts：每個機器人的權限預設與設定思路。

DS Bot 的 NOTICE 原文（節選其版權聲明）：

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

DS Bot 在其 NOTICE 中說明，記憶的 Markdown 格式（每行一條、帶 [key: value] 中繼資料、MEMORY.md 索引連結主題檔案）的思路來自 AgentMemoryRepo（MIT）；交接便條與何時壓縮的思路參考了 OpenAI Codex、OpenCode、goose、pi、Gemini CLI、Hermes Agent 等專案（均未複製其程式碼）。

Apache License 2.0 全文見 LICENSES/Apache-2.0.txt（隨程式分發），亦可見 https://www.apache.org/licenses/LICENSE-2.0 。

## kimi-computer-use（macOS 電腦操作 MCP 橋 — MIT）

來源：https://github.com/songkeys/kimi-computer-use （vendor/kimi-computer-use 子模組；macOS 安裝套件隨附 bin/、skills/、LICENSE、NOTICE）

本專案隨附其 stdio MCP 橋（bin/computer-use-mcp-bridge.mjs，原樣使用）與改寫了工具名的 skills/computer-use/SKILL.md。它是獨立的非官方專案，不隨附也不再分發 OpenAI、Kimi 或其他廠商的軟體；電腦操作依賴使用者自己在 macOS 14.4+ 上安裝的 OpenAI Codex Computer Use 與 ChatGPT/Codex 應用程式。

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

## Cua Driver（跨平台電腦操作驅動 — MIT）

來源：https://github.com/trycua/cua （libs/cua-driver，發布版 cua-driver-rs-v0.37.0）

安裝套件按平台隨附官方預編譯的 `cua-driver` 執行檔（未修改），以及其 LICENSE 與 THIRD_PARTY_NOTICES.md（位於安裝目錄 resources/cua-driver/）。建置指令碼 scripts/fetch-cua-driver.mjs 固定版本並驗證每個發布包的 SHA256。本專案的 dsh-runtime/plugins/amb-cua-mcp.mjs 只是在其 stdio MCP 前面做工具過濾與清單產生，未複製其程式碼。

**未隨附**：cua-perception、OmniParser 等任何 AGPL 元件，以及 Cua Spaces 等 FSL 許可的內容。

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

Cua Driver 自身依賴的第三方元件聲明見其隨附的 THIRD_PARTY_NOTICES.md。

## yuque-mcp（語雀官方 MCP，以單檔案形式隨附 — MIT）

來源：https://github.com/yuque/yuque-mcp-server （npm 包 yuque-mcp 1.0.0）

- 以封裝後的單個檔案隨附（`vendor/yuque-mcp/yuque-mcp.mjs`，由 `scripts/vendor-yuque-mcp.mjs` 產生；唯一的改動是把執行階段讀取 `package.json` 版本號碼的地方換成常量）。「連線應用程式 › 語雀」用它連線語雀。
- 打進這個檔案的依賴及其許可見隨附的 `THIRD_PARTY_LICENSES.txt`（儲存庫裡在 `vendor/yuque-mcp/`，安裝套件裡在 `resources/yuque-mcp/`）。

```
MIT License

Copyright (c) 2026 cwg

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
