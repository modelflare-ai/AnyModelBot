# 보안 정책

[简体中文](./SECURITY.md#简体中文) | [繁體中文（台灣）](./SECURITY_zh-TW.md) | [English](./SECURITY.md#english) | [日本語](./SECURITY_ja.md) | 한국어 | [Русский](./SECURITY_ru.md) | [Español](./SECURITY_es.md) | [Português (Brasil)](./SECURITY_pt.md) | [Türkçe](./SECURITY_tr.md)

## 취약점 신고

보안 문제는 공개 이슈, 토론, 풀 리퀘스트로 제출하지 **마세요**.

다음 방법 중 하나로 비공개 신고해 주세요.

1. **GitHub 비공개 취약점 신고(권장):** 저장소의 **Security** 탭 → **Report a vulnerability**에서 제출하세요.
2. **이메일:** 제목에 ‘Security’를 넣어 [support@anymodel.bot](mailto:support@anymodel.bot)으로 보내세요.

다음 정보를 포함해 주세요.

- AnyModelBot 버전(설정 → 앱 정보), 운영체제와 아키텍처, 실행 방식(데스크톱 / 명령줄 / Docker)
- 문제의 내용과 공격자가 할 수 있는 일
- 재현 단계 또는 개념 증명
- 도움이 되는 로그나 진단 정보(설정 → 문제 해결 → ‘진단 정보 복사’에서 키와 토큰을 제거합니다)

## 신고 후 절차

1. 신고 접수를 확인합니다.
2. 조사하고 평가 결과와 진행 상황을 안내합니다.
3. 수정 방안과 공개 일정을 함께 정한 뒤 수정 버전을 배포합니다.
4. 동의해 주시면 릴리스 노트에 기여를 명시합니다.

## 지원 버전

보안 수정은 최신 버전에 반영합니다. 신고 전에 [최신 릴리스](https://github.com/modelflare-ai/AnyModelBot/releases)에서도 문제가 발생하는지 확인해 주세요.

## 범위

이 정책의 범위는 이 저장소의 AnyModelBot 앱(데스크톱, 명령줄, 이 저장소에서 빌드한 Docker 이미지)과 로컬 콘솔입니다.

Modelflare 자체 서비스([Modelflare 신뢰 센터](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)로 신고), WeChat 및 Feishu 플랫폼, magpie·DeepSeek Harness·Cua 등의 상위 프로젝트는 여기서 처리하지 않습니다. 각 관리자에게 신고해 주세요. 판단이 어렵다면 이메일을 보내 주시면 적절한 곳으로 안내하겠습니다.
