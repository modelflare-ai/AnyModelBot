import type { TranslatedCatalog } from "../../index.js";
export default {
  instanceLockUnavailable: "이번 실행은 단일 인스턴스 잠금을 얻지 못했습니다. 다른 인스턴스가 실행 중이거나 잠금 생성에 실패했을 수 있습니다. 시작 로그에서 잠금 결과와 실제 데이터 폴더를 확인하세요.",

  "updateReady": "{version} 버전 다운로드가 완료되었습니다. 준비되면 재시작하여 업데이트하세요.",
  "updateInstallFailed": "업데이트 설치가 완료되지 않았습니다. 앱을 다시 시작합니다. 잠시 후 다시 시도하세요.",
  "trayOpen": "{product} 열기",
  "trayOpenInBrowser": "브라우저에서 열기",
  "trayAutostart": "로그인 시 실행",
  "trayOpenDataDir": "데이터 폴더 열기",
  "trayQuit": "종료",
  "errorTitle": "{product}에 문제가 발생했습니다",
  "errorDetail": "{message}\n\n자세한 내용은 로그를 확인하세요: {log}",
  "logDisabled": "(사용 안 함)",
  "bootFailed": "{product}을(를) 시작하지 못했습니다",
  "uiNotStarted": "로컬 화면을 시작하지 못했습니다",
  "trayNeeds": "내 확인 필요 ({count})"
} satisfies TranslatedCatalog["desktop"];
