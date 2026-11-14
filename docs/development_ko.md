# 개발 안내

[简体中文](./development.md) | [English](./development_en.md) | [日本語](./development_ja.md) | 한국어 | [Русский](./development_ru.md) | [Español](./development_es.md) | [Português (Brasil)](./development_pt.md)

소스에서 AnyModelBot을 실행하거나 패키징하고 기여하려는 분을 위한 안내입니다. 앱을 사용하기만 하려면 [릴리스](https://github.com/modelflare-ai/AnyModelBot/releases)에서 설치 파일을 받으세요. [README](../README_ko.md#-다운로드-및-실행)를 참고하세요.

- 봇은 역할, 기본 모델, 기억으로 구성됩니다. 계정은 전역 설정(설정 › 채팅 채널)으로 관리하며 모든 봇이 공유합니다. 서비스별 계정 수는 자유롭게 추가할 수 있습니다. 한 사람이 개인적으로 사용하는 환경을 대상으로 합니다.
- 모델은 Modelflare 계정 또는 내 공식 API 키로 사용합니다. [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)에서 제공합니다. 처음 실행할 때 로그인하거나 가입하면 모델 목록이 자동으로 나타납니다. 요청은 내장 [magpie](https://github.com/yetone/magpie) 게이트웨이를 거칩니다.
- 하나의 코드로 세 가지 방식으로 실행합니다: **데스크톱 앱(Electron)**, **명령줄 `npm start`**, **Docker**.

## 저장소 구조

```
src/
  core/          공통 메시지 타입, 세션 대기열과 중복 제거, 런타임(/model /reset, 스트리밍), 재시작 안내, 접근 허가(소유자+허용 목록), 영구 보낼 편지함
  delivery/      먼저 보내는 메시지 전달: 방해 금지 시간, 하루 상한, 요약 묶음, WeChat 24시간 창과 연장 알림
  agent/         에이전트 모드: DSH 호스트·브리지, 승인, 권한 프리셋, 기억·컨텍스트 관리자, DSH 세션 폴더
    prompts/     에이전트 모델이 읽는 모든 프롬프트: 역할, 대화 규칙, 기억 안내, 구간 첫 메시지, 스킬
  tools/         에이전트가 쓰는 기능: 웹 검색(search.ts), 이미지·동영상 생성(media/), 컴퓨터 사용(computer-use/), Windows PowerShell(pwsh/), 앱 연결 — 기본 제공 앱 커넥터와 커스텀 MCP(apps/), 기존 Notion·Feishu 계정(accounts/)
  llm/           OpenAI 호환 클라이언트(모델 접근 인터페이스)
  magpie/        magpie 관리: 격리 폴더, 빈 포트, 비밀 값 생성, 상태 검사, 충돌 후 재시작, 정상 종료
  channels/      feishu/(지속 연결+CardKit) weixin/(iLink; MIT 고지는 LICENSE.openclaw-weixin) messenger/(Telegram·Slack·Discord 공통 송수신 경로)
  tasks/         백그라운드 작업과 규칙: 실행, 단계, 비용, 보존과 정리, 일정
  botkit/        카탈로그 봇 프레임워크: 패키지 형식, 검사, 패킹과 서명, 카탈로그, 설치, UI 정적 경로(docs/bot-framework.md 참고)
  skills/        사용자가 직접 설치하는 스킬(ZIP 패키지)
  store/         SQLite(node:sqlite, 네이티브 빌드 불필요)
  domain/        순수 데이터 형태와 규칙: 봇 설정, 방해 금지 시간, 일정, 카탈로그 봇 기록, 에이전트 단계. I/O 없음, i18n에만 의존. store는 여기에만 의존(의존 방향은 test/architecture.unit.test.ts에서 검사)
  account/       Modelflare 계정: PKCE 루프백 로그인, 토큰 교체, 잔액·알림, 봇별 예산 키, 모델 기능·참고 가격
  web/           콘솔 서버: server.ts가 시작·인증·분배, routes/에 영역별 API(JSON API+SSE 실시간 대화), http.ts는 공용 도우미
  cli/           첫 실행 init 마법사, weixin-login
  providers/     모델 출처: modelflare.ts(경로, 키 검증 GET /v1/models, 모델 라우팅·출처 표시), modelflare-domains.ts(경로 속도 측정), official.ts(공식 API 제공업체 목록, 주소 고정)
  updates/       업데이트: check.ts(새 버전 확인), desktop.ts(데스크톱 다운로드와 재시작)
  guide.ts       시작 체크리스트 진행 상태
  i18n/          서버 다국어: 오류, 상태 문구, 트레이 메뉴, 봇 시스템 메시지(messages/<namespace>.ts)
  diagnostics.ts 문제 해결: 진단 요청, 최근 로그, 비밀 정보를 가린 진단 보고서
  version.ts     앱 버전(package.json)
  main.ts        명령줄 진입점
electron/        데스크톱 메인 프로세스(실행기+트레이)
ui/              콘솔 화면(Preact+htm, 별도 빌드 없음)
  design/        디자인 시스템: tokens/, base/, components/, 봇 캐릭터 bots/
  locales/       화면 문구: zh-CN/, en/ 등 언어별·네임스페이스별 파일
  css/ lib/ components/ screens/ assets/ main.js
dsh-runtime/     DSH 에이전트 런타임 의존성 및 AnyModelBot 플러그인(plugins/)
scripts/         setup / build-magpie / fetch-cua-driver / prepare-dsh / bundle-dsh / electron-smoke / check-readme 등
vendor/          Git 서브모듈: magpie(빌드 시 컴파일), deepseek-harness, kimi-computer-use
site/            웹사이트(Astro 정적 사이트), site/README.md 참조
docs/            개발 안내, 개인정보 안내, README 자료(docs/assets/)
```

## 소스에서 실행하기(명령줄)

Node.js 22.13 이상과 magpie 소스 컴파일을 위한 Go 1.26.8 이상이 필요합니다.

```bash
npm install
npm run setup        # vendor/magpie 서브모듈을 가져와 build/bin/에 컴파일
npm run init         # 선택: 터미널에서 첫 설정(Modelflare 로그인, Feishu 인증 정보)
npm start            # 게이트웨이+봇+http://127.0.0.1:3600/ 콘솔 시작
```

기본 데이터 폴더는 `./data`이며 `AMB_DATA_DIR`로 변경할 수 있습니다. 다른 환경 변수는 `.env.example`을 확인하세요.

## 데스크톱 앱(Electron)

```bash
npm run electron:dev     # 개발 모드 실행
npm run electron:smoke   # 스모크 테스트(화면 없는 Linux는 xvfb-run 자동 사용)
npm run dist             # 현재 플랫폼용 패키징(magpie는 resources/magpie/에 포함)
npm run dist:linux | dist:mac | dist:win
npm run test:dsh-bundle  # 패키징된 build/dsh의 실제 DSH 통합 테스트(Electron, 먼저 prepare:dsh+bundle:dsh 실행)
```

- DSH 에이전트 런타임: `scripts/prepare-dsh.mjs`가 대상 플랫폼에 맞게 `dsh-runtime/`을 설치하고 `scripts/bundle-dsh.mjs`가 `resources/dsh/dsh.asar`(모든 JavaScript를 한 파일로)와 `resources/dsh/node_modules/`(네이티브 패키지만, 약 55개 파일)로 묶습니다. Electron 메인 프로세스와 `ELECTRON_RUN_AS_NODE` 자식 프로세스는 asar를 직접 읽으며 첫 실행 때 압축을 풀지 않습니다. 설치 프로그램이 수백 개의 파일만 풀면 되므로 Windows의 압축 해제와 파일별 백신 검사로 인한 지연을 줄입니다. 개발 중에는 `dsh-runtime/`을 직접 사용합니다.
- Windows 에이전트 명령용 PowerShell: 샌드박스에서 Windows PowerShell 5.1은 명령당 20~30초, PowerShell 7은 약 1초가 걸립니다. 선택 순서는 시스템의 사용 가능한 PowerShell 7(DSH와 같은 방식으로 백그라운드에서 한 번 시험하며 다운로드하지 않음) → 앱 전용 PowerShell 7 → Windows PowerShell 5.1입니다. 사용 가능한 7이 없고 에이전트 모드가 켜져 있으면 공식 PowerShell 7.6.9(LTS) zip을 백그라운드에서 `%LOCALAPPDATA%\AnyModelBot\pwsh\`로 다운로드합니다. 관리자 권한, 레지스트리 쓰기, PATH 변경이 필요 없으며 기존 PowerShell에도 영향을 주지 않습니다. 버전과 x64/arm64 zip의 SHA256은 `src/tools/pwsh/private.ts`에 고정합니다(`node scripts/pwsh-hashes.mjs <version>`으로 갱신). 다운로드 후 해시, 압축 해제 후 Microsoft Authenticode 서명을 확인하고 DSH 방식의 시험 실행(버전, 임시 파일 읽기·쓰기, 외부 프로그램 실행)을 통과해야 사용합니다. 실패하거나 미완료된 설치는 사용하지 않고 다음 실행 시 정리합니다. 설치 중에는 대화 화면, 설정 → 일반, `/status`에 진행 상황을 표시하며 준비될 때까지 5.1을 사용합니다. 대기 중인 에이전트는 앱 재시작 없이 전환됩니다. 실행 중 시작할 수 없게 되면(삭제·백신 격리·정책 차단) 이전 선택지로 돌아가고 이유를 안내합니다. 설정 → 문제 해결에서 설치·재설치·시스템 기본값 복귀가 가능합니다. Windows 10 1607 / Server 2016보다 오래된 시스템에서는 다운로드하지 않습니다. 데스크톱 앱은 Chromium 네트워크 스택으로 시스템 프록시를 사용하고 명령줄은 Node fetch를 사용합니다(최근 Node에서는 `NODE_USE_ENV_PROXY=1`일 때 `HTTPS_PROXY` 적용). `AMB_PWSH_MIRROR`로 미러 접두사를 지정해도 해시와 서명은 검사하며 `AMB_PWSH_AUTO_INSTALL=0`으로 자동 설치를 끕니다.
- 에이전트 명령은 네트워크에 접근하며 프록시를 사용합니다(샌드박스는 쓰기만 제한). `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`와 소문자 형태, 인증서·패키지 인덱스 변수(`SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, `PIP_INDEX_URL`, `npm_config_registry`, `GOPROXY` 등)를 앱 환경에서 전달합니다. 환경에 프록시가 없으면 데스크톱 앱이 에이전트 시작마다 시스템 설정과 PAC를 조회해 `http://host:port` 형태로 전달합니다(`src/agent/proxy-env.ts`). 루프백(`127.0.0.1`, `localhost`, `::1`)은 항상 `NO_PROXY`에 추가하며 프록시를 거치지 않습니다.
- 데이터 폴더: `<userData>/data`(macOS `~/Library/Application Support/anymodel bot/data`, Windows `%APPDATA%\anymodel bot\data`, Linux `~/.config/anymodel bot/data`). 로그는 데이터 폴더의 `logs/app.log`에 있습니다.
- 단일 인스턴스로 실행합니다. 창을 닫으면 기본적으로 트레이에 숨깁니다(설정 → 일반에서 종료하도록 변경 가능). 트레이 메뉴: 열기 / 브라우저에서 열기 / 로그인 시 실행(macOS, Windows) / 데이터 폴더 열기 / 종료.
- macOS 창에는 제목 표시줄이 없고 창 제어 버튼은 사이드바 상단에 있습니다. 최소 창 너비는 860입니다.
- 콘솔은 127.0.0.1에서만 수신 대기하고 시작마다 임의 접근 토큰을 생성하여 다른 로컬 프로그램의 관리 API 직접 호출을 막습니다.
- 종료 시 채널을 먼저 중지하고 magpie를 종료합니다. 이전 실행이 강제 종료되어 magpie가 남았다면 다음 실행에서 정리합니다(Linux/macOS).

릴리스: `CHANGELOG.md`, `CHANGELOG_en.md`, `CHANGELOG_ja.md`, `CHANGELOG_ko.md`, `CHANGELOG_ru.md`, `CHANGELOG_es.md`, `CHANGELOG_pt.md`에 해당 버전의 변경 사항을 작성합니다(웹사이트나 내부 구현보다 사용자가 느끼는 변경 중심, 영문 사이트는 WeChat·Feishu가 언급된 줄 제외). `package.json`의 `version`을 올리고 커밋한 뒤 `v<version>` 태그를 푸시합니다. 변경 내역이 없으면 릴리스 워크플로가 처음에 실패합니다. 있으면 GitHub Release 노트와 사이트 변경 내역에 반영됩니다. 앱의 ‘업데이트 내용’ 대화상자도 같은 변경 내역을 읽습니다. `CHANGELOG*.md`는 설치 파일과 Docker 이미지에 포함되며(`src/changelog.ts`), 아직 설치하지 않은 새 버전의 내용은 사용자가 열 때 해당 버전 태그에서 읽어 옵니다. `.github/workflows/release.yml`이 6개 OS/아키텍처 러너에서 빌드하고 설치 파일과 `SHA256SUMS`를 GitHub Release에 게시합니다. 서명·공증에 필요한 저장소 비밀 값은 해당 파일 상단 주석을 확인하세요. 같은 태그가 `.github/workflows/docker.yml`도 실행하여 x64+arm64 이미지를 `ghcr.io/modelflare-ai/anymodel-bot`에 `<version>`, `latest` 태그로 게시합니다. 태그로 배포할 때 macOS 설치 파일은 Developer ID 서명과 공증이 필수이며, 패키징 후 .app과 DMG 안의 .app을 `spctl` 등으로 검사해 통과하지 못하면 실패합니다. 정식 빌드는 개발자 도구를 끕니다. 디버그 빌드가 필요하면 `npm run dist:debug`를 쓰거나 Release를 수동 실행할 때 `debug_build`를 선택합니다(파일 이름에 `-debug-`가 붙고, 태그에서는 거부되며, `scripts/check-build-flavor.mjs`가 패키지 결과를 확인합니다).

버전을 배포할 때마다 공식 사이트, 관련 문서와 모든 언어의 README를 함께 업데이트합니다. `npm --prefix site run sync`로 사이트 내용을 동기화하고 GitHub Release와 Docker 이미지 게시 후 [사이트 배포 안내](../site/README.md)에 따라 운영 사이트를 갱신합니다. `/download`, `/changelog`, `/bots`의 버전, 다운로드 링크와 설명이 일치하는지 확인하며 운영 사이트까지 반영되어야 배포가 완료됩니다.

앱 내 업데이트는 0.1.29부터 패키징된 macOS, Windows, Linux AppImage에서 `electron-updater`로 제공합니다. `ui.autoDownloadUpdates`의 기본값은 `true`이며 설정 → 일반에서 변경합니다. 다운로드 후 알림만 표시하고 일반 종료 시에는 설치하지 않습니다. 재시작 전에 실행 중인 대화와 백그라운드 작업을 확인합니다. 0.1.28 이전 사용자는 업데이트 기능이 포함된 버전을 한 번 직접 설치해야 합니다. GitHub 빌드는 macOS DMG와 업데이트용 ZIP, 아키텍처별 `latest-${arch}` 메타데이터와 blockmap을 만들고 모든 파일 업로드 후 Release를 공개합니다. CLI, Docker와 패키징하지 않은 개발 실행은 수동 업데이트를 유지합니다.

## Docker

사용자는 게시된 이미지로 실행합니다: `docker run -d --name amb -p 3600:3600 -v amb-data:/data ghcr.io/modelflare-ai/anymodel-bot`. 소스에서 직접 빌드하려면:

```bash
git submodule update --init --depth 1 vendor/magpie
docker build -t anymodel-bot .
docker run -d --name amb -p 3600:3600 -v amb-data:/data anymodel-bot
docker exec amb cat /data/ui-token     # http://<host>:3600/?token=<token> 열기
```

컨테이너 내부 콘솔은 0.0.0.0에서 수신 대기하므로 토큰 접근이 필수입니다. 3600 포트를 인터넷에 직접 노출하지 마세요. WeChat QR 로그인은 설정 › 채팅 채널에 있습니다.

## 모델(Modelflare)

- 첫 화면의 ‘Modelflare 로그인 / 회원가입’을 누르면 시스템 브라우저에서 로그인·가입하고 계속 버튼으로 접근을 허용합니다. 앱으로 돌아오면 이 컴퓨터 전용 API 키를 발급·연결하고 기본 모델을 선택한 뒤 대화를 시작합니다. Docker·원격 배포는 브라우저 콜백을 받을 수 없으므로, 로그인 후 이동하는 열리지 않는 `127.0.0.1` 주소의 링크를 첫 화면에 붙여 넣습니다(`POST /amb/api/account/login/complete`, state와 PKCE 검증은 동일). 이전 버전에서 API 키를 입력하고 로그인하지 않은 경우 업그레이드할 때 키를 기기에서 제거하므로 로그인해야 합니다. 브라우저 콜백 페이지는 먼저 ‘로그인을 완료하는 중’을 보여 주고, 토큰 교환·계정 조회·기기 전용 키 발급·게이트웨이 연결이 모두 성공한 뒤에야 ‘로그인 성공’을 표시합니다(실패하면 이유 표시). 데스크톱 앱은 `anymodelbot://` 링크를 등록하고, 페이지는 열릴 때 한 번 앱을 열어 보며 ‘AnyModelBot 열기’로 다시 시도할 수 있습니다. 앱이 실제로 그 링크를 받았을 때만 ‘돌아갔습니다’를 표시합니다. 직접 API 키를 쓰는 화면에서도 Modelflare 계정으로 바로 로그인할 수 있습니다. 처음 연결할 때 전역 기본 모델이 비어 있으면 `src/account/first-model.ts`의 규칙(도구 호출 지원, 1회 선점 금액과 대표 작업 비용이 체험 한도 안, DeepSeek 우선)으로 첫 사용 모델을 한 번 고릅니다. 맞는 모델이 없으면 미리 고르지 않고 사용자가 고릅니다.
- 로그인 방식은 RFC 8252의 네이티브 앱에 맞춘 OIDC 인증 코드+PKCE(RFC 7636)입니다. 공개 클라이언트(`client_id`: `anymodel-bot`)로서 클라이언트 비밀 값이 없고 필요하지도 않습니다. 결과는 `127.0.0.1`의 임시 포트로 전달됩니다. Modelflare 프로필의 인증된 앱에서 권한을 취소하면 앱이 이를 감지해 로그인 화면으로 돌아옵니다.
- 갱신 토큰은 데이터 폴더의 `modelflare-account.json`(권한 600)에 저장하며, 내장 게이트웨이의 API 키처럼 파일 권한으로만 보호하고 시스템 키체인은 쓰지 않습니다(0.1.30 이하 데스크톱 앱이 암호화한 파일은 처음 읽을 때 평문으로 다시 씁니다). 화면에는 계정 이름만 전달합니다. 로그아웃하면 컴퓨터의 권한을 취소하고 Modelflare가 로그인 시 컴퓨터·봇에 발급한 키를 삭제합니다.
- 잔액은 설정 → 모델 상단에 Bot 크레딧과 남은 비율과 함께 바로 표시됩니다. 사이드바의 잔액 링과 호버 카드는 없습니다. 충전은 Modelflare를 열고, 설정 진입과 앱 복귀 시 잔액을 갱신하며 수동 새로고침도 지원합니다. 설정한 알림 기준 아래가 되면 앱에서 알리고 채팅으로도 보낼 수 있습니다.
- 로그인하면 설정 → 모델에 일별·모델별 사용량, Modelflare 알림, 초대 링크도 표시합니다.
- 봇 예산(로그인 필요): 봇 설정 → 예산. 켜면 설정 금액이 한도인 전용 키(게이트웨이의 별도 provider)를 쓰고 끄면 공유 키로 돌아갑니다.
- 추론 강도: 모델 선택 패널 또는 설정 → 모델에서 고릅니다(자동 / 낮음 / 보통 / 높음). 전역 설정 하나이며 다음 턴부터 적용됩니다. 자동이면 매개변수를 보내지 않고 모델 기본값을 씁니다. 지원하는 모델에만 적용됩니다. Responses API의 추론 모델, 모델 프로필에 추론으로 표시된 Chat 및 Claude입니다(Claude 4.6 이상은 adaptive와 `output_config.effort`, 이전 모델은 `budget_tokens`).
- 이미지·동영상 생성: 에이전트에 `media_models`(모델·기본값·매개변수 범위·참고 가격), `media_docs`(docs.modelflare.dev에서 요청 형식 실시간 조회), `generate_image`, `generate_video`와 내장 미디어 스킬을 제공합니다. 모델마다 형식이 달라 문서를 보고 요청 본문을 작성합니다. 작업 공간의 참고 이미지는 `workspace:path`로 지정합니다. 키는 앱을 벗어나지 않습니다. 앱이 봇 키로 Modelflare를 호출하고 작업 공간 `media/`에 결과를 저장해 대화로 전달합니다.
- 생성 전 확인: 기본적으로 즉시 생성합니다. 기본 모델이 아니거나 요청이 모호하다는 이유만으로 묻지 않고 합리적으로 해석한 뒤 결과에서 사용한 내용을 한 줄로 설명합니다. 예상 비용이 $0.5를 넘을 때만 프롬프트·매개변수·참고 가격·확인 이유와 함께 모델을 묻습니다(이미지 수, 동영상 길이·해상도 등으로 계산하며 비용을 추정할 수 없는 동영상도 포함). 승인·모델 변경·취소가 가능하며 WeChat에서는 번호나 모델 이름으로, Feishu/웹에서는 클릭으로 답합니다. 10분 내 답이 없으면 생성하지 않습니다. 항상 확인하려면 봇 설정 → 이미지와 동영상 → 생성 전에 확인 → 항상 확인을 선택하세요.
- 웹 검색: `web_search`는 DeepSeek 키가 필요한 자체 검색을 쓰지 않고 `amb-web-search` 플러그인을 통해 앱에 위임합니다. 기본 검색은 무료이며 Exa 공개 MCP, Bing, DuckDuckGo를 순서대로 시도하되 최근 성공한 것을 우선합니다. 실패한 제공업체(요청 제한, 봇 검사, 무관한 Bing 결과)는 10분간 건너뜁니다. 설정 → 네트워크 및 접근 → 웹 검색에서 Tavily, Exa, Bocha, Zhipu(키 필요), 자체 SearXNG를 지정하면 우선 사용하고 실패 시 무료 검색으로 대체합니다. 키는 채널 토큰처럼 로컬 DB에 저장하며 에이전트에 전달하지 않습니다. 데스크톱은 시스템 프록시, 명령줄은 Node fetch(`NODE_USE_ENV_PROXY=1`이면 `HTTPS_PROXY` 적용)를 사용합니다.
- 채팅 채널 계정(`src/core/routes.ts`): WeChat, Feishu, Telegram, Slack, Discord도 전역 계정입니다. 설정 › 채팅 채널에서 추가하고 별칭을 지정합니다. 메시지 수신 봇은 사용자가 `/bot`으로 선택한 봇 → 계정 기본 봇 → 첫 번째 봇 순서입니다. `/bot`은 목록, `/bot name`은 전환 후 선택 저장입니다. 각 봇의 시스템 프롬프트에 다른 봇과 전환법을 넣어 관련 질문에 답하게 합니다. 소유자·허용 목록은 계정에 속하므로 허용된 사용자는 모든 봇과 대화할 수 있습니다. 계정 키는 네임스페이스이며 기존 채널은 이전 봇 ID를 유지해 로그인·한도·허용 목록·대기열과 기본 봇이 그대로 남습니다. 봇 삭제는 계정에 영향을 주지 않습니다.
- 앱 연결(`src/tools/apps/service.ts`): 전역 목록 하나(아바타 메뉴 › 앱 연결)입니다. 기본적으로 모든 봇이 연결된 앱을 사용할 수 있고, 봇별·도구별로 좁힐 수 있습니다(봇 설정 › 앱). 앱은 앱 페이지에서 카드 하나로 표시되며 여러 계정을 가질 수 있습니다. 어떤 봇에게든 ‘첫 번째 Feishu와 두 번째 Feishu 확인해 줘’라고 할 수 있고, 계정은 도구의 `account` 인수(번호 또는 이름)로 고릅니다.
  - **기본 제공 앱**(`catalog.ts`): Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva. 인증 방식은 커스텀 커넥터와 같습니다: 로그인 인증(OAuth, 동적 등록, `oauth.ts`), 요청 헤더, 쿼리 매개변수, 전용 URL. Yuque는 앱에 포함된 로컬 프로그램(`vendor/yuque-mcp`, `scripts/vendor-yuque-mcp.mjs`로 생성)이며 사용자는 토큰만 붙여넣습니다.
  - **커스텀 커넥터**: 원격 Streamable HTTP(연결되지 않으면 구형 SSE) 또는 로컬 명령, 최대 20개. 붙여넣기 인식과 양식 ⇄ JSON 변환은 `ui/lib/connector-config.js`에 있습니다. 로컬 명령은 로그인 셸의 PATH(`shell-path.ts`)로 실행하며, 처음에 패키지를 내려받는 실행기(npx, uvx)는 더 오래 기다립니다.
  - **연결은 메인 프로세스가 합니다**(`mcp-client.ts`, 공식 `@modelcontextprotocol/client`): 자격 증명은 메인 프로세스에만 있고 `app-secrets.json`(권한 600, 데이터베이스 밖, `secrets.ts`)에 저장됩니다. `amb-connections` 플러그인이 각 도구 호출을 bridge를 통해 앱에 넘깁니다. MCP 연결의 도구는 하나씩 등록하지 않고, 모델에는 고정된 도구 세 개를 줍니다: `app_tools`(도구 찾기), `app_tool_schema`(매개변수 보기), `app_call`(실행). 그리고 `app_connect`로 사용자에게 연결을 요청할 수 있습니다(대화에 카드가 나타나고, 연결되면 작업을 이어갑니다).
  - **승인**(`service.ts`의 `gate`, 사용자에게 묻는 부분은 `agent/manager.ts`): 읽기는 바로 실행합니다. 쓰기는 봇의 권한 수준을 따릅니다(읽기 전용 봇에는 주지 않고, 기본 수준에서는 먼저 묻되 ‘앞으로 이 도구는 항상 허용’을 고를 수 있으며, 전체 권한에서는 바로 실행). 삭제와 외부 전송은 매번 묻고, ‘관찰만’ 하는 규칙은 쓸 수 없습니다. 도구의 종류는 `classify.ts`에서 정합니다: 기본 제공 앱은 내장 목록과 공식 주석을 쓰고, 커스텀 커넥터의 주석은 초깃값일 뿐 사용자가 바꿀 수 있습니다.
  - **기존 Notion·Feishu 계정**(`src/tools/accounts/`): 업그레이드 전에 연결한 계정은 다시 인증하지 않아도 그대로 쓸 수 있고, 토큰은 첫 실행 때 데이터베이스에서 `app-secrets.json`으로 옮겨집니다. Notion(`notion.ts`)은 한 번의 접근 허용 또는 토큰을 사용합니다: 토큰은 REST API, 접근 허용은 OAuth + PKCE + 동적 등록으로 로컬 `/oauth/notion/callback`에 돌아온 뒤 공식 원격 MCP(`mcp.notion.com`)를 호출합니다. 모델에는 여전히 `notion_search`, `notion_read_page`, `notion_query_database`, `notion_create_page`, `notion_update_page`가 보이며 삭제는 없습니다. Feishu(`feishu.ts`)의 기존 계정은 사용자 신원으로 메시지를 읽기만 합니다(`feishu_list_chats`, `feishu_read_chat`, `feishu_search_messages`). 새로 연결하는 Feishu 계정은 공식 원격 MCP(클라우드 문서 읽기/쓰기 + 메시지 읽기)를 쓰고, 기존 계정도 다시 인증하면 이쪽으로 바뀝니다.
- 기본 이미지·동영상 모델은 첫 설정 때 텍스트 모델과 함께 선택하고 설정 → 모델에서 변경합니다. 자동은 추천 순서 중 참고 자료가 필요 없는 첫 모델을 사용합니다.
- 모델 선택기는 컨텍스트 길이, 이미지 이해·도구·추론 기능, 공개 가격표의 100만 입력/출력 토큰당 최저 참고 가격을 표시합니다. 최종 금액은 청구서 기준입니다.
- 가성비(로그인 필요): 컴퓨터 키와 봇 예산 키에 Modelflare Smart Key의 `routing_strategy`를 넣습니다. 저렴한 가격 `low_cost`는 최저 배수부터, 균형 `balanced`는 중간 가격부터(기본값), 품질 `stable`은 최고 배수부터 시도합니다. 설정 → 모델 → 가성비 또는 모델 선택기 첫 슬라이더에서 바꾸면 기존 키도 `PATCH /api/connected-app/api-keys/<id>`로 갱신하고 로컬 DB `account.routing`에 저장합니다. 선택 이력이 없는 로그인 사용자는 첫 키 검사 때 기존 키에 균형을 한 번 적용합니다(로그: `applied the default key routing strategy`). Modelflare가 `routing_strategy`를 응답에 돌려줘야 지원으로 판정합니다. 필드를 거부하면(400/422) 제외하고 다시 발급하므로 발급·검사·예산 기능이 실패하지 않습니다. 무시하여 응답에 없을 때도 미지원으로 보고 설정을 숨긴 뒤 하루 후 재시도합니다.
- 지능(두 번째 슬라이더): 계정이 사용할 수 있고 Artificial Analysis 데이터가 있는 모델의 지능 지수(높을수록 좋음)와 작업당 비용(낮을수록 좋음)으로 파레토 경계를 구해 최대 5개 지점을 제시하며 최저가·최고 성능 모델을 항상 포함합니다. 실제 추론 강도를 기준으로 하므로 Responses API 추론 모델은 기본 medium에 맞는 AA 행, 그 외는 기본 행을 사용합니다(`src/account/model-quality.ts`). 비용은 AA 공식 가격 기준 작업당 비용 × 현재 가성비 설정의 가격 계수(사용 가능한 공개 그룹 배수 × 판매 배수)입니다. 저렴한 가격은 최저, 품질은 최고, 균형은 중간을 쓰고 기업 전용 그룹은 제외합니다. 로그아웃·미지원은 균형으로 계산합니다. 슬라이더로 모델을 전환하며 이름을 누르면 전체 목록에서 직접 선택합니다. 지점에 없는 모델은 사용자 지정으로 표시하고 지점이 두 개 미만이면 목록만 보여 줍니다. 계산은 `ui/lib/frontier.js`에 있습니다.
- AA 데이터는 `assets/model-quality.json`(`updatedAt`, `source`, 필요한 필드만, Modelflare ID 매핑 완료)에 포함합니다. `node scripts/update-model-quality.mjs`는 공개 순위 https://artificialanalysis.ai/leaderboards/models 와 Modelflare 공개 가격표를 읽습니다. `AA_API_KEY`가 있으면 공식 API를 사용합니다(키로 반환 필드를 아직 검증하지 않음). `--html <file>`, `--pricing <file>`은 저장한 파일을 사용하고 `--dry-run`은 출력만 합니다. 열 누락, 행 형식 변경, 숫자 변환 실패, 행·매핑 모델 수 부족 시 문제를 알리고 종료 코드 1로 끝내며 기존 스냅샷은 유지합니다. 규칙으로 매핑되지 않는 이름은 스크립트의 `OVERRIDES`에 지정합니다. 데이터 출처 Artificial Analysis는 선택기 하단에 표시합니다.
- 출처 표시: Modelflare 요청에는 `X-Modelflare-Skill: anymodel-bot/<version>`, 링크에는 `utm_source=anymodelbot&utm_campaign=amb_<placement>`를 넣습니다. 앱은 `amb_signup`, `amb_topup`, `amb_console` 등, README·저장소 문서는 `amb_readme`, 웹사이트는 `amb_homepage`를 사용합니다. `test/utm.unit.test.ts`가 형식을 검사합니다.
- API 도메인: 설정 → 모델 → API 도메인에서 `https://modelflare.dev/v1`, `https://origin.modelflare.dev/v1`, `https://cf.modelflare.dev/v1`을 선택합니다. 수동 검사는 앱 실행 기기에서 세 도메인의 `/v1/models`에 인증 없이 세 번 요청해 중앙 응답 시간과 성공 횟수를 표시합니다. HTTP 401은 API 응답으로 계산하며 키 유효성이나 생성 속도의 증거가 아닙니다. 자동 전환은 없습니다. 기존 설정 `auto`/`global`은 기본 도메인, `cn`은 origin, `cf`는 cf에 대응하며 지역·품질 의미가 아닙니다.
- 설정 → 모델: 계정, 잔액·충전, 잔액 알림, 사용량, 알림, 초대, 가성비, 추론 강도, 기본 모델, 모델 목록 새로고침을 제공합니다.
- 입력창 오른쪽의 모델 버튼은 현재 세션의 모델을 바꾸거나 봇 기본값으로 설정합니다. `/model`, `/reset`, `/new`, `/status`, `/stop`, `/help`도 사용할 수 있습니다.
- 작업 내역: 모델 요청의 시간·토큰, 도구 인수·출력, 재시도, 하위 에이전트 등 모든 단계를 답변 위 시간 표시줄에 접어 둡니다. 클릭하면 펼칩니다. WeChat/Feishu 세션은 정보 패널 → 최근 세션에서 진행 상황을 실시간으로 보고 중지할 수 있습니다.
- 멈춘 메시지: 모든 채널의 `/stop` 또는 정보 패널의 중지로 현재 대화 차례를 즉시 종료합니다. 10분 동안 모델 응답·도구 활동 없이 재시도만 하는 등 진행이 없으면 자동 중지하며 승인·답변 대기 시간은 제외합니다. 단일 차례의 상한은 30분입니다(`AMB_AGENT_IDLE_TIMEOUT_MS`, `AMB_AGENT_TURN_TIMEOUT_MS`). 프로세스 내부 amb-control 플러그인이 해당 차례만 취소하고 다른 대화는 계속합니다. 10초(`AMB_STOP_GRACE_MS`) 안에 멈추지 않을 때만 에이전트 프로세스를 다시 시작합니다. `/status`로 현재 단계와 마지막 진행 이후 시간을 봅니다. 웹에서 다른 봇으로 이동하거나 창을 새로고침해도 처리는 계속되며 돌아오면 내 메시지, 작성 중인 응답, 활동이 복원됩니다. 중지 버튼은 대기열·시작 중·승인 대기·일반 대화에서도 작동합니다.
- 추가 요청: 작업 중 보낸 텍스트·이미지·파일은 현재 차례에 추가되며 모델이 다음 단계에서 읽고 한 번에 답합니다. 먼저 짧은 수신 안내를 보낼 편지함으로 전송하며 10분 안에 전송하지 못하면 버립니다. 허용 목록 검사는 동일하게 적용되어 미허가자의 메시지는 합류하지 않습니다. 에이전트가 이전 메시지를 받기 전이거나 마무리 중이면 기존처럼 대기열에 넣으며 `/model`, `/reset` 같은 명령도 대기합니다. 웹에서도 응답 중 계속 입력할 수 있습니다.
- 긴 명령은 백그라운드로 이동합니다. 30초(Windows PowerShell은 60초) 이상 실행 중이면 현재 차례를 막지 않는 백그라운드 작업으로 전환하고 실행 중임을 알립니다. 끝나면 에이전트를 깨워 같은 대화에 새 메시지로 결과를 답합니다. 웹은 실시간 표시, WeChat·Feishu는 일반 답변처럼 보낼 편지함을 사용합니다. ID는 에이전트 세션·차례에서 도출해 한 번만 전송하며 WeChat 제한은 전송 시 검사합니다. Feishu는 DB에 저장한 최신 수신 메시지 ID에 답합니다. 작업 내역에 백그라운드 단계가 표시되고 `/status`, 중지, 감시 타이머도 일반 차례처럼 처리합니다.
- 대화별 모델: 하나의 에이전트 프로세스 안에서도 대화마다 모델과 API를 달리 사용합니다(API별 provider, 모델별 컨텍스트·최대 출력). 모델을 바꿔도 프로세스를 다시 시작하지 않으며 초기 패치에 없던 모델은 실행 중 추가합니다.
- 프로세스 교체: DSH SDK는 세션 닫기를 지원하지 않아 백그라운드 작업·규칙 실행의 세션이 재시작까지 남습니다(완료 후 유휴 세션당 실측 약 0.25~0.45MB). 100개를 초과하면 완전히 유휴일 때 교체합니다. 대화, 실행·정리 중인 작업이나 규칙, 승인, 압축, 백그라운드 명령이 없어야 합니다. 기존 세션은 이어지고 중단이나 사용자 알림은 없습니다. 문제 해결 상태의 `taskSessions`, `recycles`로 확인하며 `AMB_DSH_RECYCLE_SESSIONS`로 기준을 바꿉니다.
- 재시작 안내: 앱 종료·충돌 당시 처리 중이던 메시지는 대화별 DB 표시로 추적하고 완료 시 제거합니다. 다음 시작에 해당 대화로 ‘앱이 다시 시작되어 마지막 메시지의 처리를 완료하지 못했습니다. 다시 보내 주세요’라고 한 번 알립니다. 자동 재전송하지 않습니다. 웹은 기록에 추가하고 WeChat은 저장한 context_token과 기존 발신 한도를 사용합니다. 24시간·횟수 제한에 걸리면 다음 수신 메시지의 답변 앞에 알립니다. Feishu는 원래 대화로 보냅니다.
- 에이전트 API: Modelflare 공개 목록의 지원 정보에 따라 Responses API 모델(GPT-5.4 이상, Grok 4.5 이상, DeepSeek V4, GLM-5, Kimi K3 등)은 `/v1/responses`를 사용합니다(추론 기본 medium, 암호화된 추론을 기록과 함께 재전송). Responses 없이 Anthropic Messages를 지원하는 Claude는 `/v1/messages`, 나머지·목록 조회 실패·외부 엔드포인트는 Chat Completions입니다. 프로세스가 모델을 처음 쓸 때 선택하며 문제 해결 상태에 마지막 차례의 `api`와 모델 목록을 표시합니다. `AMB_AGENT_API=chat`으로 전체를 Chat Completions로 강제할 수 있고 일반 대화는 계속 이를 사용합니다. 상위 서비스가 Responses/Messages를 거부하면(HTTP 400/404/405/415/422 또는 unsupported parameter/endpoint) 해당 모델은 24시간 Chat Completions로 전환합니다. 요청 제한·잔액·권한·서비스 장애·컨텍스트 초과는 제외합니다. 데이터 폴더 `dsh/api-fallback.json`에 기록하고 로그에 경고하며 상태에 `openai-completions (fallback: reason)`을 표시합니다. 도구를 아직 호출하지 않았다면 프로세스 재시작 없이 현재 차례를 Chat으로 자동 재시도합니다. 이미 호출했다면 오류를 알리고 다음 차례부터 Chat을 사용합니다.
- 내장 게이트웨이: magpie는 데이터 폴더 안의 독립 HOME·설정으로 `--gateway` 모드에서 실행합니다. 컴퓨터의 기존 Claude/Codex 구독 인증 정보를 **읽지 않고**, 에이전트 설정을 **수정하지 않으며**, 자동 업데이트·계정 검색도 끕니다. 앱 프로세스 내부에서만 호출하며 콘솔은 magpie 페이지나 `/v1`을 프록시하지 않습니다.
- API 키는 격리된 게이트웨이 설정에만 저장합니다. 명령줄이나 로그에 기록하지 않고 프런트엔드에는 끝부분만 전달합니다.
- 개발·테스트: `AMB_MAGPIE_BASE_URL`을 OpenAI 호환 엔드포인트로 지정하면 게이트웨이를 시작하지 않고 화면은 연결 상태가 되며 계정 기능은 사용할 수 없습니다. `AMB_MODELFLARE_BASE_URL`은 Modelflare 기본 URL, `AMB_MODELFLARE_ISSUER`는 로그인·계정 API를 로컬 모의 서버로 지정합니다.

## 공식 API 키

- 시작 화면의 ‘내 API 키 사용’과 설정 → 모델에서 입력할 수 있습니다. 지원 제공업체와 주소는 `src/providers/official.ts`에 고정되어 있고, API(`GET /amb/api/official`, `PUT`/`DELETE /amb/api/official/<id>`)는 목록의 ID만 받으며 주소는 지정할 수 없습니다.
- 각각 내장 게이트웨이의 provider이며 ID는 `official-<제공업체>`, 모델 ID는 `official-<제공업체>/<모델>`입니다. Modelflare의 같은 이름 모델과 구분됩니다. 키는 명령줄 인수를 거치지 않고 게이트웨이 로컬 API의 요청 본문으로 격리된 설정에 기록됩니다.
- 확인에는 게이트웨이의 모델 목록을 사용하고(프록시와 제공업체별 인증 방식은 게이트웨이에 있음), 통과해야만 저장합니다. 모델은 1시간마다 제공업체 목록과 대조하며 대화할 수 없는 모델(음성, 이미지, 임베딩 등)은 선택기에 넣지 않습니다.
- 에이전트 API는 제공업체별로 정해집니다. OpenAI는 Responses, Anthropic은 Messages, 나머지는 Chat Completions입니다. 컨텍스트 길이, 가격, 추론 지원은 게이트웨이의 모델 목록(`/v1/models`)에서 가져옵니다. 공식 키만 있으면 Modelflare의 목록과 계정을 읽지 않습니다.
- 공식 API 모델에는 `X-Modelflare-Skill`을 붙이지 않고, 서버 측 압축을 하지 않으며(압축 엔드포인트는 Modelflare 목록에서 옴), 봇 예산의 제한도 받지 않습니다(예산은 Modelflare 키의 한도입니다). 이미지·동영상 생성은 Modelflare에 연결된 동안에만 가능합니다.
- 테스트: `AMB_OFFICIAL_BASE_URL`로 모든 제공업체를 로컬 모의 서버로 지정합니다(`test/official-providers.integration.test.ts`).

## 화면

- 그룹 대화(`src/core/groups.ts`, `ui/screens/group.js`): 봇 두 개 이상이면 ＋ 메뉴에서 그룹을 만듭니다. 구성원마다 `<bot>:web:group:<group>` 대화를 가지므로 모델·권한·기억·승인·비용은 개인 대화와 같은 경로를 따릅니다. 사용자 메시지는 `group:<group>`에 저장하고 타임라인은 ID로 합칩니다. @로 지목한 봇이 답하며 `@everyone`은 전체입니다. 지목이 없으면 마지막 응답 봇이 계속합니다. 답변에서 다른 봇을 @하면 인계하며 사용자 메시지당 최대 6회입니다. 그룹에서는 한 번에 한 봇만 답합니다.
- 사이드바: 상단에는 접기·검색·새로 만들기, 그 아래에는 텍스트가 있는 예약 항목이 있습니다. 봇·그룹·카탈로그 봇을 섹션으로 정리하고 섹션 생성·이름 변경·삭제·드래그 정렬을 할 수 있습니다. 왼쪽 아래 아바타에서 계정 메뉴와 설정(`⌘/Ctrl+,`)을 열고, 옆 업데이트 버튼으로 다운로드한 뒤 준비가 되면 재시작하여 설치합니다.
- 대화 화면: 상단 봇 이름을 누르면 정보 패널(`⌘/Ctrl+⇧+I`)이 열립니다. 기본 응답 채널 계정, 승인 대기, 작업·규칙, 기억, 최근 세션을 보여 주며 ⚙로 봇 설정을 엽니다. 응답은 Markdown과 코드 한 번에 복사를 지원하며 실시간 표시하고 `Esc`로 중지합니다. 승인·질문은 카드로 표시합니다. 위로 스크롤해도 강제로 맨 아래로 이동하지 않습니다.
- 명령 팔레트는 `⌘/Ctrl+K`입니다. 테마(시스템/라이트/다크)는 설정 → 일반에 있습니다.
- 언어: 설정 → 일반 → 언어에서 중국어 간체·영어·일본어·한국어·러시아어·스페인어·포르투갈어(브라질)를 선택합니다. 첫 화면 오른쪽 위와 명령 팔레트에서도 바꿀 수 있습니다. 기본은 시스템 언어이며 미지원 언어는 영어입니다. 선택은 config.json의 `ui.lang`에 저장하고 트레이 메뉴, 서버 오류·상태, WeChat/Feishu의 `/help`·승인 안내 등 시스템 메시지에 적용됩니다. 명령줄·Docker의 시스템 언어는 `AMB_LANG`, `LC_ALL`/`LC_MESSAGES`/`LANG` 순이며 없으면 중국어 간체입니다. 로그, 모델 프롬프트, 사용자가 정한 봇 이름은 번역하지 않습니다.
  - 화면 문구는 `ui/locales/<lang>/<namespace>.js`에 있고 `t("namespace.key", { params })`로 사용합니다(`ui/lib/i18n.js`). 서버 문구는 `src/i18n/messages/<namespace>.ts`이며 키를 타입 검사합니다. 모든 화면 요청은 `x-amb-lang`을 보내며 서버도 해당 언어로 응답합니다.
  - 새 문구는 두 기준 언어에 모두 추가합니다. `node scripts/i18n-check.mjs [files…]`는 화면 코드의 중국어 잔여 문구, 없는 키, zh/en 불일치를 검사합니다(`npm test`의 `test/i18n.unit.test.ts`도 동일 검사). 글꼴 이름·중국어 입력 정규식처럼 필요한 중국어는 해당 줄에 `// i18n-ignore`를 붙입니다.
- 시작 체크리스트: 빈 대화에는 인사, 모델 변경, WeChat 연결, 작업 맡기기, 기억하기, 이미지 생성의 여섯 단계가 나옵니다. 마지막 단계는 계정의 미디어 모델 여부와 무관하게 내장 데모만 재생합니다. 실제 기본 흐름처럼 즉시 생성해 대화에 보이지만 봇에 전송하지 않고 모델 호출·과금도 없습니다. 이미지는 `ui/assets/guide-demo.svg`입니다. 비용 없이 흐름을 배우도록 한 것이며 실제 이미지 요청·수신으로도 완료됩니다. 보내기를 누르면 직접 시도하고 이동하기 또는 왼쪽 아래 항목을 누르면 해당 제어 요소를 테두리로 강조하는 안내 카드가 나옵니다. 응답, 모델 변경, 파일·이미지 수신, 채널 연결, 기억 저장에 따라 자동 완료되며 config.json의 `ui.guide`(API `/amb/api/guide`)에 저장합니다. 기존 사용자가 이미 한 단계도 인정합니다. 왼쪽 아래로 접거나 완전히 숨길 수 있고 설정 → 일반 → 시작 체크리스트에서 다시 시작합니다. 인사는 실제 응답이 있어야 하고(오류 안내는 제외), 채널은 실제로 연결되어야 합니다(설정만으로는 완료되지 않음). ‘자주 쓰는 채팅 앱 연결’에서는 WeChat, Feishu, Telegram, Slack, Discord를 고를 수 있고 UI 언어는 추천 항목만 정합니다. ‘기억해…’라고 분명히 말하면 턴 후 기억 정리를 90초 기다리지 않고 바로 합니다. 진행 상황은 사용자별로 저장되며(Modelflare 로그인 시 계정별로 KV `guide.owner.*`, 로그인하지 않았으면 기존대로 config.json의 `ui.guide`), 모두 마치면 이후 자동으로 숨겨집니다. 스스로 나타나는 안내 카드는 입력창에 초안이 있거나 작업이 실행 중이면 기다립니다.
- 시각 디자인: 무채색과 구성 요소는 magpie(MIT)를 바탕으로 수정했고 강조색은 Modelflare의 형광 연두색 `#d7ff00`입니다. `ui/design/README.md`에 디자인 시스템을 설명합니다.

### 현지화와 릴리스 검사

관리자가 각 번역을 직접 작성하고 현지화합니다. 번역 API로 문구를 생성하지 마세요. 제품명, 모델 ID, 명령, URL, `{placeholder}` 매개변수를 유지하세요.

- 앱 문구: `ui/locales/<language>/<module>.js`. 새 서버 언어: `src/i18n/locales/<language>/<module>.ts`.
- 웹사이트 문구: `site/src/i18n/locales/<language>/`. 예를 들어 `home/hero.ts`는 `home.hero.*`에 대응하며 페이지는 사전에서 읽습니다.
- `ui/locales/manifest.json`은 대상 언어와 `ready` 상태를 나열합니다. 웹사이트의 `site/src/i18n/manifest.json`과 같아야 하며 검사기로 확인합니다. 미완료 언어는 `ready: false`로 유지하고 공개 메뉴와 검색 엔진 언어 표시에 포함하지 않습니다.
- `npm run i18n:status`는 언어·영역별 진행률을 보고합니다. `npm run i18n:check`는 모든 대상 언어와 보조 문서를 검사합니다. 누락·빈 값·추가 키, 훼손된 매개변수, 복수형 누락은 릴리스를 차단합니다. 개발 중 영어 대체는 번역 완료로 인정하지 않습니다.
- 러시아어 복수형은 `one / few / many / other`, 스페인어·포르투갈어는 `one / many / other`(`many`는 백만 단위 수에만 쓰며 `other`와 같게 작성), 일본어·한국어는 `other`를 사용합니다. 통화, 시간대, 금액을 바꾸지 않고 표시만 현지화합니다.
- 웹사이트의 `npm run build`는 모든 언어, 동기화 문서, 공유 이미지를 검사합니다. `build:draft`는 로컬 미리 보기용이며 릴리스 검사를 대신하지 않습니다.

## 역할과 프롬프트

모델이 읽는 모든 프롬프트는 `src/agent/prompts/`에 있습니다. `test/prompts.unit.test.ts`는 각 부분의 필수·금지 문구와 문자 수 한도를 검사하고, `test/agent.integration.test.ts`는 실제 DSH 자식 프로세스로 모델이 받는 시스템 프롬프트와 전체 프롬프트·도구 정의 예산을 검사합니다.

- **기본 역할:** DSH 자체 역할은 코딩 에이전트이며 “You are an AI agent powered by DeepSeek Harness.”로 시작합니다. 패치(`host.ts`의 writePatch)가 `personaPrefix`를 대화·코딩·명령·파일·컴퓨터 사용 시 데스크톱 앱 조작을 하는 개인 도우미로 바꾸고 웹페이지·파일·전달 메시지의 글은 명령이 아닌 데이터로 취급하도록 합니다. 해당 한 문장만 제어하는 `includeHarnessIdentity`도 끕니다.
- **봇 섹션:** 대화 규칙, 기억 사용법(켜진 경우), 봇 이름, 사용자 역할 설명이 시스템 프롬프트 마지막 `amb:bot` 섹션입니다. 호스트가 매 차례 데이터 폴더의 `dsh/.prompts/<bot>.md`에 기록하며 에이전트 파일 도구로 읽거나 바꿀 수 없고 동일 내용은 다시 쓰지 않습니다. `dsh-runtime/plugins/amb-prompt.mjs`가 매 모델 요청에 읽으므로 이름·역할 변경이 다음 메시지부터 적용됩니다. `/new`나 프로세스 재시작이 필요 없습니다. DSH 0.2.1-rc.4의 섹션 `text`는 동기식으로 Promise를 기다리지 않아 브리지 대신 파일을 읽습니다. 역할과 대화 규칙이 충돌하면 역할이 우선하며 사용자와 대화하지 않는 하위 에이전트에는 이 섹션을 전달하지 않습니다.
- **대화 규칙:** 중국어이며 dsh-superagent의 주의 원칙을 참고했습니다. 답부터 제시하고 오래 걸리면 할 일을 한 줄로 알린 뒤 단계별 중계는 활동 패널에 맡깁니다. 완료 시 결과와 위치를 말하고 미완료·실패는 그대로 알립니다. 언어·형식·범위·문체는 스스로 정해 설명하며, 잘못된 추측이 피해·비용·대부분의 작업 낭비를 일으킬 때, 사용자만 제공할 수 있는 로그인·파일·비밀번호가 필요할 때, 결제·데이터 삭제·타인에게 메시지 보내기처럼 되돌릴 수 없을 때만 질문합니다. 한 번에 구체적인 질문 하나를 하며 선택지는 `ask_user_question`을 사용합니다. 군더더기 없이 WeChat·Feishu 응답은 짧게 합니다. 백그라운드 작업도 같은 원칙으로 선택한 내용을 결과에 밝힙니다.
- **구간 첫 메시지:** 채널(WeChat은 일반 텍스트, Feishu·웹은 Markdown), 당시 장기 기억 스냅샷, 이전 구간 인계 메모, 사용자 메시지 순입니다. 그룹 기억·채널 등 대화별 정보가 다르고 기억마다 바뀌어 시스템 프롬프트에 넣으면 공유 접두사 캐시가 깨지므로 여기 둡니다. 구간 내에서는 고정하고 이후 기억 변경은 `recall`로 읽습니다.
- 접두사 캐시: 섹션이 같으면 시스템 프롬프트는 바이트 단위로 동일하고 역할 수정은 마지막 섹션만 바꿉니다. 업그레이드 전 시작한 대화의 첫 메시지에는 다음 구간(`/new` 또는 관리자 전환)까지 이전 역할이 남습니다.

## 파일 권한

에이전트 모드에서 입력창 왼쪽 아래 권한 버튼 또는 봇 설정 → 권한으로 프리셋을 바꿉니다. `/status`에서도 확인합니다.

- **작업 공간 쓰기**(기본): 샌드박스에서 명령을 실행하고 해당 봇의 작업 공간만 변경합니다. 외부 작업은 대화에서 먼저 확인합니다.
- **읽기 전용:** 파일을 바꾸지 않으며 명령도 읽기 전용 샌드박스에서 실행합니다.
- **전체 접근:** 위험을 이해하고 잦은 승인이 불편한 사용자를 위한 설정입니다. **샌드박스 없이** 내 사용자 권한으로 실행하고 외부 작업도 묻지 않습니다. DB·채널 토큰·키 등 AnyModelBot 데이터 폴더를 포함한 모든 파일을 읽고 바꿀 수 있습니다. **재귀 삭제**만 기존 승인 흐름(WeChat 번호 응답, Feishu·웹 카드)으로 확인합니다. 대상은 `rm -r`/`-rf`/`--recursive`(`sudo`, `xargs`, `sh -c` 내부 포함), `find -delete`, `git clean`, `rsync --delete`, PowerShell `Remove-Item`/`rm`/`del`/`rd`/`rmdir`의 `-Recurse` 및 축약, cmd `rd /s`, `del /s`, `robocopy /MIR`, Python `shutil.rmtree`, Node `fs.rm(…, { recursive })` 등이며 명령이 참조하는 스크립트 파일도 검사합니다. 선택 전 확인하며 버튼·설정에 빨간색으로 표시합니다.
  - 이는 실수 삭제 방지 장치이며 보안 경계가 아닙니다. 명령 텍스트를 검사하므로 실행 중 조합한 명령(`eval "$(…)"`, `curl … | sh`)이나 `make clean`, `npm run clean` 같은 빌드 스크립트의 내부 동작은 알 수 없습니다. 불확실하면 확인합니다. 현재 모델과 작업을 신뢰할 때만 켜세요.

## 봇을 사용할 수 있는 사람

에이전트는 내 컴퓨터에서, 때로는 전체 접근으로 실행되므로 기본적으로 **소유자와 허용한 사람만** 대화할 수 있습니다. 채널 계정별로 관리하며 해당 계정에서 허용되면 모든 봇과 대화할 수 있습니다(`src/core/access.ts`).

- **소유자:** WeChat은 QR 코드를 스캔한 계정입니다. Feishu는 QR로 앱을 만들든 App ID·Secret을 넣든 자체 사용자 로그인이 없으므로 **연결 후 처음으로 개인 메시지를 보내는 사람**이 소유자가 됩니다(첫 사용 신뢰). 연결 후 본인 계정으로 한 줄 보내면 평소처럼 답합니다. 스캐너 ID를 제공하지 않은 WeChat 로그인도 동일합니다. 봇 설정 → 사용 가능한 사람에서 Feishu 소유자를 확인하고 변경을 누른 뒤 확인하면 초기화되어 다음 발신자가 소유자가 됩니다. 다른 Feishu 앱으로 바꾸거나 연결을 해제해도 초기화합니다. 거부된 사용자는 소유자가 될 수 없으며 로컬 웹 대화는 제한하지 않습니다.
- **그 외 사용자:** ‘아직 이 봇의 사용 허가를 받지 않았습니다. 소유자에게 알렸습니다’라는 한 줄만 사람당 최대 시간당 한 번 보냅니다. 대기열·모델 호출·비용은 없습니다. 설정 › 채팅 채널의 해당 계정 관리에 허용·거부 요청이 표시되고 4자리 페어링 코드로 소유자에게 전달합니다(계정당 시간당 최대 3건, 소유자가 최근 24시간 내 해당 채널에서 발언한 경우만). 소유자는 `同意 1234`/`拒绝 1234` 또는 `yes 1234`/`no 1234`로 답합니다. 페어링 코드는 도구 승인 코드와 충돌하지 않습니다. 거부된 사용자에게는 답하지 않습니다.
- 허용 목록은 설정 › 채팅 채널의 해당 계정 관리에 있으며 항목을 삭제할 수 있습니다. 삭제된 사용자는 메시지를 보내 다시 요청할 수 있습니다. `/status`에도 표시합니다.
- 업그레이드 시 기존 개인 대화 상대는 ‘업그레이드 전 사용’ 표시로 허용 목록에 넣어 접근이 끊기지 않게 합니다. 다른 WeChat 계정으로 다시 스캔해도 이전 소유자는 허용 목록에 남습니다.
- 그룹 대화: 현재 어떤 채널도 그룹을 전달하지 않습니다(Feishu는 개인 메시지만, WeChat iLink는 그룹 미지원). 기존 그룹 메시지 처리를 유지하며 채널이 그룹을 지원할 때 `access.ts`에 규칙을 추가합니다.

## 답변 전달의 지속성

최종 답변, 파일, 승인 요청, 안내는 전송 전에 로컬 DB 보낼 편지함에 기록합니다(`src/core/outbox.ts`). 실시간 카드 갱신과 입력 중 표시는 제외합니다.

- 한 대화의 메시지는 순서대로 하나씩 보냅니다. 네트워크·플랫폼 오류는 5초부터 최대 5분까지 간격을 늘려 재시도하고 채널이 오프라인이면 기다립니다.
- 앱 종료·충돌 후 다음 실행에서 이어 보냅니다. 이미 보낸 메시지는 반복하지 않으며 긴 응답은 첫 미전송 부분부터 재개합니다. 수신 메시지에서 ID를 도출하므로 플랫폼이 중복 전달해도 최종 응답은 한 번입니다. 충돌 순간 전송 중이던 부분만 중복될 수 있고 고정 Feishu `uuid`(1시간 중복 제거)와 WeChat `client_id`를 사용합니다.
- WeChat은 마지막 수신 후 24시간 이내, 메시지당 최대 10회만 답할 수 있습니다. 제한 때문에 못 보낸 내용은 버리지 않고 보류합니다. 다음 메시지가 오면 답변 전에 원래 순서대로 한 번씩 보내며 한 메시지 크기에 들어가는 텍스트는 ‘자리를 비운 동안: …’으로 합치고 파일은 그대로 보냅니다. 최대 7일 보관하며 수신 안내·승인 요청처럼 짧은 수명의 항목은 자체 만료 시간을 유지합니다.
- 반복 거부·대기 시간 초과 등으로 더 이상 전송할 수 없으면 사유를 로그와 진단 정보에 남깁니다.

## 백그라운드 작업과 규칙

오래 걸리는 작업은 백그라운드에서 실행해 대화를 막지 않습니다(설계 `docs/design/background-tasks-and-proactive.md`, 코드 `src/tasks/`).

- **백그라운드 작업:** 대화 에이전트가 `task_start`로 전용 DSH 세션 `task-<id>`와 작업 공간 폴더 `tasks/<name>-<id6>/`를 만들고 할 일을 한 줄로 알립니다. 결과는 요청한 대화로 돌아오며 WeChat 인용·Feishu 답장으로 이어갑니다. 사용자 확인은 대화당 한 번에 한 질문입니다. 앱 재시작 후 계속하되 외부 동작을 반복하기 전에 확인합니다. `/tasks`로 작업·규칙을 나열하고 `/stop <number>`로 멈춥니다.
- **규칙:** `rule_create` 또는 봇 설정 › 먼저 보내는 메시지 › 규칙에서 만듭니다. 사용자 문구가 권한 부여이므로 즉시 실행 모드가 되어 매번 확인하고 중요한 내용만 보냅니다. 문구 수정 후에도 실행 모드입니다. ‘우선 관찰해 줘’ 또는 편집기의 관찰을 선택하면 읽기 전용으로 보내지 않고 ‘전송 예정’을 기록합니다. 3회 관찰 후 ‘내 확인 필요’에서 실행 전환 여부를 묻습니다. 매 실행은 새 세션이며 기록은 Markdown으로 내보냅니다.
- **보이되 시끄럽지 않게:** 정보 패널의 작업 그룹에 작업·규칙을 표시하고 끝난 작업은 종료 항목으로 접습니다. 출처, 최근 진행, 예산, 폴더, 실행 단계를 볼 수 있습니다. 기다리는 항목은 사이드바 ‘내 확인 필요’에 모읍니다. 결과·결정 요청·실패만 푸시합니다. 방해 금지(기본 22:00~08:00), 일일 한도(WeChat 3개, Feishu 5개), 묶음 알림은 봇 설정 › 먼저 보내는 메시지에 있습니다.
- **예산:** 기본 작업당 $1, 규칙 실행당 $0.10, 규칙별 월 $3이며 Modelflare 참고 가격으로 추정합니다. 한도에 도달하면 멈추고 묻습니다. 작업 상세·규칙 편집기에서 바꿉니다. 봇 예산 키의 잔액이 20% 아래면 백그라운드를 중지해 대화용으로 남깁니다.
- **일시 중지:** 봇 설정 › 먼저 보내는 메시지 › 백그라운드 작업 일시 중지 또는 봇에게 요청하면 작업·규칙·푸시를 보류하고 대화는 계속합니다.
- **보존:** 작업·기록은 30일 보관하며 30일 미사용 작업은 보관 처리합니다. 30일 미사용 폴더는 DSH 세션 파일(`dsh/<bot>/sessions/`)과 함께 삭제합니다. SDK에 삭제 기능이 없어 앱이 직접 지우며 프로세스에 열린 세션은 교체 후 삭제합니다. 별도 질문·알림은 없습니다. 27일째 삭제 예정일을 설정해 작업 상세에 표시하며 보관을 누르면 유지합니다. 예정일 설정 후 최소 3일 전에 삭제하지 않습니다. 상세에서 폴더 크기를 보고 폴더와 함께 작업을 삭제할 수도 있습니다.

## 컴퓨터 사용

봇 설정(정보 패널 ⚙) → 컴퓨터 사용에서 켜기·끄기, 백엔드, 승인 모드를 정합니다. `/status`와 설정에서 현재 백엔드·가용성·사용 불가 이유를 봅니다.

- **백엔드**
  - **Cua Driver(기본, 세 데스크톱 플랫폼):** 공식 사전 빌드 [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) 0.37.0(MIT)을 설치 파일에 포함합니다. 빌드 시 `scripts/fetch-cua-driver.mjs`로 플랫폼·아키텍처별 다운로드 후 SHA256을 검증합니다. 내장 MCP 서버 `cua-driver mcp`로 실행하며 항상 `CUA_DRIVER_PERMISSION_MODE=bounded`와 기능 매니페스트를 적용하고 `--dangerously-bypass-approvals`는 **사용하지 않습니다**. 자식 환경에서 비밀 정보를 제거하고 텔레메트리와 `run_script`를 끕니다. 창·스크린샷 읽기, 앱 실행, 클릭, 입력, 키·단축키, 스크롤, 끌기, 값 설정, 메뉴 등의 필요한 24개 도구만 노출합니다. 스크립트·프로세스 종료·클립보드·브라우저 삽입·녹화·업데이트 등은 모델에 보이지 않고 거부합니다. 매니페스트는 설치된 GUI 앱(Linux .desktop, macOS /Applications, Windows 시작 메뉴)을 나열하고 전체 화면 입력을 허용합니다. 최대 24시간 유효하며 만료 전에 드라이버를 재시작합니다.
  - **Codex Computer Use 브리지(선택, macOS 전용):** kimi-computer-use입니다. OpenAI Codex Computer Use의 로컬 설치가 필요하며 사용할 수 없으면 Cua Driver로 전환합니다.
- **승인:** 읽기·스크린샷·클릭·입력·키·스크롤·끌기·값 설정은 기본적으로 **승인 없이 자동 실행**합니다. 선택적으로 화면 변경 전에 확인할 수 있으며 읽기는 자동입니다. 업그레이드 시 기본 봇을 포함한 기존 봇은 자동 모드로 이전합니다. 읽기 전용 봇은 읽기 도구만 받습니다.
- **플랫폼별 사항**
  - macOS: 시스템 설정 → 개인정보 보호 및 보안에서 손쉬운 사용·화면 기록을 허용합니다. `--direct` 모드로 실행하며 실제 기기 검증은 아직 완료하지 않았습니다. 권한이 없으면 컴퓨터 제어 도구 호출을 막고 이번 턴을 ‘권한이 없어 계속할 수 없었습니다’로 끝내며, 대화에 부족한 권한만 담은 카드를 보여 줍니다(시스템 기본 요청, 해당 시스템 설정 열기, 다시 확인. 화면 기록은 보통 앱을 다시 열어야 하며 카드에서 바로 다시 열 수 있고 보내지 않은 초안도 돌아옵니다). 처음 실행할 때는 아무 권한도 요청하지 않습니다.
  - Linux: X11은 AT-SPI로 화면을 읽습니다(at-spi2-core 및 앱의 접근성 활성화 필요). Wayland는 기능이 제한되어 XWayland 앱의 전경 창만 조작하며 화면에 이를 알립니다. 그래픽 세션(DISPLAY / WAYLAND_DISPLAY)이 없으면 사용할 수 없습니다.
  - Windows: 로그인한 사용자의 대화형 데스크톱 세션이 필요합니다. 서비스·예약 작업의 비대화형 세션은 지원하지 않습니다.
- 스크린샷은 비전 지원 모델에만 보내며 WeChat/Feishu에 전달하지 않습니다. 사용자가 요청할 때만 파일로 보냅니다.
- cua-perception, OmniParser(AGPL), Cua Spaces(FSL) 구성 요소는 포함하지 않습니다.

## Feishu 앱 설정

가장 간단한 방법은 설정 › 채팅 채널 → Feishu → 계정 추가에서 QR 코드를 스캔해 봇 앱을 만들고 Feishu에서 메시지를 보내는 것입니다.

기존 기업용 사용자 지정 앱을 쓰려면 ‘내 앱 사용’을 선택하고 다음처럼 설정하세요.

1. [Feishu Open Platform](https://open.feishu.cn/app)에서 기업용 사용자 지정 앱을 만들고 봇 기능을 추가합니다.
2. 다음 권한을 켭니다.
   - `im:message.p2p_msg:readonly`: 사용자가 봇에게 보낸 개인 메시지 읽기.
   - `im:message:send_as_bot`: 앱으로 메시지 전송.
   - `cardkit:card:write`: 실시간 응답 카드 생성·갱신.
   - `im:message.history:readonly`: 대화 기록 읽기. 지속 연결은 오프라인 중 메시지를 다시 밀어 주지 않아 시작·재연결 시 최근 7일 활성 대화에서 최근 24시간 메시지를 대화당 최대 20개 가져옵니다. 없어도 다른 기능은 되지만 누락 메시지를 보충하지 못하며 이를 한 번 알립니다.
3. 앱의 설정 › 채팅 채널 → Feishu → 계정 추가 → 내 앱 사용에 App ID / App Secret을 넣고 저장합니다. 다음 단계를 저장하려면 지속 연결이 먼저 온라인이어야 합니다.
4. Events & callbacks의 구독 모드에서 **Receive events through persistent connection**을 선택하고 `im.message.receive_v1` 이벤트를 추가합니다.
5. 버전을 게시하고 본인을 이용 가능 범위에 넣은 뒤 본인 Feishu에서 한 줄 보냅니다. 연결 후 첫 발신자가 Feishu 소유자가 됩니다([봇을 사용할 수 있는 사람](#봇을-사용할-수-있는-사람) 참조).

현재 개인(p2p) 대화만 처리하며 그룹 메시지는 무시합니다.

## WeChat(iLink)

- 설정 › 채팅 채널 → WeChat → 계정 추가 → QR 코드로 로그인을 선택한 뒤 WeChat으로 스캔하고 확인합니다. 또는 `npm run weixin:login`을 실행하면 터미널에 QR 코드를 표시하고 데이터 폴더에 PNG로 저장합니다.
- 로그인 상태, 동기화 커서, context_token은 데이터 폴더에 저장하며 재시작 후 복원합니다.
- 플랫폼 제한: 수신 메시지마다 24시간 내 최대 10회 응답합니다. 생성이 끝나면 한 번에 보내되 4,000자를 넘으면 나눕니다. 생성 중에는 입력 중 표시가 나옵니다.
- 이미지·파일·동영상: 사용자가 보내거나 인용한 자료를 WeChat CDN에서 다운로드하고 복호화합니다(파일당 최대 50MB). 에이전트 모드에서는 작업 공간 `inbox/`에 저장하고 메시지에 경로를 적어 읽기·처리·생성 참고 이미지로 사용합니다. Claude, GPT-5/6, Gemini, Grok 4, Kimi K3, Muse Spark 등 비전 모델에는 이미지 자체도 전달하고 그 외에는 경로만 전달합니다. Linux는 Electron에서 sharp가 충돌해 아직 이미지를 직접 전달하지 않고 경로만 보냅니다. 봇이 전달하는 파일(present)은 이미지나 파일 형태로 WeChat에 보냅니다.
- 세션 만료(오류 -14) 시 채널을 일시 중지하고 화면에 알립니다. 다시 스캔하면 재개합니다.

## 개발 및 테스트

```bash
npm run typecheck
npm test            # 단위+오프라인 종단 간(Feishu/iLink/Modelflare 모의, 스트리밍·중지 포함)+게이트웨이 통합(컴파일된 magpie 필요)
npm run docs:check  # README 검사: 자료 존재·크기, zh/en 구조, 상대 링크·앵커, 금지 문구, 대체 텍스트
```

README 자료 목록과 녹화 규격은 [docs/assets/README.md](./assets/README.md)를 확인하세요.

## 라이선스

MIT이며 `LICENSE`를 참고하세요. magpie(MIT, 수정한 화면 스타일 포함), Tencent openclaw-weixin(MIT) 등 제3자 구성 요소는 `THIRD_PARTY_NOTICES.md` 및 설정 → 앱 정보에 나열합니다.

## 사용자 스킬과 대화 기록 검색

사용법과 ZIP 형식은 [스킬 안내](./skills_ko.md)를 참고하세요. `src/skills/archive.ts`는 경로, 압축 해제 제한, `SKILL.md`를 검증하고 `service.ts`는 봇별 패키지, 활성화 상태, 버전 식별값을 저장합니다. `src/web/skills.ts`는 미리보기와 관리 API를 제공합니다. DSH가 대기 상태일 때 활성화된 스킬을 배치하므로 진행 중인 대화, 하위 에이전트, 백그라운드 명령을 중단하지 않습니다. 카탈로그 Bot 업데이트 시 `src/botkit/installer.ts`가 이름 충돌을 확인합니다.

`src/store/chat-search.ts`는 SQLite 메시지 검색 색인, 필터, 페이지 나누기, 원래 메시지의 주변 문맥을 담당합니다. 전체 검색은 `ui/screens/message-search.js`, 현재 대화 검색은 `ui/components/chat-search.js`에 있습니다. 검색은 로컬 DB를 직접 읽으며 모델을 호출하지 않습니다.

관련 테스트는 `test/skills*.test.ts`와 `test/chat-search*.test.ts`입니다. 브라우저 검증용 Chromium 경로는 `AMB_TEST_CHROME`으로 지정할 수 있습니다. DSH가 있으면 스킬 발견, 로딩, 자료 읽기, 작업 중 비활성화도 검증합니다.
