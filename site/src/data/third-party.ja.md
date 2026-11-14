# 第三者に関する告知

[简体中文](./THIRD_PARTY_NOTICES.md) | [English](./THIRD_PARTY_NOTICES_en.md) | 日本語 | [한국어](./THIRD_PARTY_NOTICES_ko.md) | [Русский](./THIRD_PARTY_NOTICES_ru.md) | [Español](./THIRD_PARTY_NOTICES_es.md) | [Português (Brasil)](./THIRD_PARTY_NOTICES_pt.md)

anymodel bot 自体は MIT ライセンスで公開されています（LICENSE 参照）。以下は本プログラムに同梱、または移植されたコンポーネントです。それぞれ元のライセンスが適用されます。

一部のコードは Fei2411/DS-Bot（Apache-2.0）から移植または改変しています。下記の「DS Bot」をご覧ください。

## Heroicons（操作アイコン）

操作アイコンは Heroicons 2.2.0 の Outline から選び、`ui/icons/heroicons.js` に SVG ノードデータとして同梱しています。MIT ライセンスで、著作権は Tailwind Labs, Inc. に帰属します。ライセンス全文は [ui/icons/LICENSE](./ui/icons/LICENSE)、固定コミットと出典のチェックサムは `ui/icons/heroicons-source.json` に記載しています。

https://github.com/tailwindlabs/heroicons/releases/tag/v2.2.0

## magpie（内蔵モデルゲートウェイのバイナリ配布、一部の画面スタイルを改変利用）

出典：<https://github.com/yetone/magpie>（vendor/magpie サブモジュール、v0.1.1720）

- バイナリとして配布：内蔵モデルゲートウェイ。
- 改変利用：`ui/design/tokens/semantic.css`、`ui/design/components/` の `button.css`、`list.css`、`seg.css`、`popover.css`、`toast.css`、および `ui/css/settings.css` の無彩色、角丸、動き、コンポーネントのスタイルは、`internal/gui/assets/app.css` を基にしています。対象には `.list` / `.row`、`.seg` のセグメント切り替え、`.pop` のポップオーバーメニュー、設定タブ、保存済みの表示が含まれます。magpie の名称・ロゴ、`assets/icons/` のベンダーロゴ、スポンサー・パートナー画像、Web サイトのスクリーンショットは使用しません。

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

## openclaw-weixin（WeChat iLink チャネル、src/channels/weixin の一部を移植）

出典：https://github.com/Tencent/openclaw-weixin

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

## npm 依存関係（実行時）

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0（パッケージ内の LICENSE 参照）
- ws 8.22.0 — MIT
- yauzl 3.4.0 — MIT
- yaml 2.9.1 — ISC
- electron-updater 6.8.12 — MIT
- @modelcontextprotocol/client 2.2.0 — MIT

間接依存のライセンスは node_modules の各パッケージに保持されています。デスクトップアプリには Electron（MIT）や Chromium なども含まれます。それらのライセンスはインストール先の LICENSE と LICENSES.chromium.html にあります。

## DeepSeek Harness（DSH）エージェントランタイム — MIT

デスクトップアプリと Docker イメージは、未改変の npm パッケージ `@deepseek-ai/dsh@0.2.1-rc.4` と `@deepseek-ai/dsh-sdk-client@0.2.1-rc.4` を `dsh/`（ソース実行時は `dsh-runtime/`）に同梱します。別の子プロセスとして実行します。

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

DSH の間接依存は未改変で配布し、各パッケージのディレクトリにライセンスを保持します。大半は MIT / Apache-2.0 / BSD / ISC です。`@deepseek-ai/libreoffice-kit(-wasm)@0.1.5`（MPL-2.0、ソースは LibreOffice プロジェクト）と `@img/sharp-libvips-*`（LGPL-3.0-or-later、個別に交換可能な動的ライブラリ）も含まれます。

承認と読み取り境界を扱う `dsh-runtime/plugins/amb-bridge.mjs` は、本プロジェクト独自のコードです（MIT）。

会話ルール（`src/agent/prompts/system.ts`）、モデルへのリクエストごとに読み直すシステムプロンプト部分（`dsh-runtime/plugins/amb-prompt.mjs`）、およびプロンプト規約のテストと文字数制限（`test/prompts.unit.test.ts`）は、DeepSeek の dsh-superagent（MIT、Copyright (c) 2026 DeepSeek Harness Team）の注意配分の原則、リクエストごとのシステムプロンプト部分、プロンプトテストから着想を得ています。文章とコードは本プロジェクト向けに書き直しており、コードのコピーはしていません。

## dsh-superagent（永続送信キューの設計 — MIT）

出典：<https://github.com/deepseek-ai/dsh-superagent-prototype>（DeepSeek Harness Team による研究用プロトタイプ）

