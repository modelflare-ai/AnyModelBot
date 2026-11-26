# Dados e privacidade

[简体中文](./privacy.md) | [繁體中文（台灣）](./privacy_zh-TW.md) | [English](./privacy_en.md) | [日本語](./privacy_ja.md) | [한국어](./privacy_ko.md) | [Русский](./privacy_ru.md) | [Español](./privacy_es.md) | Português (Brasil) | [Türkçe](./privacy_tr.md)

**Em uma frase:** conversas, memória, arquivos e chaves ficam armazenados no seu dispositivo; o que você envia a um modelo vai para o provedor de modelos que você escolheu, diretamente com sua própria chave de API oficial e, caso contrário, pelo Modelflare. Não afirmamos que seus dados estão livres de qualquer risco — tudo o que é enviado a um modelo sai do seu dispositivo.

Este documento explica o que o AnyModelBot armazena e onde, o que sai do seu dispositivo e como excluir esses dados. Dúvidas: [support@anymodel.bot](mailto:support@anymodel.bot).

## Pasta de dados

| Como você executa | Pasta de dados |
| :--- | :--- |
| Desktop · Windows | `%APPDATA%\anymodel bot\data` |
| Desktop · macOS | `~/Library/Application Support/anymodel bot/data` |
| Desktop · Linux | `~/.config/anymodel bot/data` |
| Linha de comando `npm start` | `./data` (altere com `AMB_DATA_DIR`) |
| Docker | `/data` no contêiner (montado como o volume `amb-data` no exemplo do README) |

## Inventário de dados

