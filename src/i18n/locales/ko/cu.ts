import type { TranslatedCatalog } from "../../index.js";
export default {
  waiting: "권한 활성화 대기 중",
  channelWait: "컴퓨터를 조작하려면 이 컴퓨터에서 {items} 권한이 필요합니다. 데스크톱 앱의 안내에 따라 켜면 계속 진행합니다.",

  "codexUnavailable": "Codex Computer Use 브리지: macOS 14.4 이상 및 Codex Computer Use 설치 필요",
  "codexOff": "{base}({why})",
  "codexNotMac": "현재 시스템이 macOS가 아닙니다",
  "codexOldMac": "macOS 버전이 14.4보다 낮습니다",
  "codexNoBridge": "설치 파일에 kimi-computer-use 구성 요소가 없습니다",
  "codexNoClient": "Codex Computer Use 클라이언트를 찾지 못했습니다",
  "codexNoLauncher": "ChatGPT/Codex 앱에 포함된 codex 실행기를 찾지 못했습니다",
  "codexAvailable": "Codex Computer Use 브리지: 사용 가능(macOS)",
  "codexFallback": "(Codex 브리지를 사용할 수 없어 Cua Driver를 사용합니다: {reason})",
  "cuaOff": "Cua Driver: 사용 불가({why})",
  "cuaAvailable": "Cua Driver: 사용 가능({os})",
  "cuaUnsupported": "{platform}은(는) 지원하지 않습니다",
  "cuaMissing": "설치 파일에 {plat}용 cua-driver {version}이(가) 없습니다",
  "cuaNoDisplay": "그래픽 세션이 없습니다. DISPLAY와 WAYLAND_DISPLAY가 모두 설정되지 않았습니다",
  "cuaAtspi": "창 요소를 읽으려면 AT-SPI(at-spi2-core)가 필요합니다",
  "cuaWayland": "Wayland 세션: 기능 제한. 창 읽기는 AT-SPI에 의존하고 키보드와 마우스 입력은 XWayland를 사용하며 전경 창만 조작할 수 있습니다; {atspi}",
  "cuaX11": "X11 세션; {atspi}",
  "cuaMacNotice": "처음 사용할 때 시스템 설정 → 개인정보 보호 및 보안에서 이 앱의 손쉬운 사용 및 화면 기록 권한을 켜세요. --direct 모드로 실행하므로 권한은 이 앱에 부여되어야 합니다(아직 실제 Mac에서 검증하지 않았습니다).",
  "cuaWinNotice": "로그인한 사용자의 대화형 데스크톱 세션에서 실행해야 합니다. 관리자 권한으로 실행한 창은 조작할 수 없습니다(이 앱도 관리자 권한으로 실행한 경우 제외).",
  "cuaNonInteractive": "로그인한 사용자의 대화형 세션에서 실행해야 합니다(서비스 또는 비대화형 세션 감지)"
} satisfies TranslatedCatalog["cu"];