`src/core/outbox.ts` の永続送信キューの設計は、同プロトタイプの `src/app/outbox.ts` と `src/app/effects.ts` を参考にしています。送信前の受領記録、ID ごとに一度の送信、会話内の順序維持と失敗したメッセージによる後続の待機、`Later`（まだ送れず、失敗に数えない）、指数バックオフによる再試行、終了時の未送信メッセージ保持という仕組みです。コードをコピーせず、本プロジェクトの SQLite とチャネルに合わせて書き直しています。

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

## DS Bot（長期記憶、コンテキスト管理、ボット設定 — Apache-2.0）

出典：https://github.com/Fei2411/DS-Bot

以下は Apache License 2.0 第 4 条に従って DS Bot から移植・改変しています。TypeScript への書き直し、本プロジェクトのストレージ・チャネルへの接続、中国語プロンプトへの変更を含みます。

- src/agent/memory.ts：チーム・ボット・グループの 3 層の記憶に使う MEMORY.md とトピックファイルの形式、サイズ制限、秘密情報のフィルターパターン（ds-bot/src/host/memory.js を基に改変）。
- src/agent/steward.ts、src/agent/manager.ts：コンテキスト管理のしきい値アルゴリズム、判断用プロンプト（圧縮 / 新しい区間と引き継ぎ）、固定する記憶プレフィックス（ds-bot/src/host/steward.js と docs/plans/2026-10-09-context-and-memory.md を参考）。
- src/agent/settings.ts：ボットごとの権限プリセットと設定の考え方。

DS Bot の NOTICE（著作権表示の抜粋）：

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

DS Bot の NOTICE によると、Markdown 記憶形式（1 行 1 項目、[key: value] メタデータ、トピックファイルにリンクする MEMORY.md インデックス）は AgentMemoryRepo（MIT）に由来します。引き継ぎメモと圧縮のタイミングについては OpenAI Codex、OpenCode、goose、pi、Gemini CLI、Hermes Agent などを参考にしており、これらのコードはコピーしていません。

Apache License 2.0 の全文は、プログラムとともに配布する LICENSES/Apache-2.0.txt、および https://www.apache.org/licenses/LICENSE-2.0 にあります。

## kimi-computer-use（macOS のコンピューター操作 MCP ブリッジ — MIT）

出典：<https://github.com/songkeys/kimi-computer-use>（vendor/kimi-computer-use サブモジュール。macOS 版に bin/、skills/、LICENSE、NOTICE を同梱）

stdio MCP ブリッジ（bin/computer-use-mcp-bridge.mjs はそのまま使用）と、ツール名を変更した skills/computer-use/SKILL.md を配布します。独立した非公式プロジェクトであり、OpenAI、Kimi、その他のベンダーのソフトウェアを同梱・再配布しません。操作機能は、ユーザーが macOS 14.4 以降にインストールした OpenAI Codex Computer Use と ChatGPT/Codex アプリに依存します。

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

## Cua Driver（複数 OS 対応のコンピューター操作ドライバー — MIT）

出典：<https://github.com/trycua/cua>（libs/cua-driver、リリース cua-driver-rs-v0.37.0）

インストーラーには、各プラットフォームの公式ビルド済み `cua-driver` 実行ファイルを未改変で同梱し、LICENSE と THIRD_PARTY_NOTICES.md も配布します（インストール先の resources/cua-driver/）。scripts/fetch-cua-driver.mjs はバージョンを固定し、各リリースアーカイブの SHA256 を検証します。本プロジェクトの dsh-runtime/plugins/amb-cua-mcp.mjs は stdio MCP の前段でツールを制限し、マニフェストを生成するだけです。コードのコピーはしていません。

**同梱しないもの**：cua-perception や OmniParser などの AGPL コンポーネント、Cua Spaces などの FSL コンテンツ。

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

Cua Driver 自体の依存関係の告知は、ドライバーに同梱する THIRD_PARTY_NOTICES.md にあります。

## yuque-mcp（Yuque 公式 MCP サーバー、単一ファイルとして同梱 — MIT）

出典：https://github.com/yuque/yuque-mcp-server （npm パッケージ yuque-mcp 1.0.0）

- バンドルした 1 つのファイルとして同梱しています（`vendor/yuque-mcp/yuque-mcp.mjs`、`scripts/vendor-yuque-mcp.mjs` で生成。変更点は、実行時に `package.json` からバージョンを読む箇所を定数に置き換えたことだけです）。「アプリを接続 › Yuque」が Yuque への接続に使います。
- このファイルに含まれる依存パッケージとそのライセンスは、同梱の `THIRD_PARTY_LICENSES.txt` に記載しています（リポジトリでは `vendor/yuque-mcp/`、インストール後は `resources/yuque-mcp/`）。

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