| Dados | Onde ficam (dentro da pasta de dados) | Saem do dispositivo? | Para onde vão |
| :--- | :--- | :--- | :--- |
| Conversas e sessões | `anymodel.db` (SQLite) | A parte de que uma resposta precisa | Enviadas como contexto do modelo, pelo Modelflare, ao provedor que você escolheu |
| Habilidades importadas | `skills/<ID do bot>/`; cópias ativadas em `dsh/<ID do bot>/skills/` | Sim: nomes, descrições e o conteúdo carregado durante o uso | Contexto do modelo selecionado; a importação só envia arquivos para a sua instância do AnyModelBot e não acessa o GitHub |
| Índice de pesquisa de conversas | `message_search` e seu índice de texto completo em `anymodel.db` | Não | Pesquisa as mensagens salvas dentro da instância, sem chamadas a modelos |
| Memória | `memory/` (Markdown: `bots/`, `groups/`; Sobre mim: `about-me.json`, com 30 dias de histórico de alterações; `team/` é a memória da equipe de antes da atualização, já movida para Sobre mim e não lida mais) | Quando é usada | Incluída como contexto nas requisições aos modelos; tudo o que parece um segredo é filtrado antes de ser gravado, números de documentos e de cartões bancários nunca são salvos, e endereços, telefones e e-mails só vão para Sobre mim depois que você confirma |
| Arquivos do espaço de trabalho dos bots | `workspaces/<bot>/` (incluindo os arquivos recebidos em `inbox/` e as imagens e os vídeos gerados em `media/`) | Quando um bot os lê e os envia a um modelo | Igual ao item acima |
| Anexos de mensagens | `attachments/` (cópias das imagens que você cola e das imagens e arquivos de texto que arrasta para uma conversa, com nomes aleatórios; as imagens ficam sem EXIF e outros metadados). As não enviadas ficam por até 24 horas e as enviadas por 30 dias; depois são excluídas | Ao enviar a mensagem | As imagens e o texto completo dos arquivos vão com essa mensagem na solicitação ao modelo, para o provedor que você escolheu; excluir a cópia local não desfaz o que já foi enviado |
| Credencial de login do Modelflare | `modelflare-account.json` (modo 600) | Só para modelflare.dev, ao renovar tokens | Modelflare |
| Chave de API | A configuração isolada do gateway em `magpie/config/` | Como autenticação em cada requisição de modelo ao Modelflare | Modelflare |
| Chave de API oficial (se você adicionar uma) | A configuração isolada do gateway em `magpie/config/` | Como autenticação em cada requisição de modelo a esse provedor | Esse provedor de modelos |
| Estado de login e cursor de sincronização do WeChat | Dentro da pasta de dados (`weixin/` e outros) | Ao se comunicar com a API iLink do WeChat | Tencent WeChat |
| App ID / Secret das contas de chat do Feishu | `anymodel.db` | Ao abrir a conexão persistente com a Feishu Open Platform | Feishu |
| Tokens do Telegram, Slack e Discord | `anymodel.db` | Ao se comunicar com essa plataforma | A plataforma que você conectou |
| Lista de permitidos e pedidos de acesso | `anymodel.db`: quem pode usar qual conta de canal e a primeira mensagem enviada por um desconhecido (truncada, para você saber quem é) | Não | — |
| Respostas aguardando envio | Caixa de saída em `anymodel.db`: conteúdo das mensagens não enviadas e o motivo, incluindo mensagens do WeChat retidas até a pessoa escrever de novo (mantidas por até 7 dias; as enviadas são excluídas após 7 dias e as que não puderam ser entregues, após 30) | Quando são enviadas | WeChat / Feishu |
| Tarefas em segundo plano e regras | `anymodel.db` (tarefas, regras e logs de execução, mantidos por 30 dias); pastas de tarefas em `workspaces/<bot>/tasks/`, excluídas após 30 dias sem uso (você é avisado antes em Precisa de você); os arquivos de sessão delas em `dsh/<bot>/sessions/`, excluídos junto com a tarefa | Enquanto são executadas | Como nos chats: contexto nas requisições aos modelos, enviado pelo Modelflare ao provedor que você escolheu |
| Configurações | `config.json` | Não | — |
| Logs | `logs/app.log` (rotacionado por tamanho) | Não, por padrão; “Copiar diagnóstico” é algo que você copia manualmente, com as chaves substituídas por `***`. Só se em Solicitações e feedback, em Relatar um problema, você marcar “Incluir status de execução e logs recentes” e enviar, as últimas 120 linhas (chaves substituídas) vão junto com esse envio | Seu ticket privado no Modelflare (só quando você envia) |
| Credenciais dos apps conectados (só se você os conectar): tokens de login, tokens e chaves colados, URLs exclusivas e os cabeçalhos / parâmetros de consulta / variáveis de ambiente dos conectores MCP personalizados | `app-secrets.json` (permissão 600, fora do banco de dados); mascaradas nos logs, no diagnóstico e na interface | Enviadas a esse serviço como autenticação sempre que um bot lê ou grava; as variáveis de ambiente de um comando local só vão para o programa local que você adicionou | Os apps que você conecta (Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva) ou os servidores MCP personalizados que você adiciona |
| Nomes, endereços, status e listas de ferramentas das conexões | `anymodel.db` (URLs exclusivas e endereços que contêm uma chave são armazenados mascarados) | Não | — |
| Conteúdo que um bot lê dos apps conectados (documentos, mensagens, issues…) | Não é armazenado à parte; quando entra em um chat, é armazenado com esse chat | Sim | Enviado como contexto nas requisições aos modelos, pelo Modelflare, ao provedor que você escolheu |
| Capturas de tela (uso do computador) | Não são mantidas a longo prazo | Sim | Enviadas como parte da requisição ao modelo, pelo Modelflare, a um modelo com visão; nunca são encaminhadas para chats do WeChat ou do Feishu, a menos que você as peça como arquivos |

## Controle de acesso ao console local

- Por padrão, o console escuta em `127.0.0.1:3600` e não pode ser acessado pela sua rede nem pela internet.
- O app de desktop gera um token de acesso aleatório a cada inicialização, para que outros programas locais não possam chamar a API de gerenciamento diretamente.
- A API do console sempre exige um token de acesso, também no endereço de loopback. O app de desktop guarda o token só na memória; a versão de linha de comando e o Docker geram um quando nenhum está configurado e o guardam em `ui-token`, na pasta de dados (Docker: `docker exec amb cat /data/ui-token`). Iniciada pelo terminal, a versão de linha de comando mostra uma vez um link com o token.
- Não exponha a porta 3600 diretamente à internet. Para acesso remoto, coloque-a atrás de uma VPN ou de um proxy reverso com autenticação que você controle.

## Login no Modelflare

- O login usa o fluxo de código de autorização do OIDC com PKCE (RFC 7636), como app nativo conforme a RFC 8252: o AnyModelBot é um cliente público sem segredo de cliente, e o resultado da autorização é entregue em uma porta de loopback temporária.
- Você entra em modelflare.dev; o AnyModelBot nunca vê sua senha do Modelflare.
- Revogue este dispositivo a qualquer momento na seção de apps autorizados (“Authorized apps”) da página do seu perfil no Modelflare. “Sair” no app também revoga a autorização e exclui as chaves emitidas para este dispositivo e para os bots dele.

