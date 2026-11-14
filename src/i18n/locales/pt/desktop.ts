import type { TranslatedCatalog } from "../../index.js";
export default {
  instanceLockUnavailable: "Esta inicialização não obteve o bloqueio de instância única. Outra instância pode estar em execução ou a criação do bloqueio pode ter falhado. Confira o resultado e a pasta real de dados no log de inicialização.",

  updateReady: "A versão {version} foi baixada. Reinicie para atualizar quando quiser.",
  updateInstallFailed: "A instalação da atualização não foi concluída. O app vai reiniciar. Tente de novo mais tarde.",
  trayOpen: "Abrir {product}",
  trayOpenInBrowser: "Abrir no navegador",
  trayAutostart: "Abrir ao fazer login",
  trayOpenDataDir: "Abrir pasta de dados",
  trayQuit: "Sair",
  errorTitle: "{product} encontrou um problema",
  errorDetail: "{message}\n\nVeja os detalhes no log: {log}",
  logDisabled: "(desativado)",
  bootFailed: "Não foi possível iniciar {product}",
  uiNotStarted: "A interface local não iniciou",
  trayNeeds: "Precisa de você ({count})",
} satisfies TranslatedCatalog["desktop"];
