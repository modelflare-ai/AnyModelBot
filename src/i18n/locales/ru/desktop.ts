import type { TranslatedCatalog } from "../../index.js";
export default {
  instanceLockUnavailable: "При запуске не удалось получить блокировку единственного экземпляра. Возможно, другой экземпляр уже работает или создание блокировки завершилось ошибкой. Проверьте результат и фактическую папку данных в журнале запуска.",

  "updateReady": "Версия {version} скачана. Перезапустите приложение для обновления, когда будете готовы.",
  "updateInstallFailed": "Установка обновления не завершена. Приложение перезапустится. Попробуйте позже.",
  trayOpen: "Открыть {product}",
  trayOpenInBrowser: "Открыть в браузере",
  trayAutostart: "Запускать при входе в систему",
  trayOpenDataDir: "Открыть папку данных",
  trayQuit: "Выйти",
  errorTitle: "В работе {product} возникла ошибка",
  errorDetail: "{message}\n\nПодробности в журнале: {log}",
  logDisabled: "(выключено)",
  bootFailed: "Не удалось запустить {product}",
  uiNotStarted: "Не удалось запустить локальный интерфейс",
  trayNeeds: "Требует внимания ({count})",
} satisfies TranslatedCatalog["desktop"];