## Requisições aos modelos e o Modelflare

- As requisições aos modelos saem do gateway magpie incluído para o Modelflare, que as encaminha ao provedor que você escolheu.
- Uma requisição contém o que o modelo precisa para responder: o prompt, o contexto da conversa, a memória em uso, o conteúdo de arquivos, os resultados de ferramentas e, durante o uso do computador, capturas de tela.
- As requisições levam um cabeçalho `X-Modelflare-Skill: anymodel-bot/<version>` para que o Modelflare possa identificar a origem; os links do Modelflare abertos pelo app levam `utm_source=anymodelbot`. Quando o app abre a página de recarga, a URL leva, depois de `#`, o identificador da conta obtido do ID token do login (`#amb_account=…`, que não é um segredo), para que a página do Modelflare possa verificar se o navegador está conectado à mesma conta; o que vem depois de `#` não é enviado a servidores, CDNs nem scripts de análise. O aviso “A configuração das chaves mudou” compara um HMAC da chave calculado localmente com um salt aleatório; nem a chave nem o seu resumo são armazenados ou enviados para isso.
- O Modelflare mantém logs das requisições; veja na [Central de Confiança do Modelflare](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) o que é guardado e por quanto tempo. A forma como cada provedor de modelos trata os dados é regida pelos termos dele.

## Usando suas próprias chaves de API oficiais

- Depois que você insere uma chave oficial da OpenAI, da Anthropic ou de outro provedor na tela de boas-vindas ou em Configurações → Modelos, o gateway integrado envia as requisições aos modelos desse provedor diretamente a ele. Elas não passam pelo Modelflare e não levam o cabeçalho `X-Modelflare-Skill`. Os termos do próprio provedor regem como o conteúdo é guardado.
- Os endereços dos provedores são fixos no app e não podem ser alterados pela interface nem pela API dele, então sua chave não é enviada para nenhum outro lugar. As chaves ficam apenas na configuração isolada do gateway (modo 600), nunca em logs ou argumentos de linha de comando, e a interface mostra só os últimos 4 caracteres.
- Usando só chaves oficiais e sem login, o app não lê os dados da conta nem o catálogo de preços do Modelflare. Quando você insere uma chave, o app a usa para ler a lista de modelos desse provedor uma vez, para verificar a chave, e depois a cada hora, para manter a lista atualizada.
- O gateway integrado lê o catálogo público de modelos em `models.dev` (tamanhos de contexto, preços de referência). Essa requisição só faz download e não leva chaves nem conteúdo de conversas.
- A geração de imagens e vídeos só está disponível pelo Modelflare.

## Telemetria

- A telemetria do driver de uso do computador incluído (Cua Driver) é desligada com `CUA_TELEMETRY_ENABLED=0` e `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`.
- O gateway magpie incluído roda com a atualização automática e a descoberta de contas desativadas, e não lê credenciais de outras ferramentas de IA no seu computador.
- O código do próprio AnyModelBot (`src`, `electron`, `ui`, `scripts`, `dsh-runtime/plugins`) não contém nenhum envio de análises ou telemetria: uma busca por telemetry, analytics, sentry, posthog e mixpanel só encontra as duas variáveis de ambiente do Cua citadas acima.
- Os componentes de terceiros incluídos se comportam como a documentação deles descreve; não damos garantias sobre eles aqui.

## Outras requisições de rede feitas pelo app

Além das requisições aos modelos, o app se conecta à internet para:

