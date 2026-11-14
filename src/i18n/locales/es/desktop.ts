import type { TranslatedCatalog } from "../../index.js";
export default {
  instanceLockUnavailable: "Este inicio no obtuvo el bloqueo de instancia única. Puede haber otra instancia abierta o haber fallado la creación del bloqueo. Consulta el resultado y la carpeta de datos real en el registro de inicio.",

  updateReady: "Se descargó la versión {version}. Reinicia para actualizar cuando quieras.",
  updateInstallFailed: "La instalación de la actualización no terminó. La app se reiniciará. Vuelve a intentarlo más tarde.",
  trayOpen: "Abrir {product}",
  trayOpenInBrowser: "Abrir en el navegador",
  trayAutostart: "Abrir al iniciar sesión",
  trayOpenDataDir: "Abrir carpeta de datos",
  trayQuit: "Salir",
  errorTitle: "{product} tuvo un problema",
  errorDetail: "{message}\n\nConsulta el registro para ver los detalles: {log}",
  logDisabled: "(desactivado)",
  bootFailed: "{product} no pudo iniciarse",
  uiNotStarted: "La interfaz local no se inició",
  trayNeeds: "Te necesita ({count})",
} satisfies TranslatedCatalog["desktop"];
