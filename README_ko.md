<p align="center">
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">
    <img src="docs/assets/brand/logo-eyes.webp" width="120" height="120" alt="AnyModelBot 눈 로고: 좌우를 바라보는 세로 캡슐 모양의 두 눈">
  </a>
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/wordmark-dark.svg">
    <img src="docs/assets/brand/wordmark-light.svg" height="40" alt="AnyModelBot">
  </picture>
</h1>

<p align="center"><b>내 컴퓨터에서 실행하는 AI 봇 팀. 어떤 모델이든, 사용한 만큼만.</b></p>

<p align="center">
  <a href="https://anymodel.bot/ko/">웹사이트</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">다운로드</a> |
  <a href="./README.md">简体中文</a> |
  <a href="./README_en.md">English</a> |
  <a href="./README_ja.md">日本語</a> |
  한국어 |
  <a href="./README_ru.md">Русский</a> |
  <a href="./README_es.md">Español</a> |
  <a href="./README_pt.md">Português (Brasil)</a> |
  <a href="https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme">Modelflare</a> |
  <a href="https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme">요금</a> |
  <a href="./docs/development_ko.md">개발</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/issues">의견 보내기</a>
</p>

<div align="center">

[![릴리스][release-shield]][releases-link]
[![다운로드][downloads-shield]][releases-link]
[![스타][stars-shield]][stars-link]
[![라이선스][license-shield]][license-link]
[![CI][ci-shield]][ci-link]

[![플랫폼][platform-shield]][releases-link]
[![요금][pricing-shield]][pricing-link]
[![Modelflare][modelflare-shield]][modelflare-link]
[![X][x-shield]][x-link]

</div>

<p align="center">
  <img src="docs/assets/hero/hero-demo.gif" alt="AnyModelBot 사용 예: Modelflare 로그인, 모델 선택, 폴더 정리 요청, 파일 이동 승인" width="100%">
</p>

# 🤖 AnyModelBot

AnyModelBot은 Windows, macOS, Linux의 내 컴퓨터에서 실행하는 AI 봇 팀입니다. 봇마다 역할, 기본 모델, 작업 공간, 기억을 따로 갖습니다. 앱에서 대화하거나 WeChat, Feishu, Telegram, Slack, Discord에 연결할 수 있습니다. 파일을 읽고 쓰고 명령을 실행하며, 권한을 주면 데스크톱도 조작합니다. 작업 공간 밖에 쓸 때는 먼저 물어봅니다.

대화, 기억, 파일, API 키는 내 기기에 남습니다. 모델은 [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)(로그인 후 사용한 만큼 결제)를 통해 쓰거나, 내 공식 API 키로 제공업체에 직접 연결해 쓸 수 있습니다. AnyModelBot 자체에는 구독료가 없습니다.

설치하면 바로 쓸 수 있습니다. 백그라운드 작업, 예약 규칙, 내 확인을 기다리는 항목이 기본으로 들어 있습니다.

