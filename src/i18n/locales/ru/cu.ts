import type { TranslatedCatalog } from "../../index.js";
export default {
  waiting: "Ожидание разрешения",
  channelWait: "Для управления компьютером нужно разрешение {items}. Включите его по инструкции в приложении, и я продолжу.",

  codexUnavailable:
    "Мост Codex Computer Use: требуется macOS 14.4+ с установленным Codex Computer Use",
  codexOff: "{base} ({why})",
  codexNotMac: "это не macOS",
  codexOldMac: "версия macOS старше 14.4",
  codexNoBridge: "в установке отсутствует компонент kimi-computer-use",
  codexNoClient: "Клиент Codex Computer Use не найден",
  codexNoLauncher:
    "не найден исполняемый файл codex из приложения ChatGPT/Codex",
  codexAvailable: "Мост Codex Computer Use доступен (macOS)",
  codexFallback: " (мост Codex недоступен; используется Cua Driver: {reason})",
  cuaOff: "Cua Driver недоступен ({why})",
  cuaAvailable: "Cua Driver доступен ({os})",
  cuaUnsupported: "{platform} не поддерживается",
  cuaMissing: "в установке отсутствует cua-driver {version} для {plat}",
  cuaNoDisplay:
    "нет графического сеанса: не заданы ни DISPLAY, ни WAYLAND_DISPLAY",
  cuaAtspi: "для чтения элементов окон требуется AT-SPI (at-spi2-core)",
  cuaWayland:
    "Сеанс Wayland: возможности ограничены. Чтение окон через AT-SPI, ввод клавиатуры и мыши через XWayland; управлять можно только активным окном. {atspi}",
  cuaX11: "Сеанс X11; {atspi}",
  cuaMacNotice:
    "При первом использовании разрешите приложению доступ к специальным возможностям и записи экрана в разделе «Системные настройки → Конфиденциальность и безопасность». Используется режим --direct, поэтому разрешения должны принадлежать этому приложению (ещё не проверено на реальном Mac).",
  cuaWinNotice:
    "Нужен интерактивный сеанс вошедшего пользователя. Окнами, запущенными от администратора, нельзя управлять, если это приложение тоже не запущено от администратора.",
  cuaNonInteractive:
    "нужен интерактивный сеанс вошедшего пользователя; обнаружена служба или неинтерактивный сеанс",
} satisfies TranslatedCatalog["cu"];
