# Third-Party Notices

anymodel bot itself is released under the MIT License (see LICENSE). The components below are distributed with or ported into this program, and each keeps its original license.

Some code is ported or adapted from Fei2411/DS-Bot (Apache-2.0); see the "DS Bot" section below.

## magpie (built-in model gateway, shipped as a binary; parts of the UI styling are adapted from it)

Source: https://github.com/yetone/magpie (vendor/magpie submodule, v0.1.1720)

- Shipped as a binary: the built-in model gateway.
- Adapted: the neutral colors, corner radii, motion and component styles in `ui/design/tokens/semantic.css`,
  `ui/design/components/` (`button.css`, `list.css`, `seg.css`, `popover.css`, `toast.css`) and `ui/css/settings.css`
  (`.list` / `.row`, the `.seg` segmented control, the `.pop` popover menu, settings tabs, the "Saved" pill) are adapted from
  `internal/gui/assets/app.css`. We do not use the magpie name, the magpie logo, the vendor logos in `assets/icons/`,
  sponsor/partner images or website screenshots.

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

## openclaw-weixin (WeChat iLink channel; parts of the code in src/channels/weixin are ported from this project)

Source: https://github.com/Tencent/openclaw-weixin

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

## npm dependencies (runtime)

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0 (see the LICENSE in the package)
- ws 8.22.0 — MIT

Licenses of transitive dependencies are kept with each package in node_modules. The desktop app also includes Electron (MIT) and components such as Chromium; their licenses are in LICENSE and LICENSES.chromium.html in the install directory.

## DeepSeek Harness (DSH) agent runtime — MIT

The desktop app and the Docker image ship the unmodified npm packages `@deepseek-ai/dsh@0.2.1-rc.4` and
`@deepseek-ai/dsh-sdk-client@0.2.1-rc.4` in `dsh/` (`dsh-runtime/` when running from source); they run as a separate child process.

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

DSH's transitive dependencies are shipped unmodified, each with its license in its package directory. Most are MIT / Apache-2.0 / BSD / ISC;
they also include `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5` (MPL-2.0; source in the LibreOffice project) and
`@img/sharp-libvips-*` (LGPL-3.0-or-later, as separately replaceable dynamic libraries).

`dsh-runtime/plugins/amb-bridge.mjs` (the approval / read-fence plugin) is original code of this project (MIT).

The chat rules (`src/agent/prompts/system.ts`), the system-prompt segment re-read on every model request (`dsh-runtime/plugins/amb-prompt.mjs`),
and the prompt-convention tests and character limits (`test/prompts.unit.test.ts`) take ideas from DeepSeek's dsh-superagent
(MIT, Copyright (c) 2026 DeepSeek Harness Team): its attention principles, the per-request system-prompt segment and its prompt tests.
The text and code were rewritten for this project; none of its code was copied.

## dsh-superagent (design of the persistent outbound queue — MIT)

Source: https://github.com/deepseek-ai/dsh-superagent-prototype (a research prototype by the DeepSeek Harness Team)

The design of `src/core/outbox.ts` (the persistent outbound queue) is adapted from its `src/app/outbox.ts` and `src/app/effects.ts`:
write a receipt before sending, send each id only once, send in order within a conversation with a failed message blocking the ones behind it, `Later` (can't send yet, not counted as a failure),
exponential-backoff retries, and keeping unsent messages for the next start at shutdown. The code was rewritten for this project's sqlite storage and channels, not copied.

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

## DS Bot (long-term memory, context steward, bot settings — Apache-2.0)

Source: https://github.com/Fei2411/DS-Bot

The following were ported or adapted from DS Bot and modified under Section 4 of the Apache License 2.0 (rewritten in TypeScript, wired into this project's storage and channels, Chinese prompts):

- src/agent/memory.ts: the MEMORY.md + topic-file format of the three memory layers (team / bot / group), size limits and secret-filter patterns (adapted from ds-bot/src/host/memory.js).
- src/agent/steward.ts, src/agent/manager.ts: the context steward's threshold algorithm and decision prompts (compact / start a new segment + handoff), and the frozen memory prefix (adapted from ds-bot/src/host/steward.js and docs/plans/2026-10-09-context-and-memory.md).
- src/agent/settings.ts: per-bot permission presets and the approach to settings.

DS Bot's NOTICE (copyright statement excerpted):

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

DS Bot's NOTICE states that the Markdown memory format (one entry per line, [key: value] metadata, a MEMORY.md index linking topic files) comes from AgentMemoryRepo (MIT), and that the handoff notes and when-to-compact ideas draw on OpenAI Codex, OpenCode, goose, pi, Gemini CLI, Hermes Agent and other projects (none of their code was copied).

The full text of the Apache License 2.0 is in LICENSES/Apache-2.0.txt (distributed with the program) and at https://www.apache.org/licenses/LICENSE-2.0 .

## kimi-computer-use (macOS computer-use MCP bridge — MIT)

Source: https://github.com/songkeys/kimi-computer-use (vendor/kimi-computer-use submodule; the macOS installer ships bin/, skills/, LICENSE and NOTICE)

This project ships its stdio MCP bridge (bin/computer-use-mcp-bridge.mjs, used as is) and skills/computer-use/SKILL.md with renamed tools. It is an independent, unofficial project and neither ships nor redistributes software from OpenAI, Kimi or other vendors; computer use relies on OpenAI Codex Computer Use and the ChatGPT/Codex app, installed by the user on macOS 14.4+.

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

## Cua Driver (cross-platform computer-use driver — MIT)

Source: https://github.com/trycua/cua (libs/cua-driver, release cua-driver-rs-v0.37.0)

The installers ship the official prebuilt `cua-driver` executable for each platform (unmodified), together with its LICENSE and THIRD_PARTY_NOTICES.md (in resources/cua-driver/ in the install directory). The build script scripts/fetch-cua-driver.mjs pins the version and verifies the SHA256 of every release archive. This project's dsh-runtime/plugins/amb-cua-mcp.mjs only filters tools and generates the manifest in front of its stdio MCP; none of its code was copied.

**Not shipped**: any AGPL components such as cua-perception and OmniParser, and FSL-licensed content such as Cua Spaces.

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

Third-party notices for Cua Driver's own dependencies are in the THIRD_PARTY_NOTICES.md that ships with it.