**0.1.33:** 예약 페이지, 규칙 취소와 복원, 최대 12시간 내 실행 보충, 봇 템플릿 10종, 오른쪽 패널의 파일 및 웹 미리보기를 추가했습니다. 공식 봇 작업 공간과 macOS 권한 안내도 개선했습니다. [변경 기록](./CHANGELOG_ko.md#0133---2026-11-14)

📥 [다운로드](#-다운로드-및-실행) · 🌠 [스크린샷](#-스크린샷) · 🌟 [기능](#-주요-기능) · 🆚 [비교](#-anymodelbot과-grok-bot-openai-dots-claude-duet-비교) · 🔐 [개인정보](#-작동-방식과-개인정보)

⭐ AnyModelBot이 마음에 들면 저장소에 스타를 눌러 새 릴리스를 확인하세요.

---

<a href="https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme">
  <img src="docs/assets/modelflare/modelflare-banner-en.webp" width="100%" alt="Modelflare 배너: Modelflare 가입하기">
</a>

가장 간편한 방법은 **[Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)**입니다. 로그인하면 바로 모델을 쓸 수 있고 제공업체마다 키를 따로 발급받을 필요가 없습니다(제공업체에 직접 연결하려면 [원하는 모델](#-modelflare-또는-공식-api로-원하는-모델을-사용합니다) 참고). 사용할 수 있는 모델, 가격, 진행 중인 혜택은 [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)와 [가격표](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme)에서 확인하세요.

**Bot 크레딧**: 신규 가입 시 Bot 크레딧을 드리고, Modelflare 구독 시 플랜 크레딧의 10%를 Bot 크레딧으로 추가로 드립니다. 자세한 조건은 Modelflare 사이트를 따릅니다. Bot 크레딧은 AnyModelBot에서만 사용할 수 있고 앱의 요청에 먼저 사용되며, 남은 양은 왼쪽 아래에서 확인합니다.

**[Modelflare 가입 →](https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme)** ·
[가격표](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[API 문서](https://docs.modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[신뢰 센터](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[X](https://x.com/modelflare_dev)

**AnyModelBot에서 Modelflare를 사용하는 방식**

- **한 번 로그인하면 됩니다.** 처음 실행하면 브라우저에서 Modelflare 로그인 또는 회원가입을 진행합니다. 앱이 기기를 자동으로 연결하므로 키를 복사할 필요가 없고, 승인이 끝나면 앱으로 자동으로 돌아옵니다. 기본 모델이 아직 없으면 도구를 지원하는 저비용 모델을 먼저 골라 둡니다. Docker나 서버에서는 어느 기기의 브라우저에서든 로그인한 뒤, 로그인 후의 링크를 앱에 붙여 넣으면 됩니다.
- **모든 모델을 한곳에서 고릅니다.** Modelflare 모델 목록이 자동으로 표시되며 각 모델의 컨텍스트 길이, 기능, 참고 가격을 함께 볼 수 있습니다.
- **사용한 만큼 결제합니다.** 잔액과 충전 링크가 왼쪽 아래에 항상 표시되고(Bot 크레딧이 있으면 남은 비율도 표시), 잔액 부족 알림과 일별 사용량도 앱에서 확인합니다. 모델을 고르기 전에 공개 가격표를 공식 가격과 비교해 보세요.
- **데이터 경계를 분명히 합니다.** 모델 요청은 Modelflare를 거쳐 선택한 제공업체로 전달되며 Modelflare는 요청 로그를 보관합니다. 보관 항목과 기간은 [신뢰 센터](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)를 확인하세요. 나머지 데이터는 내 기기에 남습니다([자세히](#-작동-방식과-개인정보)).

---

# 📥 다운로드 및 실행

플랫폼을 선택하세요. 각 릴리스 페이지에서 모든 설치 파일과 `SHA256SUMS` 파일을 제공합니다.

| 플랫폼 | 아키텍처 | 설치 파일 | |
| :--- | :--- | :--- | :--- |
| ![Windows][win-badge] | x64 | `anymodel-bot-<version>-win-x64.exe` | [다운로드][releases-link] |
| ![Windows][win-badge] | arm64 | `anymodel-bot-<version>-win-arm64.exe` | [다운로드][releases-link] |
| ![macOS][mac-badge] | Apple silicon | `anymodel-bot-<version>-mac-arm64.dmg` | [다운로드][releases-link] |
| ![macOS][mac-badge] | Intel | `anymodel-bot-<version>-mac-x64.dmg` | [다운로드][releases-link] |
| ![Linux][linux-badge] | x64 | `anymodel-bot-<version>-linux-x86_64.AppImage` | [다운로드][releases-link] |
| ![Linux][linux-badge] | arm64 | `anymodel-bot-<version>-linux-arm64.AppImage` | [다운로드][releases-link] |

<p align="center">
  <img src="docs/assets/download/install-windows.gif" alt="Windows에서 AnyModelBot 설치: 설치 파일 실행, 앱 열기, Modelflare 로그인 화면 진입" width="100%">
</p>

**첫 실행.** Windows에서 보안 경고가 나타나면 *추가 정보 → 실행*을 선택하세요. macOS 앱은 Developer ID 서명과 Apple 공증을 완료했습니다. 응용 프로그램 폴더로 옮겨 실행하고 다운로드 확인이 나타나면 ‘열기’를 선택하세요. Linux에서는 AppImage에 실행 권한을 부여하고(`chmod +x`) 실행합니다. 창을 닫으면 AnyModelBot이 트레이로 숨겨집니다. 종료하려면 트레이 메뉴나 설정을 사용하세요.

**다운로드 검증.**

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

macOS에서는 `shasum -a 256 <file>`, Windows PowerShell에서는 `Get-FileHash <file>`을 사용하세요. 결과를 `SHA256SUMS`의 해당 줄과 비교합니다.

**NAS나 서버에서 Docker로 실행**(x64와 arm64 모두 지원하는 이미지)

```bash
docker run -d --name amb -p 3600:3600 -v amb-data:/data ghcr.io/modelflare-ai/anymodel-bot
docker exec amb cat /data/ui-token   # 이후 http://<host>:3600/?token=<token> 열기
```

3600 포트를 인터넷에 직접 노출하지 마세요.

**소스에서 실행**

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup      # 내장 게이트웨이를 가져와 빌드
npm start          # http://127.0.0.1:3600/에서 로컬 콘솔 실행
```

소스 빌드에는 Node.js 22.13 이상과 Go 1.26.8 이상이 필요합니다. Docker 이미지를 직접 빌드하려면 [개발 안내](./docs/development_ko.md)를 확인하세요.

# 🌠 스크린샷

아래 스크린샷은 중국어 간체 화면입니다. 앱은 영어, 일본어, 한국어, 러시아어, 스페인어, 포르투갈어(브라질)도 지원하며 설정에서 변경할 수 있습니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/chat-dark.webp">
  <img src="docs/assets/screenshots/chat-light.webp" alt="대화 화면: Markdown 목록과 코드 블록이 포함된 답변, 입력창의 모델 버튼, 왼쪽의 봇 목록" width="100%">
</picture>

<p align="center"><i>봇과 대화하세요. 답변은 Markdown과 코드를 표시하고 입력창에서 현재 모델을 확인할 수 있습니다.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/agent-dark.webp">
  <img src="docs/assets/screenshots/agent-light.webp" alt="봇 화면: 파일 작업의 단계별 내역과 작업 공간 외부 쓰기를 요청하는 승인 카드" width="100%">
</picture>

<p align="center"><i>봇의 작업이 단계별로 보입니다. 작업 공간 밖의 작업은 승인을 기다립니다.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/models-dark.webp">
  <img src="docs/assets/screenshots/models-light.webp" alt="모델 선택기: 컨텍스트 길이, 기능 태그, 참고 가격을 보여 주는 검색 가능한 Modelflare 모델 목록" width="100%">
</picture>

<p align="center"><i>대화마다 원하는 Modelflare 모델을 선택하세요. 컨텍스트 길이, 기능, 참고 가격을 함께 확인합니다.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/memory-dark.webp">
  <img src="docs/assets/screenshots/memory-light.webp" alt="봇의 기억 항목, 연결된 채널, 최근 세션을 보여 주는 정보 패널" width="100%">
</picture>

<p align="center"><i>봇의 기억, 채널, 세션을 하나의 패널에서 확인하세요.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/modelflare-dark.webp">
  <img src="docs/assets/screenshots/modelflare-light.webp" alt="설정의 Modelflare 탭과 사용량 대화상자: 최근 7일 일별 사용량, 기본 모델 항목, 계정 버튼의 잔액" width="100%">
</picture>

<p align="center"><i>앱 안에서 Modelflare 계정의 잔액, 사용량, 기본 설정을 관리하세요.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/bots-dark.webp">
  <img src="docs/assets/screenshots/bots-light.webp" alt="서로 다른 색의 AnyModelBot 캐릭터 여섯 개" width="100%">
</picture>

<p align="center"><i>여섯 캐릭터로 봇을 구별하세요. 눈이 마우스 포인터를 따라 움직입니다.</i></p>

# 🌟 주요 기능

## 🤖 실제 작업을 해내는 봇

봇은 대화창 그 이상입니다. 역할, 기본 모델, 전용 작업 공간, 기억을 갖습니다.

- **필요한 만큼 봇을 만드세요.** 역할, 모델, 작업 공간, 아바타를 각각 설정할 수 있습니다.
- **봇 하나하나를 내가 정합니다.** 역할은 텍스트로 작성하며 템플릿은 출발점입니다. 여섯 아바타는 외형만 바꾸고 기능에는 영향을 주지 않습니다.
- **실제 파일 작업.** 파일을 읽고 쓰며 샌드박스에서 명령을 실행하고 결과 파일을 대화로 전달합니다.
- **봇별 세 가지 권한.** *읽기 전용*, *작업 공간 쓰기*(기본값: 봇 폴더 안에서만 쓰고, 작업 공간 밖에 쓸 때는 먼저 확인), *전체 접근*(샌드박스 없음, 폴더를 통째로 삭제하기 전에는 확인)을 선택합니다.
- **스킬 가져오기.** 「봇 설정 → 스킬」에서 `SKILL.md`가 포함된 ZIP(패키지당 스킬 1개, 최대 20 MB)을 미리 확인하고 추가합니다. 보기, 활성화, 비활성화, 삭제를 지원하며 같은 이름으로 다시 가져오면 확인 후 교체합니다. 변경 사항은 진행 중인 작업이 끝난 후 적용됩니다. [스킬 사용 안내](./docs/skills_ko.md).
- **승인 카드로 확인.** 작업 공간 밖에 쓰는 작업은 멈추고 답변을 기다립니다.
- **다시 시작 후 안내.** 앱 종료나 충돌 당시 처리 중이던 메시지는 다음 실행 시 해당 대화에 표시됩니다. 직접 다시 보낼 수 있으며 앱이 임의로 재실행하지 않습니다.
- **그룹 대화.** 그룹을 만들고 봇을 여러 개 추가하세요. @로 지정한 봇이 답하고, 지정하지 않으면 마지막으로 답한 봇이 계속합니다. 봇도 다른 구성원을 @하여 작업을 넘길 수 있습니다. 각 봇의 모델, 작업 공간, 기억은 독립적이며 비용도 따로 추적합니다.
- **대화 기록 검색.** 사이드바에서 기기에 저장된 모든 메시지를 검색하고 봇, 대화, 채널, 날짜로 필터링하여 원래 메시지로 이동할 수 있습니다. `Ctrl/Cmd+Shift+F`는 전체 검색, `Ctrl/Cmd+F`는 현재 대화 검색입니다. 검색에는 모델 호출이 없습니다. 입력하기 전에는 검색 대화상자에 최근 대화를 날짜별로 보여 줍니다.
- **슬래시 명령어.** `/model`, `/reset` 등을 앱과 모든 채팅 채널에서 사용할 수 있습니다. 채팅 채널에서는 `/bot`으로 다른 봇으로 전환합니다.

<p align="center">
  <img src="docs/assets/features/agent-files.gif" alt="어지러운 폴더를 정리하는 봇: 파일 목록 확인, 계획 제안, 작업 공간 외부 파일 이동 전 승인 카드 표시" width="100%">
</p>

## 🧩 바로 쓰는 봇

페르소나를 직접 쓰지 않아도 「둘러보기」에 있는 준비된 봇을 바로 쓸 수 있습니다. 봇마다 전용 화면이 있으며, 열면 먼저 예시를 보여 주고 첫 메시지를 보낼 때 설치합니다.

공식 봇의 화면, 예시, 역할 지침과 스킬은 설치 파일에 포함되어 있어 처음 열거나 설치할 때 봇 패키지를 내려받지 않습니다. 업데이트는 앱 버전과 함께 배포되며 기존 프로젝트 데이터는 유지됩니다. 모델 호출과 온라인 조사에는 네트워크가 필요합니다. 모든 봇은 데스크톱 작업 공간으로, 왼쪽에 작업 목록, 오른쪽에 내용이 있습니다. ‘새로 만들기’는 안내형 양식으로 시작하고, 상단 바에서 전체 대화로 전환하며, 입력창에서 모델도 고를 수 있습니다.

- **기업 리서치:** 내 컴퓨터에서 기업을 실사하고 출처가 있는 브리핑과 PDF를 만듭니다.
- **PPT 마스터:** 문서나 주제를 편집 가능한 슬라이드로 만들고, 기존 발표 자료도 수정합니다.
- **영상 스튜디오:** 숏폼과 시리즈 드라마를 대본, 스토리보드부터 음성, 편집, 완성까지 만듭니다.
- **미국 주식 리서치:** 미국 상장사의 재무제표와 SEC 공시를 조사해 수치를 추적할 수 있는 보고서를 작성합니다.

영상 스튜디오는 AnyModelBot 0.1.23 이상과 기기에 설치된 Python 3.10+, FFmpeg(ffprobe 포함)가 필요합니다. AI 이미지와 영상은 Modelflare에서 사용량에 따라 과금되며, 프로젝트와 미디어는 내 기기에 저장됩니다.

자세한 내용은 [공식 사이트의 봇 페이지](https://anymodel.bot/ko/bots)를 참고하세요.

## ⏳ 백그라운드에서 일하고 필요할 때만 알립니다

- **백그라운드 작업.** 자료 조사, 보고서, 파일 정리처럼 오래 걸리는 일이나 ‘백그라운드에서 해 줘’라는 요청을 받으면 백그라운드 작업을 시작합니다. 대화는 계속할 수 있고 결과는 요청했던 대화로 돌아옵니다.
- **추가 요청.** WeChat에서는 결과를 인용하고 Feishu에서는 결과에 답장하면 같은 작업에 요청을 이어갈 수 있습니다.
- **규칙.** ‘매일 아침 8시에 X 가격을 확인하고 200 미만이면 알려 줘’라고 말하면 일정에 따라 확인하고 중요한 변화만 알리는 규칙이 됩니다. 먼저 동작을 확인하려면 ‘우선 관찰해 줘’라고 요청하세요. 보낼 내용을 기록하지만 실제로 전송하거나 파일을 변경하지 않습니다. 확인 후 실행 모드로 전환하세요.
- **내 확인 필요.** 답변, 승인, 재시도 등 모든 봇이 기다리는 항목이 사이드바 한곳에 모입니다. 필요한 항목이 있을 때만 표시됩니다. 정보 패널의 작업 그룹에서 봇의 작업과 규칙, 각 실행 단계를 볼 수 있습니다.
- **기본은 조용하게.** 진행 상황은 보내지 않고 결과, 결정 요청, 실패만 알립니다. 방해 금지 시간은 22:00~08:00입니다. 먼저 보내는 메시지는 하루 WeChat 3개, 다른 채널 5개로 제한하며 나머지는 하나로 묶습니다.
- **예산.** 작업과 규칙마다 예산이 있습니다(작업당 1 USD, 규칙 실행당 0.10 USD 및 월 3 USD). 소진되면 멈추고 확인합니다. 작업 상세와 규칙 편집기에서 변경할 수 있습니다.
- **언제든 일시 중지.** 봇 설정 › 먼저 보내는 메시지의 스위치 하나로 백그라운드 작업을 멈춥니다. 대화는 계속됩니다.
- **자동 정리.** 작업과 실행 기록은 30일간 보관합니다. 30일간 사용하지 않은 작업 폴더는 별도 확인 없이 삭제됩니다. 작업 상세에서 날짜를 확인하고 ‘보관’으로 유지할 수 있습니다. 실행 기록은 Markdown으로 내보냅니다.

런타임은 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)를 기반으로 하며, 설계는 DeepSeek의 [super-agent 프로토타입](https://github.com/deepseek-ai/dsh-superagent-prototype)을 참고했습니다. 자세한 소개(중국어): [AnyModelBot 슈퍼 에이전트](./docs/blog/superagent.md).

## 🖥️ 컴퓨터를 조작하고 이미지와 동영상을 만듭니다

- **컴퓨터 사용**은 내장 [Cua Driver](https://github.com/trycua/cua)가 담당합니다. 기본적으로 자동 실행하며 봇을 *화면 변경 전에 확인*으로 설정하면 클릭과 키 입력마다 승인을 기다립니다. 화면 읽기는 승인이 필요하지 않습니다. macOS에서는 베타 기능이며, ‘손쉬운 사용’과 ‘화면 기록’ 권한은 처음 필요할 때만 요청하고 빠진 권한은 채팅에서 안내합니다.
- **이미지 및 동영상 생성**은 모호한 요청도 가장 합리적으로 해석해 바로 진행합니다. 예상 비용이 0.50 USD를 초과할 때만 먼저 확인하므로 모델과 프롬프트를 보고 즉석에서 모델을 바꿀 수 있습니다. 매번 확인받으려면 봇 설정에서 켜세요.

<p align="center">
  <img src="docs/assets/features/computer-use.gif" alt="봇이 메모장을 열어 짧은 메모를 입력하고 저장하며 클릭과 키 입력 전에 승인 카드를 표시" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/media-generation.gif" alt="봇이 이미지 생성 모델을 확인하고 사용자가 승인하면 완성된 이미지를 파일로 전달해 뷰어에서 표시" width="100%">
</p>

## 🌐 Modelflare 또는 공식 API로 원하는 모델을 사용합니다

- **한 번 로그인**하면 Modelflare 모델이 자동으로 표시됩니다.
- **내 공식 API 키도 쓸 수 있습니다.** OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Kimi, GLM, Qwen, MiniMax, Mistral을 지원합니다. 키는 내 기기에만 저장되고, 모델 요청은 Modelflare를 거치지 않고 제공업체로 바로 전송되며, 요금은 제공업체가 청구합니다. 이미지·동영상 생성은 현재 Modelflare로만 사용할 수 있습니다.
- **하나의 선택기.** GPT, Claude, Gemini, Grok, DeepSeek, Kimi, GLM 등을 컨텍스트 길이, 기능 태그, 참고 가격과 함께 확인합니다.
- **대화별 모델 변경 또는 봇별 기본값 설정.** 기억 정리와 컨텍스트 인계 같은 백그라운드 작업에는 별도 모델을 사용할 수 있습니다.
- **세 API 도메인.** `modelflare.dev`, `origin.modelflare.dev`, `cf.modelflare.dev` 중 선택하고 설정에서 응답 시간을 비교하세요. AnyModelBot은 자동으로 전환하지 않습니다.
- **사용한 만큼 결제.** 지갑 잔액, 잔액 부족 알림, 일별 사용량, 봇별 예산 키를 제공합니다. AnyModelBot 자체에는 구독료가 없습니다.

<p align="center">
  <img src="docs/assets/features/first-run.gif" alt="첫 실행: Modelflare 로그인 클릭, 브라우저에서 승인, 앱으로 돌아와 모델 목록 확인 및 첫 메시지 전송" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/model-switch.gif" alt="모델 선택기에서 검색하고 컨텍스트 길이와 참고 가격을 확인한 뒤 대화 모델 변경" width="100%">
</p>

## 🧠 기억을 이어 가고 어디서든 연결됩니다

- **대화가 바뀌어도 이어지는 기억.** 봇, 그룹, 팀이 각자의 기억을 Markdown으로 가지며 서로 섞이지 않습니다. 비밀번호나 키로 보이는 내용은 기억하지 않습니다.
- **긴 대화도 계속 편하게.** 컨텍스트 관리자가 한도에 도달하기 전에 압축하거나 인계 요약과 함께 새 구간을 시작합니다.
- **모든 봇이 계정 공유.** 설정 › 채팅 채널에서 WeChat, Feishu, Telegram, Slack, Discord 채팅 계정을 한 번 추가하면 모든 봇이 공유합니다. 채널마다 여러 계정과 별칭을 사용할 수 있습니다. 채팅 앱에서 `/bot name`을 한 번 보내 다른 봇으로 전환하세요.
- **앱 연결.** 아바타 메뉴의 ‘앱 연결’에는 Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva 커넥터가 들어 있고, 커스텀 MCP(원격 서비스 또는 로컬 명령)도 추가할 수 있습니다. 한 번 연결하면 기본적으로 모든 봇이 사용할 수 있으며 봇별·도구별로 좁힐 수 있습니다. 읽기는 바로 실행하고, 쓰기는 먼저 묻고, 삭제와 외부 전송은 매번 묻습니다.
- **WeChat과 Feishu.** QR 코드로 WeChat을 연결하거나 실시간 응답 카드를 지원하는 Feishu 봇을 연결하세요. WeChat에서도 이미지와 파일을 주고받을 수 있습니다.
- **Telegram, Slack, Discord.** 설정 › 채팅 채널에 토큰을 붙여 넣으세요. 공개 주소가 필요하지 않습니다. 답변은 작성되는 대로 표시되고 이미지와 파일을 양방향으로 지원합니다. 현재는 개인 메시지만 지원하며 승인과 질문에는 텍스트로 답합니다.
- **네 가지 실행 방법.** 데스크톱 앱, 명령줄, Docker, `127.0.0.1:3600`의 로컬 웹 콘솔을 사용하세요.

<p align="center">
  <img src="docs/assets/features/memory.gif" alt="봇에게 선호를 기억하도록 요청하고 정보 패널에서 새 기억을 확인한 뒤 새 대화에서 해당 기억 사용" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/channels-wechat.gif" alt="QR 코드로 WeChat을 연결하고 휴대폰에서 질문과 답변을 주고받으면 데스크톱 앱의 최근 세션에도 대화 표시" width="100%">
</p>

## 🔒 로컬 우선, 편안한 화면

- **데이터는 내 곁에.** 대화, 기억, 파일, API 키는 기기에 저장됩니다. 로컬 콘솔은 `127.0.0.1`에서만 수신 대기하고 데스크톱 앱은 실행마다 새로운 접근 토큰을 생성합니다.
- **허용한 사람에게만 응답.** 기본적으로 소유자와 허용 목록의 사용자에게만 답합니다. WeChat 소유자는 QR 코드를 스캔한 계정이고 Feishu, Telegram, Slack, Discord에서는 연결 후 처음 메시지를 보내는 본인입니다. 다른 사람에게는 짧은 안내만 보내고 모델을 호출하지 않습니다. 정보 패널이나 대화의 `yes <code>` 응답으로 허용할 수 있습니다.
- **답변을 잃지 않도록.** 전송 전에 로컬에 저장합니다. 네트워크 오류는 재시도하고 다시 시작해도 전송을 재개합니다. WeChat의 24시간 제한이 지나면 다음 메시지를 받을 때까지 기다렸다가 전달합니다.
- **텔레메트리 비활성화.** 내장 컴퓨터 사용 드라이버의 텔레메트리를 끄고 내장 게이트웨이의 자동 업데이트를 비활성화했습니다.
- **앱 내 업데이트.** 0.1.29부터 데스크톱 설치 버전은 설정 → 일반 → 업데이트 자동 다운로드가 기본으로 켜져 있습니다. 새 버전을 백그라운드에서 내려받고 완료되면 ‘재시작하여 업데이트’를 표시합니다. 사용자가 클릭하고 실행 중인 작업이 없을 때 설치하며, 설정을 끄면 직접 내려받을 수 있습니다. 0.1.28 이전 사용자는 먼저 0.1.29 이상을 한 번 직접 설치해야 합니다. Docker와 소스 배포는 계속 수동으로 업데이트합니다. 0.1.30부터는 업데이트 후 처음 열 때 바뀐 내용을 보여 주며, 새 버전 알림에서 업데이트 전에 내용을 확인하고, 설정 → 앱 정보에서 언제든 업데이트 기록을 볼 수 있습니다.
- **라이트, 다크, 시스템 테마.** 여섯 봇 캐릭터의 눈이 마우스 포인터를 따라 움직입니다.
- **트레이와 자동 시작.** 창을 닫으면 트레이에 숨깁니다. macOS와 Windows에서는 자동 시작을 지원합니다.

<p align="center">
  <img src="docs/assets/features/characters-eyes.gif" alt="나란히 선 여섯 AnyModelBot 캐릭터의 눈이 마우스 포인터를 따라 움직이는 모습" width="100%">
</p>

> [!NOTE]
> 기능은 선택한 모델, 운영체제, 부여한 권한에 따라 달라집니다. 컴퓨터 사용에는 데스크톱 세션이 필요하며 macOS에서는 베타입니다. 모델 요청은 선택한 제공업체로 전달됩니다(공식 API 키는 직접, 그 외에는 Modelflare 경유). [작동 방식과 개인정보](#-작동-방식과-개인정보)를 확인하세요.

# 🆚 AnyModelBot과 Grok Bot, OpenAI dots, Claude Duet 비교

2026년 하반기에 xAI의 [Grok Bot](https://x.ai/bot), OpenAI의 [dots](https://openai.com/index/introducing-dots/), Anthropic의 Claude Duet이 잇따라 출시되었습니다. 모두 백그라운드에서 나를 대신해 일하고, 결정이 필요할 때 물어보는 AI입니다. AnyModelBot도 같은 종류의 일을 다른 방식으로 합니다. 오픈 소스이고, 내 기기에서 실행하며, 다양한 모델을 사용할 수 있습니다.

| | AnyModelBot | Grok Bot | OpenAI dots | Claude Duet |
| :--- | :--- | :--- | :--- | :--- |
| 오픈 소스 | ✅ MIT | — | — | — |
| 실행 위치 | 내 컴퓨터 또는 서버 | xAI 클라우드 컴퓨터 | OpenAI 클라우드 컴퓨터 | Anthropic 클라우드 |
| 모델 | GPT, Claude, Gemini, Grok 등(Modelflare 또는 공식 API 경유) | 주로 xAI Grok 모델 | OpenAI 모델 | Claude(Opus 5.5) |
| 비용 | 앱 무료, 모델은 토큰 단위 과금 | 구독 | ChatGPT Pro / Business Premium 구독 | Claude Pro / Max 구독 |
| 이용 경로 | 데스크톱 앱(Windows, macOS, Linux), Docker, WeChat, Feishu, Telegram, Slack, Discord | 데스크톱 앱, iPhone | ChatGPT, Slack, Teams | iOS, Android, claude.ai |
| 제공 상태 | 지금 다운로드 가능 | 베타 | 일부 시장 | 연구 미리 보기, 미국 대기 명단 |

AnyModelBot도 백그라운드에서 일합니다. 맡긴 작업을 마친 뒤 채팅 앱으로 결과를 보내고 승인이나 답변이 필요한 항목은 사이드바의 ‘내 확인 필요’에 표시합니다. 모든 작업 단계를 볼 수 있으며 작업 공간 밖의 작업은 먼저 확인합니다.

> [!NOTE]
> 다른 제품에 관한 정보는 2026년 10월 공개 자료를 기준으로 하며 변경되었을 수 있습니다. 각 업체의 공식 정보를 확인하세요. Grok Bot, dots, Claude Duet은 각각 xAI, OpenAI, Anthropic의 제품 및 상표입니다. AnyModelBot은 이들과 제휴 관계가 없습니다.

# 🔐 작동 방식과 개인정보

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/data-flow-dark.svg">
  <img src="docs/assets/diagrams/data-flow-light.svg" alt="데이터 흐름: 대화·기억·파일·키는 기기에 저장, 모델 요청은 Modelflare를 거쳐 제공업체로 전달, 채팅 메시지는 해당 플랫폼 경유, 봇은 허용된 Notion과 Feishu 계정에 접근" width="100%">
</picture>

| 기기에 남는 정보 | 기기 외부로 전송되는 정보 |
| :--- | :--- |
| 대화와 세션(로컬 SQLite 데이터베이스) | 모델 답변에 필요한 프롬프트, 파일, 도구 결과. 선택한 제공업체로 전달(공식 API 키는 직접, 그 외에는 Modelflare 경유) |
| 기억(Markdown 파일) | 컴퓨터 사용으로 화면을 보도록 요청할 때의 스크린샷 |
| 봇별 작업 공간 파일 | 각 플랫폼을 거치는 채팅 채널 메시지 |
| API 키와 로그인 토큰 | modelflare.dev에서 진행하는 Modelflare 로그인 |
| 앱 연결 | 앱(Feishu, Notion, GitHub 등)을 연결하거나 커스텀 MCP를 추가하면 봇이 그 내용을 읽고 씁니다. 읽은 내용은 모델 요청에도 포함 |

Modelflare는 요청 로그를 보관합니다. 보관 항목과 기간은 [신뢰 센터](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)에서 설명합니다. 데이터에 위험이 전혀 없다고 주장하지 않습니다. 모델에 보내는 내용은 기기를 벗어납니다. 전체 목록은 [개인정보 문서](./docs/privacy_ko.md)를 확인하세요.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <img src="docs/assets/diagrams/architecture-light.svg" alt="구조: Electron·명령줄·Docker가 Preact 화면, SQLite, DSH 런타임, 채널 어댑터를 갖춘 Node.js·TypeScript 백엔드를 시작하며 내장 magpie 게이트웨이가 Modelflare 호출" width="100%">
</picture>

| 계층 | 기술 |
| :--- | :--- |
| 화면 | Preact + htm, 별도 빌드 단계 없음 |
| 백엔드 | Node.js 22.13 이상, TypeScript, `node:sqlite` |
| 데스크톱 셸 | Electron, 트레이 지원 |
| 모델 게이트웨이 | [magpie](https://github.com/yetone/magpie)(Go, MIT), 앱에 포함되어 자동 시작 |
| 에이전트 런타임 | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(MIT), 별도 프로세스로 실행 |
| 컴퓨터 사용 | 내장 [Cua Driver](https://github.com/trycua/cua) |
| 채널 | Feishu(지속 연결 + 실시간 카드), WeChat(iLink), Telegram(롱 폴링), Slack(Socket Mode), Discord(Gateway) |
| 앱 연결 | 기본 제공 커넥터: Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva. 커스텀 MCP: Streamable HTTP(SSE 호환), 로컬 명령 |
| 테스트 및 CI | Vitest, GitHub Actions |

# 📝 로드맵

검토 중인 방향입니다. 약속이나 일정은 아닙니다. 버전별 변경 사항은 [변경 내역](./CHANGELOG_ko.md)을 확인하세요.

- [x] **예약 작업**: 봇이 정해진 시간에 작업 실행(위에서 설명한 규칙으로 출시).
- [x] **앱 내 그룹 대화**: 그룹을 만들고 여러 봇과 동시에 대화.
- [ ] **채팅 채널의 그룹 대화**: 현재 채팅 채널은 일대일 대화만 지원.
- [x] **다국어 화면**: 중국어 간체, 영어, 일본어, 한국어, 러시아어, 스페인어, 포르투갈어(브라질)를 지원하며 설정에서 변경.
- [ ] **macOS 컴퓨터 사용**: 더 많은 실제 기기에서 직접 실행 모드를 검증하고 베타 종료.
- [ ] **이메일, 캘린더, 이벤트 트리거**: 이메일과 캘린더 계정을 연결하고 특정 발신자의 메시지나 곧 시작하는 회의처럼 이벤트가 발생하면 규칙 실행. 외부 콘텐츠가 유발한 실행에는 더 낮은 권한을 적용해 타인의 글이 봇에 명령을 내리지 못하도록 제한.
- [ ] **상시 호스팅, 백업, 이전**: 컴퓨터가 꺼져 있으면 규칙이 실행되지 않음. 누구나 자신의 서버에 한 번에 배포하고 대화·기억·계정을 이전하며 백업·복원할 수 있도록 개선.
- [ ] **사용자 지정 MCP 서버**: 현재는 내장 도구와 계정만 사용 가능. GitHub, Linear 등의 서비스를 직접 연결할 수 있도록 확장.
- [ ] **봇 간 협업**: 서로 다른 모델로 초안 작성과 검토를 나누는 등 봇끼리 작업을 넘기고 비용은 별도 추적.
- [ ] **음성 메시지 전사**: 현재 Telegram 음성 메시지를 들을 수 없으며 WeChat은 플랫폼 자체 전사에 의존.
- [ ] **독립 모바일 앱**: 현재는 WeChat, Feishu, Telegram, Slack, Discord로 봇에 접근.

다른 아이디어가 있나요? [이슈](https://github.com/modelflare-ai/AnyModelBot/issues)나 [토론](https://github.com/modelflare-ai/AnyModelBot/discussions)을 열어 주세요. 진행하기로 한 항목은 [`roadmap`](https://github.com/modelflare-ai/AnyModelBot/labels/roadmap) 레이블로 추적합니다.

# 🤝 기여하기

버그 제보, 수정, 문서, 아이디어 모두 환영합니다.

1. 먼저 기존 [이슈](https://github.com/modelflare-ai/AnyModelBot/issues)와 [토론](https://github.com/modelflare-ai/AnyModelBot/discussions)을 확인하세요. [`good first issue`](https://github.com/modelflare-ai/AnyModelBot/labels/good%20first%20issue)부터 시작하기 좋습니다.
2. 저장소를 포크하고 `master`에서 브랜치를 만드세요.
3. 로컬에서 실행하고 변경하세요.

   ```bash
   npm install
   npm run setup          # 내장 게이트웨이를 가져와 빌드
   npm run electron:dev   # 개발 모드 데스크톱 앱
   npm run typecheck && npm test
   ```

4. `master`를 대상으로 풀 리퀘스트를 열고 변경 사항과 이유를 설명하세요. 작은 수정을 넘어서는 작업은 먼저 이슈를 열어 방향을 논의해 주세요.

전체 [기여 안내](./CONTRIBUTING_ko.md)를 읽어 주세요. 보안 문제는 공개 이슈 대신 [보안 정책](./SECURITY_ko.md)을 따라 신고하세요.

# 🔗 관련 프로젝트

- [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme): AnyModelBot 모델을 제공하는 AI API 게이트웨이.
- [magpie](https://github.com/yetone/magpie): 앱에 포함된 Go 게이트웨이(MIT).
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): 에이전트 런타임(MIT).
- [Cua](https://github.com/trycua/cua): 컴퓨터 사용 드라이버.
- [kimi-computer-use](https://github.com/songkeys/kimi-computer-use): macOS 컴퓨터 사용 브리지.
- [openclaw-weixin](https://github.com/Tencent/openclaw-weixin): WeChat 채널 포팅 원본(MIT).
- [DS Bot](https://github.com/Fei2411/DS-Bot): 기억 및 컨텍스트 관리자 설계 참고(Apache-2.0).

전체 라이선스 및 고지: [제3자 고지](./THIRD_PARTY_NOTICES_ko.md).

# 💬 커뮤니티

- **질문과 아이디어:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **버그 및 기능 요청:** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues)
- **이메일:** [support@anymodel.bot](mailto:support@anymodel.bot)
- **Modelflare 소식:** [X의 @modelflare_dev](https://x.com/modelflare_dev)

# 🚀 기여자

<a href="https://github.com/modelflare-ai/AnyModelBot/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=modelflare-ai/AnyModelBot" alt="AnyModelBot 기여자" />
</a>

# ⭐️ 스타 기록

<a href="https://www.star-history.com/#modelflare-ai/AnyModelBot&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" />
    <img alt="AnyModelBot 스타 기록 차트" src="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" width="100%" />
  </picture>
</a>

# 📜 라이선스

AnyModelBot은 [MIT 라이선스](./LICENSE)로 배포됩니다. 포함된 제3자 소프트웨어는 각각의 라이선스를 유지합니다. [제3자 고지](./THIRD_PARTY_NOTICES_ko.md)와 [`LICENSES/`](./LICENSES) 폴더를 확인하세요.

<!-- link & badge references -->
[release-shield]: https://img.shields.io/github/v/release/modelflare-ai/AnyModelBot?include_prereleases&label=release&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIzIiB5PSI5IiB3aWR0aD0iOTQiIGhlaWdodD0iODIiIHJ4PSIzNiIgZmlsbD0iI2Q3ZmYwMCIvPjxyZWN0IHg9IjI5IiB5PSIzNiIgd2lkdGg9IjEzIiBoZWlnaHQ9IjI4IiByeD0iNi41IiBmaWxsPSIjMTYxYTAwIi8+PHJlY3QgeD0iNTgiIHk9IjM2IiB3aWR0aD0iMTMiIGhlaWdodD0iMjgiIHJ4PSI2LjUiIGZpbGw9IiMxNjFhMDAiLz48L3N2Zz4=&style=flat-square&labelColor=161a00&color=d7ff00
[downloads-shield]: https://img.shields.io/github/downloads/modelflare-ai/AnyModelBot/total?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[stars-shield]: https://img.shields.io/github/stars/modelflare-ai/AnyModelBot?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[license-shield]: https://img.shields.io/github/license/modelflare-ai/AnyModelBot?logo=opensourceinitiative&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[ci-shield]: https://img.shields.io/github/actions/workflow/status/modelflare-ai/AnyModelBot/ci.yml?branch=master&label=CI&logo=githubactions&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[platform-shield]: https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Docker-d7ff00?style=flat-square&labelColor=161a00
[pricing-shield]: https://img.shields.io/badge/pricing-pay--as--you--go-d7ff00?style=flat-square&labelColor=161a00
[modelflare-shield]: https://img.shields.io/badge/Modelflare-modelflare.dev-d7ff00?style=flat-square&labelColor=161a00
[x-shield]: https://img.shields.io/badge/X-@modelflare__dev-d7ff00?style=flat-square&labelColor=161a00&logo=x&logoColor=d7ff00
[win-badge]: https://img.shields.io/badge/Windows-161a00?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2Q3ZmYwMCI+PHJlY3QgeD0iMiIgeT0iMyIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48cmVjdCB4PSIxMi41IiB5PSIzIiB3aWR0aD0iOS41IiBoZWlnaHQ9IjguNSIvPjxyZWN0IHg9IjIiIHk9IjEyLjUiIHdpZHRoPSI5LjUiIGhlaWdodD0iOC41Ii8+PHJlY3QgeD0iMTIuNSIgeT0iMTIuNSIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48L3N2Zz4=
[mac-badge]: https://img.shields.io/badge/macOS-161a00?style=for-the-badge&logo=apple&logoColor=d7ff00
[linux-badge]: https://img.shields.io/badge/Linux-161a00?style=for-the-badge&logo=linux&logoColor=d7ff00

[releases-link]: https://github.com/modelflare-ai/AnyModelBot/releases
[stars-link]: https://github.com/modelflare-ai/AnyModelBot/stargazers
[license-link]: https://github.com/modelflare-ai/AnyModelBot/blob/master/LICENSE
[ci-link]: https://github.com/modelflare-ai/AnyModelBot/actions/workflows/ci.yml
[pricing-link]: https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme
[modelflare-link]: https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme
[x-link]: https://x.com/modelflare_dev
