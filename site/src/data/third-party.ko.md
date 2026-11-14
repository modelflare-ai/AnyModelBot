# 제3자 고지

[简体中文](./THIRD_PARTY_NOTICES.md) | [English](./THIRD_PARTY_NOTICES_en.md) | [日本語](./THIRD_PARTY_NOTICES_ja.md) | 한국어 | [Русский](./THIRD_PARTY_NOTICES_ru.md) | [Español](./THIRD_PARTY_NOTICES_es.md) | [Português (Brasil)](./THIRD_PARTY_NOTICES_pt.md)

anymodel bot 자체는 MIT 라이선스로 배포됩니다(LICENSE 참조). 아래 구성 요소는 프로그램에 포함되어 배포되거나 포팅되었으며 원래 라이선스를 유지합니다.

일부 코드는 Fei2411/DS-Bot(Apache-2.0)에서 포팅하거나 수정했습니다. 아래 DS Bot 항목을 확인하세요.

## Heroicons (인터페이스 아이콘)

인터페이스 아이콘은 Heroicons 2.2.0 Outline에서 선택하여 `ui/icons/heroicons.js`에 SVG 노드 데이터로 포함합니다. MIT 라이선스를 따르며 저작권은 Tailwind Labs, Inc.에 있습니다. 전체 라이선스는 [ui/icons/LICENSE](./ui/icons/LICENSE), 고정 커밋과 원본 체크섬은 `ui/icons/heroicons-source.json`에 기록되어 있습니다.

https://github.com/tailwindlabs/heroicons/releases/tag/v2.2.0

## magpie(내장 모델 게이트웨이, 바이너리 배포 및 일부 화면 스타일 수정)

출처: https://github.com/yetone/magpie (vendor/magpie 서브모듈, v0.1.1720)

- 바이너리 배포: 내장 모델 게이트웨이.
- 수정 사용: `ui/design/tokens/semantic.css`, `ui/design/components/`의 `button.css`, `list.css`, `seg.css`, `popover.css`, `toast.css` 및 `ui/css/settings.css`의 무채색, 모서리 반경, 동작, 구성 요소 스타일은 `internal/gui/assets/app.css`를 바탕으로 수정했습니다. 여기에는 `.list` / `.row`, `.seg` 분할 선택기, `.pop` 팝오버 메뉴, 설정 탭, 저장됨 표시가 포함됩니다. magpie 이름·로고, `assets/icons/`의 제공업체 로고, 후원사·파트너 이미지, 웹사이트 스크린샷은 사용하지 않습니다.

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

## openclaw-weixin(WeChat iLink 채널, src/channels/weixin의 일부 코드 포팅)

출처: https://github.com/Tencent/openclaw-weixin

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

## npm 의존성(런타임)

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0(패키지의 LICENSE 참조)
- ws 8.22.0 — MIT
- yauzl 3.4.0 — MIT
- yaml 2.9.1 — ISC
- electron-updater 6.8.12 — MIT
- @modelcontextprotocol/client 2.2.0 — MIT

전이 의존성의 라이선스는 node_modules의 각 패키지에 보관됩니다. 데스크톱 앱에는 Electron(MIT)과 Chromium 등의 구성 요소도 포함되며 라이선스는 설치 폴더의 LICENSE와 LICENSES.chromium.html에 있습니다.

## DeepSeek Harness(DSH) 에이전트 런타임 — MIT

