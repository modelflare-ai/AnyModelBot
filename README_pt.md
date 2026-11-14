<p align="center">
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">
    <img src="docs/assets/brand/logo-eyes.webp" width="120" height="120" alt="Símbolo AnyModelBot Eyes: dois olhos verticais em forma de pílula que olham para a esquerda e para a direita">
  </a>
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/wordmark-dark.svg">
    <img src="docs/assets/brand/wordmark-light.svg" height="40" alt="AnyModelBot">
  </picture>
</h1>

<p align="center"><b>Uma equipe de bots de IA no seu próprio computador. Qualquer modelo, pagamento por uso.</b></p>

<p align="center">
  <a href="https://anymodel.bot/pt/">Site</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">Baixar</a> |
  <a href="./README.md">简体中文</a> |
  <a href="./README_en.md">English</a> |
  <a href="./README_ja.md">日本語</a> |
  <a href="./README_ko.md">한국어</a> |
  <a href="./README_ru.md">Русский</a> |
  <a href="./README_es.md">Español</a> |
  Português (Brasil) |
  <a href="https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme">Modelflare</a> |
  <a href="https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme">Preços</a> |
  <a href="./docs/development_pt.md">Desenvolvimento</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/issues">Feedback</a>
</p>

<div align="center">

[![Versão][release-shield]][releases-link]
[![Downloads][downloads-shield]][releases-link]
[![Estrelas][stars-shield]][stars-link]
[![Licença][license-shield]][license-link]
[![CI][ci-shield]][ci-link]

[![Plataformas][platform-shield]][releases-link]
[![Preços][pricing-shield]][pricing-link]
[![Modelflare][modelflare-shield]][modelflare-link]
[![X][x-shield]][x-link]

</div>

<p align="center">
  <img src="docs/assets/hero/hero-demo.gif" alt="AnyModelBot em ação: entrar no Modelflare, escolher um modelo, pedir a um bot que organize uma pasta e aprovar a movimentação de um arquivo" width="100%">
</p>

# 🤖 AnyModelBot

O AnyModelBot é uma equipe de bots de IA para Windows, macOS e Linux que roda no seu computador. Cada bot tem sua própria persona, modelo padrão, espaço de trabalho e memória. Você pode conversar no app ou conectar WeChat, Feishu, Telegram, Slack ou Discord. Ele pode ler e gravar arquivos, executar comandos e operar a área de trabalho depois que você der permissão; antes de gravar fora do espaço de trabalho, ele pergunta.

Conversas, memória, arquivos e chaves de API ficam no seu dispositivo. Os modelos podem vir do [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) (entre e pague pelo uso) ou das suas próprias chaves de API oficiais, enviadas diretamente ao provedor. O AnyModelBot em si não cobra assinatura.

Pronto para usar logo após a instalação: tarefas em segundo plano, regras agendadas e os itens que aguardam o seu OK já vêm integrados.

