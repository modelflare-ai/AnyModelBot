import type { TranslatedCatalog } from "../../index.js";
export default {
  waiting: "Aguardando permissão",
  channelWait: "Para operar este computador, é necessária a permissão {items}. Ative-a conforme as instruções no aplicativo e continuarei.",

  codexUnavailable: "Ponte do Codex Computer Use: requer macOS 14.4+ com o Codex Computer Use instalado",
  codexOff: "{base} ({why})",
  codexNotMac: "este sistema não é macOS",
  codexOldMac: "o macOS é anterior à versão 14.4",
  codexNoBridge: "o componente kimi-computer-use não está na instalação",
  codexNoClient: "cliente do Codex Computer Use não encontrado",
  codexNoLauncher: "o inicializador codex incluído no app ChatGPT/Codex não foi encontrado",
  codexAvailable: "Ponte do Codex Computer Use: disponível (macOS)",
  codexFallback: " (ponte do Codex indisponível, usando o Cua Driver no lugar: {reason})",
  cuaOff: "Cua Driver: indisponível ({why})",
  cuaAvailable: "Cua Driver: disponível ({os})",
  cuaUnsupported: "{platform} não é compatível",
  cuaMissing: "o cua-driver {version} para {plat} não está na instalação",
  cuaNoDisplay: "sem sessão gráfica: nem DISPLAY nem WAYLAND_DISPLAY estão definidos",
  cuaAtspi: "ler os elementos das janelas requer AT-SPI (at-spi2-core)",
  cuaWayland:
    "sessão Wayland: limitada — a leitura de janelas depende do AT-SPI, a entrada de teclado e mouse passa pelo XWayland, e só a janela em primeiro plano pode ser operada; {atspi}",
  cuaX11: "sessão X11; {atspi}",
  cuaMacNotice:
    "No primeiro uso, ative Acessibilidade e Gravação de Tela para este app em Ajustes do Sistema → Privacidade e Segurança. Ele roda no modo --direct, então as permissões devem pertencer a este app (ainda não verificado em um Mac real).",
  cuaWinNotice:
    "Precisa rodar na sessão interativa da área de trabalho de um usuário conectado; janelas executadas como administrador não podem ser operadas (a menos que este app também rode como administrador).",
  cuaNonInteractive:
    "precisa rodar na sessão interativa de um usuário conectado (foi detectado um serviço ou uma sessão não interativa)",
} satisfies TranslatedCatalog["cu"];