데스크톱 앱과 Docker 이미지는 수정하지 않은 npm 패키지 `@deepseek-ai/dsh@0.2.1-rc.4`와 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.4`를 `dsh/`에 포함합니다(소스 실행 시 `dsh-runtime/`). 별도 자식 프로세스로 실행합니다.

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

DSH의 전이 의존성은 수정 없이 배포하며 각 패키지 폴더에 라이선스가 있습니다. 대부분 MIT / Apache-2.0 / BSD / ISC이며 `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5`(MPL-2.0, 소스는 LibreOffice 프로젝트)와 `@img/sharp-libvips-*`(LGPL-3.0-or-later, 개별 교체 가능한 동적 라이브러리)도 포함합니다.

승인·읽기 경계 플러그인인 `dsh-runtime/plugins/amb-bridge.mjs`는 이 프로젝트의 자체 코드(MIT)입니다.

대화 규칙(`src/agent/prompts/system.ts`), 모델 요청마다 다시 읽는 시스템 프롬프트 섹션(`dsh-runtime/plugins/amb-prompt.mjs`), 프롬프트 규약 테스트와 문자 수 제한(`test/prompts.unit.test.ts`)은 DeepSeek dsh-superagent(MIT, Copyright (c) 2026 DeepSeek Harness Team)의 주의 원칙, 요청별 시스템 프롬프트 섹션, 프롬프트 테스트에서 아이디어를 얻었습니다. 문구와 코드는 이 프로젝트에 맞게 새로 작성했으며 코드를 복사하지 않았습니다.

## dsh-superagent(영구 발신 대기열 설계 — MIT)

출처: https://github.com/deepseek-ai/dsh-superagent-prototype (DeepSeek Harness Team의 연구용 프로토타입)

`src/core/outbox.ts`의 영구 발신 대기열 설계는 해당 프로토타입의 `src/app/outbox.ts`, `src/app/effects.ts`를 참고했습니다. 전송 전 영수증 기록, ID별 한 번 전송, 대화 내 순서 보장과 실패 메시지의 후속 메시지 차단, `Later`(아직 전송할 수 없으며 실패로 계산하지 않음), 지수 백오프 재시도, 종료 시 미전송 메시지를 다음 시작까지 보존하는 방식입니다. 코드를 복사하지 않고 이 프로젝트의 SQLite 저장소와 채널에 맞게 새로 작성했습니다.

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

## DS Bot(장기 기억, 컨텍스트 관리자, 봇 설정 — Apache-2.0)

출처: https://github.com/Fei2411/DS-Bot

다음 부분은 Apache License 2.0 제4조에 따라 DS Bot에서 포팅하거나 수정했습니다. TypeScript로 재작성하고 이 프로젝트의 저장소·채널에 연결했으며 중국어 프롬프트를 사용합니다.

- src/agent/memory.ts: 팀·봇·그룹의 세 기억 계층에 사용하는 MEMORY.md+주제 파일 형식, 크기 제한, 비밀 정보 필터 패턴(ds-bot/src/host/memory.js 참고).
- src/agent/steward.ts, src/agent/manager.ts: 컨텍스트 관리자의 임계값 알고리즘과 판단 프롬프트(압축/새 구간+인계), 고정된 기억 접두사(ds-bot/src/host/steward.js 및 docs/plans/2026-10-09-context-and-memory.md 참고).
- src/agent/settings.ts: 봇별 권한 프리셋과 설정 방식.

DS Bot의 NOTICE에서 저작권 고지를 발췌합니다.

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

DS Bot의 NOTICE에 따르면 Markdown 기억 형식(한 줄에 한 항목, [key: value] 메타데이터, 주제 파일에 연결하는 MEMORY.md 색인)은 AgentMemoryRepo(MIT)에서 왔습니다. 인계 메모와 압축 시점에 관한 아이디어는 OpenAI Codex, OpenCode, goose, pi, Gemini CLI, Hermes Agent 등의 프로젝트를 참고했으며 해당 코드를 복사하지 않았습니다.

Apache License 2.0 전문은 프로그램과 함께 배포하는 LICENSES/Apache-2.0.txt 및 https://www.apache.org/licenses/LICENSE-2.0 에 있습니다.

## kimi-computer-use(macOS 컴퓨터 사용 MCP 브리지 — MIT)

출처: https://github.com/songkeys/kimi-computer-use (vendor/kimi-computer-use 서브모듈, macOS 설치 파일에 bin/, skills/, LICENSE, NOTICE 포함)

이 프로젝트는 stdio MCP 브리지(bin/computer-use-mcp-bridge.mjs, 원본 그대로)와 도구 이름을 변경한 skills/computer-use/SKILL.md를 배포합니다. 독립적인 비공식 프로젝트이며 OpenAI, Kimi 등 다른 업체의 소프트웨어를 포함하거나 재배포하지 않습니다. 컴퓨터 사용은 사용자가 macOS 14.4 이상에 설치한 OpenAI Codex Computer Use와 ChatGPT/Codex 앱에 의존합니다.

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

## Cua Driver(플랫폼 공통 컴퓨터 사용 드라이버 — MIT)

출처: https://github.com/trycua/cua (libs/cua-driver, 릴리스 cua-driver-rs-v0.37.0)

설치 파일에는 플랫폼별 공식 사전 빌드 `cua-driver` 실행 파일을 수정 없이 포함하며 LICENSE와 THIRD_PARTY_NOTICES.md도 함께 배포합니다(설치 폴더의 resources/cua-driver/). 빌드 스크립트 scripts/fetch-cua-driver.mjs에서 버전을 고정하고 모든 릴리스 압축 파일의 SHA256을 검사합니다. 이 프로젝트의 dsh-runtime/plugins/amb-cua-mcp.mjs는 stdio MCP 앞에서 도구를 걸러내고 매니페스트를 생성할 뿐이며 코드를 복사하지 않았습니다.

**포함하지 않는 구성 요소:** cua-perception, OmniParser 등의 AGPL 구성 요소 및 Cua Spaces 등의 FSL 라이선스 콘텐츠.

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

Cua Driver 자체 의존성의 제3자 고지는 드라이버와 함께 배포하는 THIRD_PARTY_NOTICES.md에 있습니다.

## yuque-mcp(Yuque 공식 MCP 서버, 단일 파일로 포함 — MIT)

출처: https://github.com/yuque/yuque-mcp-server (npm 패키지 yuque-mcp 1.0.0)

- 번들한 파일 하나로 포함됩니다(`vendor/yuque-mcp/yuque-mcp.mjs`, `scripts/vendor-yuque-mcp.mjs`로 생성. 변경한 것은 실행 중에 `package.json`에서 버전을 읽는 부분을 상수로 바꾼 것뿐입니다). ‘앱 연결 › Yuque’가 Yuque에 연결할 때 사용합니다.
- 이 파일에 포함된 의존성과 그 라이선스는 함께 제공되는 `THIRD_PARTY_LICENSES.txt`에 있습니다(저장소에서는 `vendor/yuque-mcp/`, 설치된 앱에서는 `resources/yuque-mcp/`).

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