- Ler o catálogo de modelos do Modelflare, seu saldo, uso e notificações (dados da sua conta, em modelflare.dev).
- Ao enviar em Solicitações e feedback (casos de uso e ideias, relatar um problema ou empresas e parcerias): o que você escreveu, o contexto ou os dados da empresa que adicionou, a função escolhida, de onde abriu, a versão e os dados do sistema, e o erro e os logs que você escolheu incluir (com as chaves substituídas por `***`) vão para modelflare.dev como um ticket privado na sua conta Modelflare. As respostas chegam por e-mail e aparecem na página de tickets do Modelflare. Antes de enviar você pode revisar tudo o que será enviado; conversas e capturas de tela nunca são anexadas. Dados de contato não são enviados por padrão: só se você abrir “Topa conversar mais?”, marcar “Aceito ser contatado apenas sobre este feedback” e escolher o e-mail da conta ou digitar um e-mail ou ID do WeChat, e só para conversar sobre esse feedback. Ao fechar a janela, entrar ou trocar de conta, a confirmação é pedida de novo. Os rascunhos ficam na pasta de dados deste dispositivo (por conta, só você lê, os bots não, apagados após 7 dias sem uso) e nunca são sincronizados. Sem login no Modelflare, ou com um gateway externo, não dá para criar tickets no app; você pode enviar por e-mail ou no GitHub (público), e essa cópia não leva dados de contato nem da empresa. “Falar com a Modelflare” abre a página de contato comercial sem nada do que você digitou.
- Ler o formato de requisição de um modelo em docs.modelflare.dev ao gerar imagens ou vídeos.
- Canal WeChat: comunicar-se com `ilinkai.weixin.qq.com` e baixar da CDN do WeChat as imagens e os arquivos que você envia.
- Canal Feishu: manter uma conexão persistente com a Feishu Open Platform.
- Canais Telegram, Slack e Discord: depois de conectados, comunicar-se com `api.telegram.org`, `slack.com`, `discord.com` e os servidores de arquivos deles para enviar e receber mensagens e os arquivos que você envia.
- No Windows, com o modo agente ativado e sem um PowerShell 7 funcionando no sistema, baixar o PowerShell 7 do local oficial de distribuição da Microsoft (desative com `AMB_PWSH_AUTO_INSTALL=0`; veja o [guia de desenvolvimento](./development_pt.md)).
- Os apps de desktop instalados verificam atualizações no GitHub após a inicialização e a cada 6 horas e, por padrão, baixam os arquivos de atualização em segundo plano. Você pode desativar os downloads automáticos em Configurações → Geral. As requisições não contêm credenciais da conta nem conteúdo de chats. A instalação exige que você clique em Reiniciar e atualizar, sem tarefas em execução.
- Quando você abre as Novidades de uma versão que ainda não instalou, o app lê o registro de alterações dessa versão no GitHub (`raw.githubusercontent.com`). Isso só acontece quando você abre, sem credenciais da conta nem conteúdo de chats. O registro de alterações das versões instaladas vem com o app e não precisa de rede.
- Somente quando você define explicitamente `AMB_CATALOG_URL` para usar um catálogo remoto de bots o app busca a lista e baixa pacotes sob demanda, verificando assinaturas e hashes, sem enviar seus dados. Por padrão, o catálogo oficial de bots, as interfaces, os dados de exemplo e as habilidades vêm com o app; abri-los e instalá-los não gera esse tipo de requisição de rede.

## Uso do computador e capturas de tela

- Ler a tela gera capturas de tela, que são enviadas como parte da requisição a um modelo com visão.
- Por padrão, as ações do uso do computador são executadas automaticamente. Em Configurações do bot → Uso do computador, você pode mudar para “perguntar antes de ações que alteram a tela”; a leitura da tela continua automática.
- Bots com a predefinição Somente leitura só recebem ferramentas de leitura.

## Canais

- As mensagens que você troca com um bot no WeChat, Feishu, Telegram, Slack ou Discord passam pelos servidores dessas plataformas e estão sujeitas às políticas de privacidade delas.
- Por padrão, só o proprietário e as pessoas que você permitir podem falar com um bot; as mensagens de qualquer outra pessoa não são entregues a um modelo, apenas registradas como pedidos de acesso (veja o [guia de desenvolvimento](./development_pt.md#quem-pode-usar-um-bot)).

## Como excluir seus dados

1. Feche o AnyModelBot (menu da bandeja → Sair).
2. Exclua a pasta de dados indicada na tabela acima. Docker: `docker rm -f amb && docker volume rm amb-data`.
3. Revogue o AnyModelBot na seção de apps autorizados (“Authorized apps”) da página do seu perfil no Modelflare.
4. Se necessário, desative os apps que você criou na Feishu Open Platform (incluindo os criados por escaneamento), desvincule o bot no WeChat, exclua os bots que você criou no Telegram (@BotFather), no Slack e no Discord e, nas configurações de cada app (Notion, Feishu, GitHub etc.), revogue a autorização do AnyModelBot e exclua os tokens e as chaves que você criou.