**0.1.35:** Barra lateral mais simples, Heroicons, saldo nas configurações, largura estável e correções de regras, permissões e textos em sete idiomas. [Histórico de alterações](./CHANGELOG_pt.md#0135---2026-11-14)

📥 [Baixar](#-baixar-e-executar) · 🌠 [Capturas de tela](#-capturas-de-tela) · 🌟 [Recursos](#-principais-recursos) · 🆚 [Comparação](#-anymodelbot-vs-grok-bot-openai-dots-e-claude-duet) · 🔐 [Privacidade](#-como-funciona-e-privacidade)

⭐ Gostou do AnyModelBot? Dê uma estrela no repositório para acompanhar as novas versões.

---

<a href="https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme">
  <img src="docs/assets/modelflare/modelflare-banner-en.webp" width="100%" alt="Banner do Modelflare: cadastre-se no Modelflare">
</a>

A forma mais fácil de obter modelos é o **[Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)**: entre e use os modelos, sem precisar pedir uma chave separada a cada provedor (para ir direto a um provedor, veja [Qualquer modelo](#-qualquer-modelo-via-modelflare-ou-apis-oficiais)). Os modelos disponíveis, os preços e as ofertas atuais estão no [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) e na [tabela de preços](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme).

**Créditos de Bot**: contas novas recebem créditos de Bot ao se cadastrar, e as assinaturas do Modelflare adicionam créditos de Bot equivalentes a 10% do plano; veja as condições atuais no site do Modelflare. Os créditos de Bot só podem ser usados no AnyModelBot. As requisições feitas pelo app usam esses créditos primeiro, e Configurações → Modelos mostra quanto resta.

**[Cadastre-se no Modelflare →](https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme)** ·
[Tabela de preços](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[Documentação da API](https://docs.modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[Central de Confiança](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[X](https://x.com/modelflare_dev)

**Como o AnyModelBot usa o Modelflare**

- **Entre uma vez.** Na primeira execução, o navegador abre para você entrar no Modelflare (ou se cadastrar). Depois o app conecta este dispositivo sozinho, então não há chave para copiar, e traz você de volta assim que você aprova. Se você ainda não tiver um modelo padrão, ele escolhe um modelo de baixo custo que suporta ferramentas. Está rodando no Docker ou em um servidor? Entre pelo navegador em qualquer dispositivo e cole no app o link da página em que você chegar.
- **Todos os modelos em um só seletor.** Seus modelos do Modelflare aparecem automaticamente, com o tamanho do contexto, as capacidades e os preços de referência ao lado de cada um.
- **Pague pelo que usar.** O saldo e o link Recarregar ficam em Configurações → Modelos (com o saldo e a porcentagem de créditos de Bot restantes, se você tiver), e os lembretes de saldo baixo e o uso diário aparecem dentro do app. Consulte a tabela de preços pública e compare com os preços oficiais antes de escolher um modelo.
- **Um limite honesto.** As requisições aos modelos passam pelo Modelflare até o provedor que você escolher, e o Modelflare mantém logs das requisições. Veja na [Central de Confiança](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) o que é guardado e por quanto tempo. Todo o resto fica no seu dispositivo ([detalhes](#-como-funciona-e-privacidade)).

---

# 📥 Baixar e executar

Escolha sua plataforma. A página de cada versão lista todos os instaladores e um arquivo `SHA256SUMS`.

| Plataforma | Arquitetura | Instalador | |
| :--- | :--- | :--- | :--- |
| ![Windows][win-badge] | x64 | `anymodel-bot-<version>-win-x64.exe` | [Baixar][releases-link] |
| ![Windows][win-badge] | arm64 | `anymodel-bot-<version>-win-arm64.exe` | [Baixar][releases-link] |
| ![macOS][mac-badge] | Apple silicon | `anymodel-bot-<version>-mac-arm64.dmg` | [Baixar][releases-link] |
| ![macOS][mac-badge] | Intel | `anymodel-bot-<version>-mac-x64.dmg` | [Baixar][releases-link] |
| ![Linux][linux-badge] | x64 | `anymodel-bot-<version>-linux-x86_64.AppImage` | [Baixar][releases-link] |
| ![Linux][linux-badge] | arm64 | `anymodel-bot-<version>-linux-arm64.AppImage` | [Baixar][releases-link] |

<p align="center">
  <img src="docs/assets/download/install-windows.gif" alt="Instalando o AnyModelBot no Windows: executar o instalador, abrir o app e chegar à tela de login do Modelflare" width="100%">
</p>

**Primeira execução.** Se o Windows mostrar um aviso de segurança, escolha *Mais informações → Executar assim mesmo*. O app para macOS é assinado com Developer ID e notarizado pela Apple: arraste-o para Aplicativos, abra-o e escolha Abrir se aparecer a confirmação de download da internet. No Linux, marque o AppImage como executável (`chmod +x`) e execute-o. Fechar a janela esconde o AnyModelBot na bandeja do sistema; para sair, use o menu da bandeja ou as Configurações.

**Verifique o download.**

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

No macOS, use `shasum -a 256 <file>`; no Windows PowerShell, use `Get-FileHash <file>`. Compare o resultado com a linha em `SHA256SUMS`.

**Execute no Docker em um NAS ou servidor** (a imagem cobre x64 e arm64)

```bash
docker run -d --name amb -p 3600:3600 -v amb-data:/data ghcr.io/modelflare-ai/anymodel-bot
docker exec amb cat /data/ui-token   # depois abra http://<host>:3600/?token=<token>
```

Não exponha a porta 3600 diretamente à internet.

**Execute a partir do código-fonte**

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup      # baixa e compila o gateway incluído
npm start          # abre o console local em http://127.0.0.1:3600/
```

Requisitos para compilar a partir do código-fonte: Node.js 22.13+ e Go 1.26.8+. Para gerar a imagem Docker você mesmo, veja o [guia de desenvolvimento](./docs/development_pt.md).

# 🌠 Capturas de tela

Estas capturas mostram a interface em chinês simplificado. O app também está disponível em inglês, japonês, coreano, russo, espanhol e português (Brasil); troque o idioma nas Configurações.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/chat-dark.webp">
  <img src="docs/assets/screenshots/chat-light.webp" alt="Tela de chat: uma resposta com lista em Markdown e um bloco de código, o botão de modelo no campo de mensagem e a lista de bots à esquerda" width="100%">
</picture>

<p align="center"><i>Converse com um bot. As respostas renderizam Markdown e código, e o campo de mensagem mostra qual modelo está em uso.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/agent-dark.webp">
  <img src="docs/assets/screenshots/agent-light.webp" alt="Tela do bot: lista de atividades passo a passo de uma tarefa com arquivos e um cartão de aprovação pedindo para gravar fora do espaço de trabalho" width="100%">
</picture>

<p align="center"><i>O que o bot faz fica visível passo a passo. Tudo o que estiver fora do espaço de trabalho aguarda a sua aprovação.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/models-dark.webp">
  <img src="docs/assets/screenshots/models-light.webp" alt="Seletor de modelos: lista pesquisável de modelos do Modelflare com tamanho do contexto, etiquetas de capacidades e preços de referência" width="100%">
</picture>

<p align="center"><i>Escolha qualquer modelo do Modelflare para cada conversa. Tamanho do contexto, capacidades e preços de referência aparecem ao lado de cada um.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/memory-dark.webp">
  <img src="docs/assets/screenshots/memory-light.webp" alt="Painel de informações com as entradas de memória de um bot, os canais conectados e as sessões recentes" width="100%">
</picture>

<p align="center"><i>Memória, canais e sessões de cada bot em um só painel.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/modelflare-dark.webp">
  <img src="docs/assets/screenshots/modelflare-light.webp" alt="Configurações, aba Modelflare com a janela de uso aberta: uso diário dos últimos 7 dias, a linha do modelo padrão abaixo e o saldo no botão da conta" width="100%">
</picture>

<p align="center"><i>Sua conta Modelflare dentro do app: saldo, uso e padrões.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/bots-dark.webp">
  <img src="docs/assets/screenshots/bots-light.webp" alt="Seis personagens do AnyModelBot lado a lado, cada um com sua própria cor" width="100%">
</picture>

<p align="center"><i>Seis personagens para distinguir seus bots. Os olhos deles seguem o ponteiro.</i></p>

# 🌟 Principais recursos

## 🤖 Bots que fazem o trabalho

Um bot é mais do que uma janela de chat: ele tem uma persona, um modelo padrão, seu próprio espaço de trabalho e sua própria memória.

- **Quantos você precisar**, cada um com sua própria persona, modelo, espaço de trabalho e avatar.
- **Você define cada bot.** Uma persona é só um texto, e os templates são apenas um ponto de partida. Os seis avatares mudam a aparência do bot, não o que ele consegue fazer.
- **Trabalho real com arquivos.** Os bots leem e gravam arquivos, executam comandos em um sandbox e enviam os resultados de volta ao chat como arquivos.
- **Três predefinições de permissão por bot.** *Somente leitura*, *Gravação no espaço de trabalho* (o padrão: grava dentro da pasta do próprio bot e pergunta antes de gravar fora do espaço de trabalho) e *Acesso total* (sem sandbox; mesmo com acesso total, pergunta antes de excluir uma pasta inteira).
- **Importe habilidades.** Em **Configurações do bot → Habilidades**, importe um ZIP que contenha `SKILL.md` (uma habilidade por ZIP, até 20 MB), depois visualize e adicione. Veja, ative, desative ou exclua habilidades; importe de novo o mesmo nome para confirmar a substituição. As alterações passam a valer depois que o trabalho em andamento terminar. [Guia de habilidades](./docs/skills_pt.md).
- **Cartões de aprovação, sem surpresas.** Ações que gravam fora do espaço de trabalho param e aguardam a sua resposta.
- **Aviso após reiniciar.** Uma mensagem que ainda estava em andamento quando o app foi fechado ou travou é sinalizada na conversa na próxima inicialização, para que você possa enviá-la de novo; nada é refeito por conta própria.
- **Conversas em grupo.** Crie um grupo e adicione alguns bots. Responde quem você mencionar com @; sem @, continua o bot que respondeu por último. Os bots também podem mencionar outro membro com @ para passar a vez. Cada bot mantém seu próprio modelo, espaço de trabalho e memória, e os custos são contabilizados por bot.
- **Pesquise o histórico de conversas.** Pesquise pela barra lateral todas as mensagens salvas no seu dispositivo, filtre por bot, conversa, canal ou data e vá direto à mensagem original. `Ctrl/Cmd+Shift+F` abre a pesquisa global; `Ctrl/Cmd+F` pesquisa no chat atual. As pesquisas não chamam nenhum modelo. Antes de você digitar, a janela de pesquisa lista os chats recentes por data.
- **Comandos de barra** como `/model` e `/reset` funcionam no app e em todos os canais de chat. Em um canal de chat, `/bot` troca para outro bot.

<p align="center">
  <img src="docs/assets/features/agent-files.gif" alt="Um bot organiza uma pasta bagunçada: lista os arquivos, propõe um plano, e um cartão de aprovação pergunta antes de mover arquivos para fora do espaço de trabalho" width="100%">
</p>

## 🧩 Bots prontos

Se você não quiser escrever uma persona, use um bot pronto da página Descobrir. Cada um tem sua própria interface. Ao abrir um deles, você vê um exemplo, e ele só é instalado quando você envia a primeira mensagem.

Os bots oficiais incluem no instalador suas interfaces, exemplos, personas e habilidades. A primeira visualização e a instalação não exigem baixar pacotes de bots. As atualizações vêm com as versões do app e preservam os dados dos projetos existentes. As chamadas aos modelos e a pesquisa online ainda precisam de conexão com a internet. Cada bot é um espaço de trabalho no estilo desktop: seus trabalhos ficam listados à esquerda e o conteúdo à direita, Novo abre um formulário guiado curto, a barra superior alterna para o chat completo e o campo de mensagem tem o seletor de modelos.

- **Pesquisa de empresas:** Pesquisa de empresas no seu computador, com resumos que citam as fontes e relatórios em PDF.
- **PPT Master:** Transforme documentos ou temas em slides editáveis, ou edite apresentações que você já tem.
- **Estúdio de cinema:** Vídeos curtos e séries: roteiro, storyboard, narração, edição e versão final.
- **Ações dos EUA:** Pesquise empresas listadas nos EUA a partir dos documentos protocolados na SEC, com cada número rastreável.

O Estúdio de cinema exige o AnyModelBot 0.1.23 ou posterior, Python 3.10+ e FFmpeg (incluindo o ffprobe) no seu dispositivo. As imagens e os vídeos de IA usam o Modelflare e são cobrados pelo uso; projetos e mídias ficam no seu dispositivo.

Veja os detalhes na [página de bots do nosso site](https://anymodel.bot/pt/bots).

## ⏳ Trabalha em segundo plano e só chama você quando necessário

- **Tarefas em segundo plano.** Para trabalhos que levam algum tempo (uma pesquisa, um relatório, organizar arquivos), ou quando você diz “faça em segundo plano”, o bot inicia uma tarefa em segundo plano e você continua conversando. O resultado volta para a conversa que o pediu.
- **Acompanhamento.** Cite o resultado no WeChat, ou responda a ele no Feishu, para continuar falando com aquela tarefa.
- **Regras.** “Todo dia às 8 da manhã, confira o preço de X e me avise se cair abaixo de 200” vira uma regra que verifica nos horários definidos e só avisa você quando algo importa. Para ver como ela se comporta antes, diga “observe primeiro”: ela registra o que teria dito, sem enviar nada nem alterar arquivos. Quando estiver tudo certo, mude para agir.
- **Precisa de você.** Tudo o que qualquer bot está esperando de você — uma resposta, uma aprovação ou uma nova tentativa — fica em uma única linha da barra lateral, que só aparece quando algo precisa de você. O grupo Tarefas do painel de informações lista as tarefas e as regras do bot, com cada etapa visível.
- **Silencioso por padrão.** Só resultados, decisões e falhas são enviados, nunca o progresso. O horário de silêncio vai das 22:00 às 08:00, e as mensagens espontâneas têm um limite diário (3 no WeChat, 5 nos outros canais); o restante é reunido em uma só.
- **Orçamentos.** Cada tarefa e cada regra têm um orçamento (1 dólar americano por tarefa; 0,10 por execução de regra e 3 por mês), e o trabalho para e pergunta quando ele acaba. Altere os valores nos detalhes da tarefa e no editor de regras.
- **Pause quando quiser.** Um único botão em Configurações do bot › Mensagens proativas pausa o trabalho em segundo plano; o chat continua normalmente.
- **Faz a limpeza sozinho.** Tarefas e logs de execução são mantidos por 30 dias. Uma pasta de tarefa sem uso por 30 dias é excluída sem perguntar; os detalhes da tarefa mostram a data, e Manter a preserva. Os logs de execução podem ser exportados em Markdown.

O runtime é construído sobre o [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), e o design se inspira no [protótipo de superagente](https://github.com/deepseek-ai/dsh-superagent-prototype) da DeepSeek. A história completa, em chinês: [AnyModelBot 超级智能体](./docs/blog/superagent.md).

## 🖥️ Opera o seu computador e cria imagens e vídeos

- **O uso do computador** funciona com o [Cua Driver](https://github.com/trycua/cua) incluído. Por padrão, as ações são executadas automaticamente. Mude um bot para *perguntar antes de alterar a tela*, e cada clique e cada tecla vão aguardar você. Ler a tela nunca exige aprovação. No macOS, o uso do computador é um recurso Beta: as permissões de Acessibilidade e Gravação de Tela só são solicitadas quando um bot precisa delas pela primeira vez, e o chat explica qual está faltando.
- **A geração de imagens e vídeos** começa na hora, adotando a interpretação mais razoável de um pedido vago. Ela só pergunta antes quando o custo estimado passa de 0,50 dólar americano, para que você veja o modelo e o prompt e possa trocar o modelo na hora. Para ser consultado todas as vezes, ative essa opção nas configurações do bot.

<p align="center">
  <img src="docs/assets/features/computer-use.gif" alt="Um bot abre o Bloco de Notas, digita uma nota curta e a salva, enquanto um cartão de aprovação pergunta antes de cada clique e de cada tecla" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/media-generation.gif" alt="Um bot pergunta qual modelo usar para uma imagem, o usuário confirma, e a imagem pronta chega ao chat como arquivo e abre em um visualizador" width="100%">
</p>

## 🌐 Qualquer modelo, via Modelflare ou APIs oficiais

- **Entre uma vez** e seus modelos do Modelflare aparecem automaticamente.
- **Ou use suas próprias chaves de API oficiais.** OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Kimi, GLM, Qwen, MiniMax e Mistral são suportados. As chaves ficam no seu dispositivo, as requisições vão direto ao provedor sem passar pelo Modelflare, e quem cobra é o provedor. Por enquanto, a geração de imagens e vídeos só está disponível pelo Modelflare.
- **Um seletor para tudo.** GPT, Claude, Gemini, Grok, DeepSeek, Kimi, GLM e outros, cada um com tamanho do contexto, etiquetas de capacidades e preço de referência.
- **Troque por conversa** ou defina um padrão por bot. Trabalhos internos, como organizar a memória e as transições de contexto, podem usar um modelo próprio, separado.
- **Três domínios de API.** Escolha `modelflare.dev`, `origin.modelflare.dev` ou `cf.modelflare.dev` e compare os tempos de resposta nas Configurações; o AnyModelBot nunca troca de domínio automaticamente.
- **Pagamento por uso.** Saldo da carteira, lembretes de saldo baixo, uso diário e chaves com orçamento por bot já vêm integrados. O AnyModelBot em si não cobra assinatura.

<p align="center">
  <img src="docs/assets/features/first-run.gif" alt="Primeira execução: clicar em Entrar com Modelflare, aprovar no navegador, voltar ao app com os modelos listados e enviar a primeira mensagem" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/model-switch.gif" alt="Abrir o seletor de modelos, pesquisar um modelo, ver o tamanho do contexto e o preço de referência e trocar a conversa para ele" width="100%">
</p>

## 🧠 Memória e acesso de qualquer lugar

- **Memória que permanece.** Cada bot, grupo e equipe tem sua própria memória, guardada em Markdown e mantida separada. Conteúdo que pareça senha ou chave não é salvo.
- **Chats longos continuam utilizáveis.** Um gestor de contexto compacta a conversa ou começa um novo trecho com um resumo de transição antes que a janela de contexto fique cheia.
- **Contas compartilhadas por todos os bots.** Adicione as contas de chat do WeChat, Feishu, Telegram, Slack e Discord uma única vez em Configurações › Canais de chat. Todos os bots as compartilham, e cada canal pode ter várias contas com apelidos. Envie `/bot name` uma vez em um app de chat para falar com outro bot.
- **Conectar apps.** O item Conectar apps no menu do avatar traz conectores para Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian e Canva, e você pode adicionar conectores MCP personalizados (servidores remotos ou comandos locais). Conecte uma vez e todos os bots podem usar por padrão; restrinja por bot e por ferramenta. Ferramentas somente leitura rodam na hora, gravações perguntam antes, e exclusões ou qualquer envio para outras pessoas sempre perguntam.
- **WeChat e Feishu.** Escaneie um QR code para conectar o WeChat ou conecte um bot do Feishu com cartões de resposta em streaming. O WeChat também transmite imagens e arquivos.
- **Telegram, Slack e Discord.** Cole um token em Configurações › Canais de chat. Não é preciso endereço público. As respostas aparecem enquanto são escritas, e imagens e arquivos funcionam nos dois sentidos. Por enquanto, só mensagens diretas, e aprovações e perguntas são respondidas por texto.
- **Quatro formas de executar.** App de desktop, linha de comando, Docker ou o console web local em `127.0.0.1:3600`.

<p align="center">
  <img src="docs/assets/features/memory.gif" alt="Pedir a um bot que se lembre de uma preferência, abrir o painel de informações para ver a nova entrada de memória e iniciar um novo chat em que o bot a utiliza" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/channels-wechat.gif" alt="Escanear um QR code para conectar o WeChat, enviar uma pergunta pelo celular e o bot responder no celular, enquanto a conversa aparece em Sessões recentes no app de desktop" width="100%">
</p>

## 🔒 Local em primeiro lugar e agradável aos olhos

- **Seus dados ficam com você.** Conversas, memória, arquivos e chaves de API são armazenados no seu dispositivo. O console local só escuta em `127.0.0.1`, e o app de desktop gera um novo token de acesso a cada inicialização.
- **Quem manda é você.** Por padrão, um bot só responde ao proprietário (a conta do WeChat que escaneou o QR code; no Feishu, Telegram, Slack e Discord, a primeira pessoa que enviar uma mensagem depois que você o conectar, ou seja, você) e às pessoas que você permitir. Qualquer outra pessoa recebe um aviso de uma linha e nenhum modelo é chamado; você libera o acesso pelo painel de informações ou respondendo `yes <code>` no chat.
- **As respostas não se perdem.** Cada resposta é salva localmente antes de ser enviada; erros de rede geram novas tentativas, o envio é retomado depois de reiniciar e, quando a janela de 24 horas do WeChat já fechou, a resposta espera e chega junto com a sua próxima mensagem.
- **Telemetria desligada.** A telemetria do driver de uso do computador incluído está desativada, e o gateway integrado roda com a atualização automática desativada.
- **Atualizações no app.** A partir da 0.1.29, os apps de desktop instalados ativam por padrão Configurações → Geral → Baixar atualizações automaticamente. As novas versões são baixadas em segundo plano e oferecem Reiniciar e atualizar quando ficam prontas. A instalação exige o seu clique e nenhuma tarefa em execução; desative a opção para baixar manualmente. Quem usa a 0.1.28 ou anterior precisa instalar manualmente a 0.1.29 ou posterior uma vez. Implantações via Docker e a partir do código-fonte continuam sendo atualizadas manualmente. A partir da 0.1.30, a primeira inicialização após uma atualização mostra o que mudou, o botão de atualização ao lado da conta na barra lateral baixa a atualização e permite reiniciar para instalá-la quando estiver pronta, e o registro de alterações está sempre em Configurações → Sobre.
- **Claro, escuro ou igual ao sistema.** Seis personagens de bot, e os olhos deles seguem o ponteiro.
- **Bandeja e inicialização automática.** Feche a janela para escondê-la na bandeja do sistema; a inicialização automática está disponível no macOS e no Windows.

<p align="center">
  <img src="docs/assets/features/characters-eyes.gif" alt="Seis personagens do AnyModelBot lado a lado; os olhos deles seguem o ponteiro enquanto ele passa por cima deles" width="100%">
</p>

> [!NOTE]
> Os recursos dependem do modelo que você escolher, do seu sistema operacional e das permissões que você conceder. O uso do computador exige uma sessão de desktop, e no macOS ele está em Beta. As requisições aos modelos vão para o provedor que você escolher (diretamente com sua própria chave de API oficial; caso contrário, pelo Modelflare); veja [Como funciona e privacidade](#-como-funciona-e-privacidade).

# 🆚 AnyModelBot vs. Grok Bot, OpenAI dots e Claude Duet

No segundo semestre de 2026, o [Grok Bot](https://x.ai/bot) da xAI, o [dots](https://openai.com/index/introducing-dots/) da OpenAI e o Claude Duet da Anthropic foram lançados um após o outro. Eles também trabalham por você em segundo plano e consultam você quando a decisão é sua. O AnyModelBot faz o mesmo tipo de trabalho de outra forma: é de código aberto, roda no seu próprio dispositivo e funciona com uma grande variedade de modelos.

| | AnyModelBot | Grok Bot | OpenAI dots | Claude Duet |
| :--- | :--- | :--- | :--- | :--- |
| Código aberto | ✅ MIT | — | — | — |
| Onde roda | No seu próprio computador ou servidor | Computador na nuvem da xAI | Computador na nuvem da OpenAI | Nuvem da Anthropic |
| Modelos | GPT, Claude, Gemini, Grok e outros (via Modelflare ou APIs oficiais) | Principalmente os modelos Grok da xAI | Modelos da OpenAI | Claude (Opus 5.5) |
| Custo | App grátis, modelos cobrados por token | Assinatura | Assinatura ChatGPT Pro / Business Premium | Assinatura Claude Pro / Max |
| Onde você acessa | App de desktop (Windows, macOS, Linux), Docker, WeChat, Feishu, Telegram, Slack, Discord | App de desktop, iPhone | ChatGPT, Slack, Teams | iOS, Android, claude.ai |
| Disponibilidade | Pode ser baixado agora | Beta | Mercados selecionados | Prévia de pesquisa, lista de espera nos EUA |

O AnyModelBot também trabalha em segundo plano: uma tarefa que você delegar pode terminar em segundo plano e enviar o resultado para o seu app de chat, e tudo o que precisa da sua aprovação ou resposta aparece em “Precisa de você” na barra lateral. Cada passo que um bot dá fica visível, e qualquer coisa fora do espaço de trabalho pergunta antes.

> [!NOTE]
> As informações sobre os outros produtos vêm de reportagens públicas até outubro de 2026 e podem ter mudado; consulte as informações oficiais de cada fornecedor. Grok Bot, dots e Claude Duet são produtos e marcas comerciais da xAI, da OpenAI e da Anthropic, respectivamente. O AnyModelBot não tem vínculo com essas empresas.

# 🔐 Como funciona e privacidade

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/data-flow-dark.svg">
  <img src="docs/assets/diagrams/data-flow-light.svg" alt="Fluxo de dados: conversas, memória, arquivos e chaves ficam no seu dispositivo; as requisições aos modelos passam pelo Modelflare até o provedor do modelo; as mensagens dos canais de chat passam por essas plataformas, e os bots leem e gravam nas contas do Notion e do Feishu que você autorizar" width="100%">
</picture>

| Fica no seu dispositivo | Sai do seu dispositivo |
| :--- | :--- |
| Conversas e sessões (banco de dados SQLite local) | Os prompts, arquivos e resultados de ferramentas de que um modelo precisa para responder, enviados ao provedor que você escolheu (diretamente com sua própria chave de API oficial; caso contrário, pelo Modelflare) |
| Memória (arquivos Markdown) | Capturas de tela, quando você pede a um bot que olhe a sua tela (uso do computador) |
| Arquivos no espaço de trabalho de cada bot | Mensagens que você troca pelos canais de chat, que passam por essas plataformas |
| Sua chave de API e seus tokens de login | Seu login no Modelflare, que acontece em modelflare.dev |
| Conectar apps | Depois que você conecta apps (Feishu, Notion, GitHub etc.) ou adiciona um conector MCP personalizado, os bots leem e gravam o conteúdo deles, e o que leem também entra nas requisições aos modelos |

O Modelflare mantém logs das requisições; a [Central de Confiança](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) dele explica o que é guardado e por quanto tempo. Não afirmamos que seus dados estão livres de qualquer risco: tudo o que você envia a um modelo sai do seu dispositivo. O inventário completo está em [docs/privacy_pt.md](./docs/privacy_pt.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <img src="docs/assets/diagrams/architecture-light.svg" alt="Arquitetura: o shell Electron, a linha de comando ou o Docker iniciam um backend em Node.js e TypeScript com interface Preact, SQLite, o runtime de agentes DSH e os adaptadores de canais, que chamam o gateway magpie incluído, que por sua vez chama o Modelflare" width="100%">
</picture>

| Camada | Tecnologia |
| :--- | :--- |
| Interface | Preact + htm, sem etapa de build |
| Backend | Node.js 22.13+, TypeScript, `node:sqlite` |
| Shell de desktop | Electron, com ícone na bandeja do sistema |
| Gateway de modelos | [magpie](https://github.com/yetone/magpie) (Go, MIT), incluído e iniciado pelo app |
| Runtime de agentes | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT), executado como processo separado |
| Uso do computador | [Cua Driver](https://github.com/trycua/cua), incluído |
| Canais | Feishu (conexão persistente + cartões em streaming), WeChat (iLink), Telegram (long polling), Slack (Socket Mode), Discord (Gateway) |
| Conectar apps | Conectores integrados: Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva; MCP personalizado: Streamable HTTP (compatível com SSE), comandos locais |
| Testes e CI | Vitest, GitHub Actions |

# 📝 Roadmap

Direções que estamos explorando. Não são promessas, e a ordem não é um cronograma. Para saber o que mudou em cada versão, veja o [registro de alterações](./CHANGELOG_pt.md).

- [x] **Tarefas agendadas**: permitir que um bot execute trabalhos em horários definidos (lançado como regras, acima).
- [x] **Conversas em grupo no app**: crie um grupo no app e converse com vários bots ao mesmo tempo.
- [ ] **Conversas em grupo nos canais de chat**: hoje os canais de chat atendem conversas individuais.
- [x] **Interface multilíngue**: o app está disponível em chinês simplificado, inglês, japonês, coreano, russo, espanhol e português (Brasil); troque o idioma nas Configurações.
- [ ] **Uso do computador no macOS**: validar o modo direto em mais máquinas reais e tirá-lo do Beta.
- [ ] **E-mail, calendário e gatilhos de eventos**: conectar contas de e-mail e calendário e permitir que as regras sejam executadas no momento em que algo acontece (uma mensagem de determinada pessoa, uma reunião prestes a começar), e não só em horários definidos. Execuções disparadas por conteúdo externo recebem permissões mais restritas, para que um texto escrito por outra pessoa não possa dar ordens ao seu bot.
- [ ] **Hospedagem sempre ativa, backup e migração**: as regras não rodam enquanto o computador está desligado. Permitir que qualquer pessoa implante no próprio servidor com um clique, leve para lá seus chats, memória e contas, e faça backup e restauração.
- [ ] **Adicionar seus próprios servidores MCP**: hoje você só pode usar as ferramentas e contas integradas. Abrir essa possibilidade permite que você mesmo conecte serviços como GitHub e Linear.
- [ ] **Bots trabalhando juntos**: permitir que um bot passe trabalho para outro, por exemplo redigir e revisar com modelos diferentes, com os custos contabilizados separadamente.
- [ ] **Transcrição de mensagens de voz**: hoje os bots não conseguem ouvir mensagens de voz do Telegram, e o WeChat depende da transcrição da própria plataforma.
- [ ] **Um app de celular independente**: hoje você acessa seus bots pelo WeChat, Feishu, Telegram, Slack ou Discord.

Tem outra ideia? Abra uma [issue](https://github.com/modelflare-ai/AnyModelBot/issues) ou inicie uma [discussão](https://github.com/modelflare-ai/AnyModelBot/discussions). Os itens que assumimos são acompanhados com o rótulo [`roadmap`](https://github.com/modelflare-ai/AnyModelBot/labels/roadmap).

# 🤝 Como contribuir

Relatos de bugs, correções, documentação e ideias são todos bem-vindos.

1. Primeiro, confira as [issues](https://github.com/modelflare-ai/AnyModelBot/issues) e as [discussões](https://github.com/modelflare-ai/AnyModelBot/discussions) existentes. Issues com o rótulo [`good first issue`](https://github.com/modelflare-ai/AnyModelBot/labels/good%20first%20issue) são um bom ponto de partida.
2. Faça um fork do repositório e crie um branch a partir do `master`.
3. Rode localmente e faça sua alteração:

   ```bash
   npm install
   npm run setup          # baixa e compila o gateway incluído
   npm run electron:dev   # app de desktop em modo de desenvolvimento
   npm run typecheck && npm test
   ```

4. Abra um pull request para o `master` e descreva o que mudou e por quê. Para qualquer coisa maior que uma pequena correção, abra uma issue antes para combinarmos a abordagem.

Leia o [guia de contribuição](./CONTRIBUTING_pt.md) completo. Para relatar um problema de segurança, siga a [política de segurança](./SECURITY_pt.md) em vez de abrir uma issue pública.

# 🔗 Projetos relacionados

- [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme): o gateway de APIs de IA por trás dos modelos do AnyModelBot.
- [magpie](https://github.com/yetone/magpie): o gateway em Go incluído no app (MIT).
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): o runtime de agentes (MIT).
- [Cua](https://github.com/trycua/cua): o driver de uso do computador.
- [kimi-computer-use](https://github.com/songkeys/kimi-computer-use): a ponte de uso do computador no macOS.
- [openclaw-weixin](https://github.com/Tencent/openclaw-weixin): a implementação do canal do WeChat que portamos (MIT).
- [DS Bot](https://github.com/Fei2411/DS-Bot): a referência de design do nosso gestor de memória e contexto (Apache-2.0).

Licenças e avisos completos: [THIRD_PARTY_NOTICES_pt.md](./THIRD_PARTY_NOTICES_pt.md).

# 💬 Comunidade

- **Perguntas e ideias:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Bugs e pedidos de recursos:** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues)
- **E-mail:** [support@anymodel.bot](mailto:support@anymodel.bot)
- **Novidades do Modelflare:** [@modelflare_dev no X](https://x.com/modelflare_dev)

# 🚀 Colaboradores

<a href="https://github.com/modelflare-ai/AnyModelBot/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=modelflare-ai/AnyModelBot" alt="Colaboradores do AnyModelBot" />
</a>

# ⭐️ Histórico de estrelas

<a href="https://www.star-history.com/#modelflare-ai/AnyModelBot&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" />
    <img alt="Gráfico do histórico de estrelas do AnyModelBot" src="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" width="100%" />
  </picture>
</a>

# 📜 Licença

O AnyModelBot é distribuído sob a [Licença MIT](./LICENSE). Os softwares de terceiros incluídos mantêm suas próprias licenças; veja [THIRD_PARTY_NOTICES_pt.md](./THIRD_PARTY_NOTICES_pt.md) e a pasta [`LICENSES/`](./LICENSES).

<!-- link & badge references -->
[release-shield]: https://img.shields.io/github/v/release/modelflare-ai/AnyModelBot?include_prereleases&label=release&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIzIiB5PSI5IiB3aWR0aD0iOTQiIGhlaWdodD0iODIiIHJ4PSIzNiIgZmlsbD0iI2Q3ZmYwMCIvPjxyZWN0IHg9IjI5IiB5PSIzNiIgd2lkdGg9IjEzIiBoZWlnaHQ9IjI4IiByeD0iNi41IiBmaWxsPSIjMTYxYTAwIi8+PHJlY3QgeD0iNTgiIHk9IjM2IiB3aWR0aD0iMTMiIGhlaWdodD0iMjgiIHJ4PSI2LjUiIGZpbGw9IiMxNjFhMDAiLz48L3N2Zz4=&style=flat-square&labelColor=161a00&color=d7ff00
[downloads-shield]: https://img.shields.io/github/downloads/modelflare-ai/AnyModelBot/total?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[stars-shield]: https://img.shields.io/github/stars/modelflare-ai/AnyModelBot?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[license-shield]: https://img.shields.io/github/license/modelflare-ai/AnyModelBot?logo=opensourceinitiative&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[ci-shield]: https://img.shields.io/github/actions/workflow/status/modelflare-ai/AnyModelBot/ci.yml?branch=master&label=CI&logo=githubactions&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[platform-shield]: https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Docker-d7ff00?style=flat-square&labelColor=161a00
[pricing-shield]: https://img.shields.io/badge/pricing-pay--as--you--go-d7ff00?style=flat-square&labelColor=161a00
[modelflare-shield]: https://img.shields.io/badge/Modelflare-modelflare.dev-d7ff00?style=flat-square&labelColor=161a00
[x-shield]: https://img.shields.io/badge/X-@modelflare__dev-d7ff00?style=flat-square&labelColor=161a00&logo=x&logoColor=d7ff00
[win-badge]: https://img.shields.io/badge/Windows-161a00?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2Q3ZmYwMCI+PHJlY3QgeD0iMiIgeT0iMyIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48cmVjdCB4PSIxMi41IiB5PSIzIiB3aWR0aD0iOS41IiBoZWlnaHQ9IjguNSIvPjxyZWN0IHg9IjIiIHk9IjEyLjUiIHdpZHRoPSI5LjUiIGhlaWdodD0iOC41Ii8+PHJlY3QgeD0iMTIuNSIgeT0iMTIuNSIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48L3N2Zz4=
[mac-badge]: https://img.shields.io/badge/macOS-161a00?style=for-the-badge&logo=apple&logoColor=d7ff00
[linux-badge]: https://img.shields.io/badge/Linux-161a00?style=for-the-badge&logo=linux&logoColor=d7ff00

[releases-link]: https://github.com/modelflare-ai/AnyModelBot/releases
[stars-link]: https://github.com/modelflare-ai/AnyModelBot/stargazers
[license-link]: https://github.com/modelflare-ai/AnyModelBot/blob/master/LICENSE
[ci-link]: https://github.com/modelflare-ai/AnyModelBot/actions/workflows/ci.yml
[pricing-link]: https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme
[modelflare-link]: https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme
[x-link]: https://x.com/modelflare_dev
