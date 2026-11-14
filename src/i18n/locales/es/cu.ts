import type { TranslatedCatalog } from "../../index.js";
export default {
  waiting: "Esperando permiso",
  channelWait: "Para manejar este ordenador se necesita el permiso {items}. Actívalo siguiendo las indicaciones de la aplicación y continuaré.",

  codexUnavailable: "Puente de Codex Computer Use: requiere macOS 14.4 o posterior con Codex Computer Use instalado",
  codexOff: "{base} ({why})",
  codexNotMac: "este sistema no es macOS",
  codexOldMac: "la versión de macOS es anterior a la 14.4",
  codexNoBridge: "falta el componente kimi-computer-use en la instalación",
  codexNoClient: "no se encontró el cliente de Codex Computer Use",
  codexNoLauncher: "no se encontró el lanzador de codex incluido en la app ChatGPT/Codex",
  codexAvailable: "Puente de Codex Computer Use: disponible (macOS)",
  codexFallback: " (el puente de Codex no está disponible; se usa Cua Driver en su lugar: {reason})",
  cuaOff: "Cua Driver: no disponible ({why})",
  cuaAvailable: "Cua Driver: disponible ({os})",
  cuaUnsupported: "{platform} no es compatible",
  cuaMissing: "falta cua-driver {version} para {plat} en la instalación",
  cuaNoDisplay: "no hay sesión gráfica: no está definida DISPLAY ni WAYLAND_DISPLAY",
  cuaAtspi: "para leer los elementos de las ventanas se necesita AT-SPI (at-spi2-core)",
  cuaWayland: "Sesión de Wayland: funciones limitadas — la lectura de ventanas depende de AT-SPI, la entrada de teclado y mouse pasa por XWayland y solo se puede operar la ventana en primer plano; {atspi}",
  cuaX11: "Sesión de X11; {atspi}",
  cuaMacNotice:
    "La primera vez, activa Accesibilidad y Grabación de pantalla para esta app en Configuración del Sistema → Privacidad y seguridad. Se ejecuta en modo --direct, así que los permisos deben pertenecer a esta app (aún no se verificó en una computadora Mac real).",
  cuaWinNotice: "Debe ejecutarse en la sesión de escritorio interactiva de un usuario que haya iniciado sesión; no se pueden operar las ventanas que se ejecutan como administrador (a menos que esta app también se ejecute como administrador).",
  cuaNonInteractive: "debe ejecutarse en la sesión interactiva de un usuario que haya iniciado sesión (se detectó un servicio o una sesión no interactiva)",
} satisfies TranslatedCatalog["cu"];
