# 기여하기

[简体中文](./CONTRIBUTING.md) | [繁體中文（台灣）](./CONTRIBUTING_zh-TW.md) | [English](./CONTRIBUTING_en.md) | [日本語](./CONTRIBUTING_ja.md) | 한국어 | [Русский](./CONTRIBUTING_ru.md) | [Español](./CONTRIBUTING_es.md) | [Português (Brasil)](./CONTRIBUTING_pt.md) | [Türkçe](./CONTRIBUTING_tr.md)

AnyModelBot을 더 나은 앱으로 만드는 데 함께해 주셔서 감사합니다. 버그 제보, 수정, 문서, 아이디어 모두 환영합니다.

## 질문 및 의견

- **질문, 아이디어, 사용 사례:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **버그 및 기능 요청:** 템플릿을 사용해 [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues)에 제출
- **커뮤니티 채팅:** [Discord](https://discord.gg/umBN6wX3zJ) · [Telegram](https://t.me/+Tx6Payfzxqk2ZGVl)
- **보안 문제:** 공개 이슈를 열지 말고 [보안 정책](./SECURITY_ko.md)에 따라 비공개 신고
- **그 밖의 문의:** [support@anymodel.bot](mailto:support@anymodel.bot)

버그를 신고할 때 다음 정보를 포함해 주세요.

- 버전(설정 → 앱 정보), 운영체제와 아키텍처(예: Windows 11 x64, macOS 15 Apple silicon), 실행 방식(데스크톱 / 명령줄 / Docker)
- 재현 단계, 기대한 결과, 실제 결과
- 진단 정보: 설정 → 문제 해결 → ‘진단 정보 복사’(API 키와 토큰은 `***`로 대체됨). 로그는 데이터 폴더의 `logs/app.log`에 있습니다. 위치는 [개인정보 문서](./docs/privacy_ko.md#데이터-폴더)를 확인하세요.
- 특정 모델 관련 문제라면 모델 ID

## 개발 환경 설정

Node.js 22.13 이상과 내장 magpie 게이트웨이 컴파일을 위한 Go 1.26.8 이상이 필요합니다.

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup          # vendor/magpie 서브모듈을 가져와 build/bin/에 컴파일
```

| 명령 | 기능 |
| :--- | :--- |
| `npm start` | 명령줄 실행: 게이트웨이 + 봇 + `http://127.0.0.1:3600/` 콘솔 |
| `npm run dev` | 같은 방식으로 실행하며 코드 변경 시 다시 시작 |
| `npm run electron:dev` | 개발 모드 데스크톱 앱 |
| `npm run electron:smoke` | 데스크톱 스모크 테스트(화면 없는 Linux에서는 xvfb-run 사용) |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm test` | 단위 테스트 + 오프라인 종단 간 테스트 + 게이트웨이 통합 테스트 |
| `npm run test:dsh-bundle` | Electron에서 실제 DSH 통합 테스트(먼저 `prepare:dsh` + `bundle:dsh` 실행) |
| `npm run docs:check` | README 자체 검사 |

저장소 구조, 패키징, 채널 설정은 [개발 안내](./docs/development_ko.md)를 확인하세요.

## 브랜치 및 풀 리퀘스트

1. 저장소를 포크하고 `master`에서 브랜치를 만드세요.
2. 푸시 전에 다음을 실행하세요.

   ```bash
   npm run typecheck && npm test
   ```

   README나 `docs/`를 변경했다면 `npm run docs:check`도 실행하세요.
3. `master`를 대상으로 풀 리퀘스트를 열고 변경 내용, 이유, 검증 방법을 설명하세요. 화면 변경에는 스크린샷을 포함해 주세요.
4. 작은 수정을 넘어서는 작업(새 기능, 구조 변경, 새 의존성)은 먼저 이슈를 열어 방향을 논의한 뒤 진행해 주세요.
5. 하나의 PR에는 하나의 변경 주제를 담고 기존 커밋 형식(`feat(scope): …`, `fix(scope): …`)을 따르세요.

## 화면 변경

- `ui/design`의 토큰과 구성 요소를 사용하세요(`ui/design/README.md` 참조). 임의의 색상이나 글자 크기를 추가하지 마세요.
- 브랜드 강조색은 형광 연두색 `#d7ff00`입니다. 화면에 파란색을 추가하지 마세요.
- 콘솔은 별도 빌드 없는 Preact + htm으로 구성되어 있습니다. 번들러나 컴파일이 필요한 프런트엔드 의존성을 추가하지 마세요.
- 라이트와 다크 테마를 모두 확인하세요.
- 화면 문구는 `t()`로 표시합니다. 매니페스트에 등록된 모든 언어의 번역을 `ui/locales/<언어>/`에 추가하세요. 대만 중국어 번체 코드는 `zh-TW`입니다. 제출 전에 `npm run i18n:check`를 실행하세요.

## 제3자 코드와 의존성

- 의존성을 추가하거나 외부 코드를 포팅·수정했다면 `THIRD_PARTY_NOTICES.md`에 출처, 버전, 라이선스를 기록하세요.
- AGPL, SSPL, FSL처럼 MIT 배포와 호환되지 않는 라이선스의 구성 요소를 추가하지 마세요.

## 행동 강령

친절하게, 사실에 근거해 소통하세요. 모든 참여자를 존중하고 사람 대신 아이디어를 비판하세요. 괴롭힘, 인신공격, 차별적 표현은 허용하지 않습니다. 관리자는 이 기준에 맞지 않는 내용을 삭제할 수 있습니다. 우려 사항은 [support@anymodel.bot](mailto:support@anymodel.bot)으로 알려 주세요.

## 라이선스

제출한 기여는 이 저장소의 [MIT 라이선스](./LICENSE)로 배포됩니다.
