# Registro de alterações

[简体中文](./CHANGELOG.md) | [English](./CHANGELOG_en.md) | [日本語](./CHANGELOG_ja.md) | [한국어](./CHANGELOG_ko.md) | [Русский](./CHANGELOG_ru.md) | [Español](./CHANGELOG_es.md) | Português (Brasil) | [Türkçe](./CHANGELOG_tr.md)

Aqui estão as mudanças que você vai notar no app. Para versões mais antigas, veja as [versões no GitHub](https://github.com/modelflare-ai/AnyModelBot/releases).

## 0.1.48 - 2026-11-25

### Novidades

- **Importar habilidades deste computador:** no app para desktop, as habilidades já instaladas para outras ferramentas do computador (Claude Code, Codex, Cursor, CodeBuddy e outras) podem ser importadas de uma vez. Seis locais comuns como `~/.claude/skills/` são verificados automaticamente, e Escolher pasta… permite pegar uma pasta de habilidade ou um projeto; só pastas e nomes de arquivo são listados até você selecionar e clicar em Próximo. A revisão explica cada uma: pronta para importar, já existe, mesmo nome com conteúdo diferente (pulada por padrão ou salva separadamente) ou incompatível, com o motivo. Importar nunca executa scripts, e habilidades com possíveis arquivos privados ou limites de invocação que este app não consegue manter igual não são importadas. Ao entrar pelas configurações de um bot, o que for importado já fica ativado nesse bot.
- **Minha biblioteca de habilidades:** o menu do avatar ganhou Minha biblioteca de habilidades, que guarda uma cópia de cada habilidade neste computador, com busca, conteúdo e os bots que a usam. Em configurações do bot › Habilidades há Adicionar da biblioteca…, e cada interruptor afeta só aquele bot. Habilidades instaladas por ZIP ou GitHub e as que você salvou também aparecem na biblioteca, sem importar de novo.

### Melhorias e correções

- **Habilidades compartilhadas avisam quem é afetado:** ao substituir por ZIP ou link do GitHub uma habilidade usada por vários bots, ou ao atualizar uma de Minhas habilidades ativada em vários bots, aparecem os outros bots que recebem a mudança.
- **Excluir um bot não apaga mais as habilidades dele:** as que estavam instaladas continuam em Minha biblioteca de habilidades, prontas para outro bot ou para serem removidas da biblioteca.

## 0.1.47 - 2026-11-23

### Novidades

- **Imagens como referências para gerar imagens:** com a conta do Modelflare conectada, ao adicionar imagens em um chat individual com um bot, aparece ao lado da contagem de anexos o interruptor “Usar como referências para gerar imagens”, desligado por padrão. Ligado, as imagens dessa mensagem viram referências na ordem exibida; o modelo escolhido no canto inferior direito gera a imagem e o resultado volta para o mesmo chat. Só adicionar imagens nunca inicia uma geração paga. Se o modelo atual não puder fazer isso, se os recursos dele ainda não puderem ser verificados ou se as imagens passarem dos limites de quantidade, formato ou tamanho, uma nota acima da caixa de mensagem explica o motivo, e o link “Troque de modelo” abre o seletor de sempre. A confirmação de custo continua igual (sempre, ou quando a estimativa passa de $0.5), e um resultado não confirmado nunca é repetido sozinho. Requer que o Modelflare forneça as informações de recursos do modelo; sem verificação, nada é enviado. Ainda não disponível com chaves de API próprias.
- **Escolher modelos de geração de imagens no seletor:** com a conta conectada, o seletor de modelos do canto inferior direito também lista os modelos de geração de imagens que sua conta pode usar. Escolha um e descreva a imagem que quer; nenhum modelo de chat é usado.

### Melhorias e correções

- **A geração de imagens usa só o modelo escolhido:** com a conta conectada, quando você pede uma imagem a um bot com suas palavras, ele usa só o modelo escolhido no canto inferior direito. Se esse modelo não gera imagens ou os recursos dele não podem ser verificados, o bot avisa e pede para trocar, em vez de usar outro modelo de imagem padrão (a configuração “Modelo de imagem padrão” fica oculta com a conta conectada). Nada muda se você se conecta só com uma chave de API.

## 0.1.46 - 2026-11-22

### Novidades

- **Pasta de trabalho:** no app de desktop, escolha uma pasta acima da caixa de mensagem e o bot trabalha nos arquivos onde eles estão, sem arrastá-los um a um. Com acesso ao espaço de trabalho, o bot pode editar os arquivos dessa pasta sem pedir permissão a cada vez; gravar em qualquer outro lugar continua precisando da sua aprovação. Cada mensagem mantém a pasta escolhida no envio: trocar de pasta enquanto ela está na fila ou aguardando aprovação não a redireciona, e as tarefas em segundo plano iniciadas a partir dela trabalham na mesma pasta. Suas 10 pastas mais recentes ficam a um clique; não é possível escolher a pasta de dados do app, a raiz de um disco nem a sua pasta pessoal em si. O console web mostra a pasta escolhida, mas a escolha ou troca é feita no app de desktop do computador onde o bot roda.
- **Anexos ZIP:** arraste um ZIP (até 50 MiB) para a conversa e envie com imagens e arquivos, ou sozinho. O bot só olha dentro ou extrai depois que você disser o que fazer, no próprio espaço de trabalho por padrão ou na pasta de trabalho se você pedir, e nunca executa nada dele por conta própria. ZIPs criptografados ou divididos, com caminhos inseguros ou que ao extrair passam de 200 MiB ou 2.000 itens são recusados com o motivo. Clique em um ZIP enviado para salvar o arquivo original. Requer o modo agente.

### Melhorias e correções

- **Anexos:** ao arrastar vários arquivos, os que podem ser adicionados entram e os demais aparecem em uma linha com o motivo, em vez de recusar o lote inteiro. Os cartões de arquivo mostram o tipo e mantêm a extensão visível em nomes longos.

## 0.1.45 - 2026-11-22

### Melhorias e correções

- **Sandbox de comandos (Linux):** os comandos que um bot executa agora só rodam dentro do sandbox do bubblewrap. Se o bubblewrap não estiver instalado, ou se o sistema não permitir que ele crie namespaces, o comando é recusado com o motivo e como resolver (instalar o bubblewrap ou liberá-lo), em vez de passar em silêncio para um sandbox que só restringe a escrita e deixa os comandos lerem a pasta de dados do app. Bots com acesso total não são afetados. A imagem oficial do Docker continua permitindo esse sandbox por padrão, porque um contêiner iniciado com as opções padrão não consegue criar os namespaces de que o bubblewrap precisa; adicione `-e AMB_ALLOW_LANDLOCK=0` para desativar.
- **Token de acesso na versão de linha de comando:** ao rodar com `npm start`, o console local agora também precisa de um token de acesso. Iniciado pelo terminal, ele mostra uma vez um link com o token; abra-o no navegador e ele ficará guardado. O token também fica salvo em `ui-token`, na pasta de dados, e o `npm run bot` o lê automaticamente. O app de desktop e o Docker funcionam como antes.

## 0.1.44 - 2026-11-20

### Melhorias e correções

- **Anexos de imagem:** algumas imagens eram recusadas como formato não compatível ao serem arrastadas ou coladas na conversa e agora são aceitas: imagens cuja extensão não corresponde ao formato real (por exemplo, um PNG ou WebP salvo como .jpg), JPEGs de celular com dados extras depois da imagem e fotos com movimento (só o quadro estático é usado), e imagens com extensão .jfif ou .jpe. Quando uma imagem realmente não pode ser adicionada, o app pede para convertê-la em PNG ou JPG, em vez de sugerir Markdown, HTML ou TXT.
- **Segurança da pré-visualização:** ao pré-visualizar uma página web gerada por um bot, os scripts da página não conseguem mais ler o conteúdo de outros arquivos da mesma pasta (o fetch é bloqueado); estilos, scripts, imagens e fontes carregam como antes. Arquivos de dados como JSON não são mais servidos às páginas em pré-visualização: inclua os dados no HTML ou entregue-os como script.
- **Atualizações no app:** no macOS, a janela "AnyModelBot encontrou um problema" não aparece mais durante a instalação depois de clicar em "Reiniciar e atualizar". A correção vale a partir da 0.1.44: a janela ainda pode aparecer uma vez ao atualizar para a 0.1.44 a partir de uma versão anterior, e a atualização termina normalmente.

## 0.1.43 - 2026-11-20

### Novidades

- **Anexos de imagens e arquivos:** cole uma captura de tela ou imagem na conversa, ou arraste imagens e arquivos de texto (Markdown, HTML, TXT, CSV, JSON, código e outros), e envie junto com a mensagem. Também dá para enviar só os anexos. As imagens vão para modelos que conseguem vê-las e o texto completo dos arquivos vai para o modelo; clique em uma miniatura para ampliar. Cada mensagem aceita até 8 anexos, sendo no máximo 4 imagens, de até 10 MiB cada. Se o modelo atual não aceitar imagens, o app avisa. PDF, documentos do Office, arquivos compactados, áudio e vídeo ainda não são compatíveis.
- **Solicitações e feedback:** "Feedback" agora é "Solicitações e feedback", com três categorias: Casos de uso e ideias, Problemas, e Empresas e parcerias. Cada uma mantém seu próprio rascunho. Os dados de contato só são incluídos se você marcar o consentimento para aquele envio, os registros só se você marcá-los, e dá para ver tudo o que será enviado antes de enviar. Descobrir ganhou uma seção de cenários para empresas.

### Melhorias e correções

- **Organizar arquivos do computador:** ao pedir a um bot que organize arquivos da Mesa ou de outras pastas, ele não pede mais Acessibilidade ou Gravação de Tela antes; o que estiver fora do espaço de trabalho continua precisando da sua aprovação. Quando uma tarefa realmente precisa operar um app de desktop e falta uma permissão do sistema, aparece na conversa um cartão para ativá-la.
- **Pré-visualização:** com o foco na pré-visualização, Cmd+W / Ctrl+W fecha só a aba atual; a pré-visualização vazia e o menu + listam os arquivos abertos nesta conversa.
- **Habilidades:** "Salvar como habilidade" usa por padrão a última solicitação concluída; as escolhas no cartão de rascunho são mantidas ao editar; o aviso de importação e os cartões não ficam mais em "Carregando".
- **Conversa e tarefas:** a conversa continua no fim quando o conteúdo ou a caixa de mensagem cresce, então notas e cartões não ficam escondidos; a aba Tarefas de um bot lista o trabalho enviado por outros bots e mostra quem enviou.

## 0.1.42 - 2026-11-18

### Novidades

- **Feedback pelo app:** abra a janela de feedback em Feedback no menu da conta, em "Relatar este problema" abaixo de um erro no chat, em Configurações → Solução de problemas ou em Configurações → Sobre. Escolha Problema, Sugestão ou Outro, escreva algumas linhas e envie. A versão e os dados do sistema vão sempre junto e, se você abrir a partir de um erro, esse erro também. O diagnóstico só vai se você marcar a opção, dá para ver o texto completo antes de enviar e conversas e capturas de tela nunca são anexadas. Com login no Modelflare, o feedback vira um chamado de suporte na sua conta: as respostas chegam por e-mail e aparecem na página de chamados do Modelflare, até 3 por dia. Sem login, dá para enviar pelo GitHub ou por e-mail, com os dados já preenchidos.

### Melhorias e correções

- **Links de e-mail:** no app para desktop, links de e-mail no chat abrem no app de e-mail do sistema. Antes, clicar neles não fazia nada.

## 0.1.41 - 2026-11-16

### Novidades

- **Turco:** A interface, o menu da bandeja, as mensagens de sistema dos bots, o site e a documentação estão em turco. Escolha Türkçe na primeira execução ou em Configurações → Geral → Idioma. Se o idioma do sistema for turco, o app usa esse idioma sozinho. O sinal de porcentagem fica antes do número, e os gráficos da pesquisa de ações dos EUA leem essa forma. O vídeo de demonstração da página inicial continua sendo a gravação em inglês.

## 0.1.40 - 2026-11-15

### Novidades

- **Biblioteca de tarefas:** a página Agendado traz 20 tarefas prontas para notícias, trabalho, estudos, dia a dia e finanças. Escolha uma, preencha os campos, selecione o bot e o destino e ative; você também pode pedir pelo chat. As verificações podem ser testadas antes: o resultado aparece só no diálogo de teste e no registro, sem envio aos canais de conversa. O computador e o app precisam estar ligados.
- **Prévia de arquivos:** código com números de linha, destaque de sintaxe e quebra de linha; JSON com formatação e recolhimento; CSV / TSV com tabela, ordenação, busca e escolha de codificação. Markdown aceita imagens, listas de tarefas, sumário e texto-fonte; imagens permitem zoom e movimentação, e HTML alterna entre prévia e código.

### Melhorias e correções

- **Controles e atualização da prévia:** as abas têm ícones por tipo de arquivo e menu de contexto; «+» lista os arquivos entregues na conversa. O painel pode ocupar toda a janela, mantém as preferências de visualização, zoom e quebra de linha e atualiza quando o arquivo muda. No desktop, há Salvar como, Mostrar na pasta e abertura de HTML no navegador.
- **Horários e resultados:** lembretes anuais e avisos alguns dias antes de datas mensais ou anuais. As verificações da biblioteca podem enviar resumos de várias linhas, o custo dos testes conta no mês e os horários cron comuns ficam mais fáceis de ler.
- **Site:** o menu de comunidade abre ao passar o cursor ou receber foco pelo teclado. A seção de recursos da página inicial foi simplificada e o histórico mostra apenas versões publicadas.

## 0.1.39 - 2026-11-15

### Novidades

- **Já dá para saber o que dizer:** ao importar o ZIP de uma habilidade ou atribuir um app a um bot em **Habilidades e apps**, o aviso traz um exemplo **Experimente dizer** com **Inserir na mensagem** e **Copiar**.

### Melhorias e correções

- **Conversas novas começam na hora:** o botão de nova conversa, **Nova conversa** no menu + e digitar /new passam na hora para uma conversa nova e deixam no chat uma linha «Nova conversa iniciada» (que continua no lugar ao recarregar ou reiniciar). Não aparece mais um balão «/new» travado em «Pensando». Onde vocês pararam é resumido em segundo plano numa nota de transição, e a primeira mensagem da conversa nova espera por ela no máximo 8 segundos. Enquanto uma resposta está em andamento, o botão fica cinza. Nos apps de chat, /new também responde na hora.
- **Seu nome e sua foto na área da conta:** depois de entrar na Modelflare, o canto inferior esquerdo e o menu da conta mostram seu apelido e sua foto de perfil (sem apelido, seu nome de usuário e depois seu e-mail; sem foto, a primeira letra do nome), em vez de «Conta Modelflare». Ao reiniciar, o último nome aparece na hora.
- **O processo mostra qual ferramenta foi usada:** cada ferramenta de app ganha a própria linha, como «Usando Notion · Buscar páginas», que no fim da resposta vira «Usado: Notion · Buscar páginas, Notion · Ler página».
- **Uma lista de habilidades mais clara:** **Apps e habilidades › Habilidades** agora mostra cartões. As fotos dos autores começam com as iniciais, aparecem suavemente ao carregar e ficam salvas no seu dispositivo, então aparecem na hora da próxima vez. **GitHub ↗** e **Copiar instrução de instalação** ficam sempre visíveis e não apertam mais o título.
- **Nas configurações dá para ver o que é clicável:** as ações nas Configurações e nas configurações do bot viraram pequenos botões em forma de pílula, com Excluir, Remover e Sair em vermelho. Uma linha com um único «Ver» pode ser clicada inteira, e cada linha tem no máximo dois botões; o resto fica em «⋯».
- **Seletores e pequenos ajustes:** o seletor de **Provedor** na página **Usar sua própria chave de API** e o seletor da Pré-visualização mantêm a seta na borda direita e abrem de qualquer ponto da linha. Uma habilidade instalada que ainda não está ativa agora diz «Ativa a partir da sua próxima mensagem». Nos bots embutidos que você ainda não usou, o «⋯» da barra lateral não cobre mais o ponto de «novo».

## 0.1.38 - 2026-11-15

### Novidades

- **Volta para o modelo real:** se você tinha escolhido um modelo que na verdade era «auto/…» (o padrão geral, o padrão de um bot ou um trocado na conversa), ao iniciar ele muda sozinho para o modelo real correspondente ou, se não houver, volta para o padrão.

### Melhorias e correções

- **Modelos «auto/…» não aparecem mais na lista:** quando um modelo era oferecido por mais de uma fonte (por exemplo, um bot com orçamento próprio ou uma chave de API oficial além da Modelflare), a lista ganhava um item igual ao original que na verdade se chamava «auto/nome-do-modelo», e escolhê-lo fazia as requisições falharem por modelo inexistente. Ele não aparece mais nem é enviado.

## 0.1.37 - 2026-11-15

### Novidades

- **Sobre mim:** a memória da equipe agora se chama Sobre mim e guarda o que todos os seus bots compartilham sobre você. Diga uma vez em qualquer conversa (por exemplo, «Eu sou a Melody») e todos os bots ficam sabendo; uma linha abaixo da resposta permite desfazer. Os bots perguntam antes de salvar endereço, telefone ou e-mail, não revertem as linhas que você editou e não adicionam de novo as que você apagou. Veja e edite em Configurações › Sobre mim, onde qualquer alteração dos últimos 30 dias pode ser desfeita. Sua memória da equipe antiga é movida automaticamente.
- **Bots trocam mensagens:** no app, diga a um bot «passa isso para o Assistente de produto» e ele envia a tarefa, o contexto e os arquivos para esse bot. O outro bot trabalha em segundo plano com o próprio modelo, permissões e orçamento, pede sua aprovação na mesma conversa com o nome dele e responde ao terminar. O primeiro bot confere o resultado, pede para refazer se precisar e depois conta para você. Clique na linha cinza da conversa para ver a troca entre os dois. É preciso entrar na Modelflare, e os dois bots precisam usar modelos da Modelflare.
- **Configurações de colaboração entre bots:** em Configurações › Colaboração entre bots dá para desligar, definir limites de gasto, tempo, pedidos por dia e vezes para refazer, e ver as conversas entre os bots e quanto custaram.

### Melhorias e correções

- **Configurações do bot e aba Memória:** o interruptor «Permitir gravar na memória da equipe» de cada bot virou um atalho para Sobre mim. A aba Memória mostra quantas linhas Sobre mim tem, e dá para ver ou excluir por ali.
- **Revisão da memória:** o que é sobre você não vai mais para a memória de um bot só; quando há conflito, vale o Sobre mim.
- **Em apps de mensagem:** quando um bot anota algo sobre você numa conversa privada no WeChat ou no Feishu, uma linha vem depois da resposta e responder «desfazer» reverte. Endereços, telefones e e-mails só são usados naquela conversa.

## 0.1.36 - 2026-11-15

### Novidades

- **Salve o que você fez como habilidade:** quando um bot faz algo do jeito certo, escolha “Salvar como habilidade…” no menu + da caixa de texto, envie `/skill` ou apenas diga “salvar como habilidade”. O bot monta um cartão com as etapas, o que você corrigiu, os apps e habilidades usados e uma linha de “Experimente dizer”. Salve em Minhas habilidades, ative em outros bots com um interruptor ou agende. Segredos nunca entram na habilidade, e dados pessoais como telefones e e-mails são perguntados a cada uso por padrão. Dá para atualizar uma habilidade, restaurar a versão anterior ou exportá-la como ZIP.
- **Salve habilidades no WeChat e no Feishu:** também dá para começar em conversas privadas do WeChat, Feishu, Telegram, Slack e Discord. Responda “salvar” para manter ou “cancelar” para descartar; não dá para iniciar em grupos.
- **Biblioteca de habilidades:** Conectar apps agora se chama Apps e habilidades, com uma nova aba Habilidades reunindo 155 habilidades de 31 repositórios de código aberto, por categoria e por autor. Copie uma instrução de instalação e envie para qualquer bot, ou envie o link do GitHub de uma habilidade, e confirme o cartão para instalar.
- **Use habilidades e apps na conversa:** + › Habilidades e apps na caixa de texto mostra o que o bot pode usar; escolha um item para inserir “Use {name} para me ajudar a…”. Acima da resposta você vê quais habilidades e apps estão em uso ou foram usados, e os nomes das habilidades abrem os detalhes.

### Melhorias e correções

- **Uma lista de habilidades mais fácil:** as ativadas aparecem primeiro. Com mais de 10, dá para buscar e filtrar por Minhas habilidades, GitHub, ZIP local ou Desativadas. Cada habilidade mostra se está ativa, de onde veio e uma linha de “Experimente dizer”.
- **Modelos durante os créditos de teste:** os modelos usam um nível de modelo adequado aos seus créditos atuais e dizem qual nível costumam recomendar.
- **Permissões para controlar o computador:** quando uma tarefa em segundo plano é barrada por uma permissão, o cartão de permissão aparece, e não sobra nenhuma espera sem cartão.
- **Primeiros passos e avisos:** ao tocar em uma etapa bloqueada da lista, o app explica o motivo. Os avisos aparecem no topo, ao centro da área principal.
- **Rotinas agendadas:** uma rotina aberta é dividida em instrução, frequência, próxima execução e destino. A escolha do bot usa uma lista com busca, e novas rotinas começam com cartões para “Enviar um lembrete” ou “Executar uma tarefa”, que pode seguir uma de Minhas habilidades. Estados vazios e o aviso de fuso horário ficaram mais claros.
- **Atualizações, conta e detalhes:** a entrada de atualização mostra a versão. Se os dados da conta não carregarem, dá para tentar de novo; “Sair” fica em vermelho; conversas em grupo no app mostram a opção de recarga quando o saldo acaba, e os cartões de modelos ganharam borda e os links perderam a seta.

## 0.1.35 - 2026-11-14

### Novidades

- **Barra lateral e ícones mais simples:** ações comuns usam Heroicons. No topo ficam recolher, pesquisar e criar; Agendadas passa para a navegação com texto. O botão ao lado da conta baixa atualizações e permite reiniciar para instalar quando estiverem prontas.
- **Saldo visível nas configurações:** Configurações → Modelos mostra saldo, créditos de Bot e porcentagem restante, com ações para atualizar e recarregar. O anel de saldo e o cartão ao passar o mouse na barra lateral foram removidos.

### Melhorias e correções

- **Prévias estáveis:** endereço e seleção de recursos usam controles compartilhados. Trocar de aba no painel direito preserva a largura, inclusive após ajuste manual. Corrigido o botão de expandir a barra lateral após recolhê-la.
- **Erros mais claros:** falhas na reserva de cota são classificadas como saldo insuficiente, mesmo com prefixos na mensagem. As ações de recuperação correspondem ao provedor, e a barra lateral não exibe erros brutos.
- **Permissões do computador mais claras:** uma permissão ausente usa título no singular, e reabrir o app vira a ação principal quando necessário. Rascunhos de conversas e formulários e solicitações pendentes são preservados antes de reabrir.
- **Correções de regras:** mudar o interruptor ou o destino preserva a opção de desfazer. O proprietário gerencia regras entre conversas e membros de grupos são isolados por identidade. A frequência considera os próximos 30 dias, com sugestões a cada três horas ou diariamente.
- **Orientações e textos consistentes:** a memória inicial dos modelos e revisões automáticas não concluem mais a etapa de lembrar do usuário. Exemplos, mensagens de desfazer, formulários e orientações de ativação foram alinhados em sete idiomas.

## 0.1.34 - 2026-11-14

### Novidades

- **Diagnóstico desde o início:** antes de solicitar o bloqueio de instância única, o aplicativo grava um `startup-<time>-<PID>.log` separado com a versão do sistema, a pasta real de dados, o resultado do bloqueio e as etapas de inicialização. Se não puder gravar nessa pasta, tenta a pasta temporária do sistema.
- **Opção de diagnóstico:** iniciar com `--diagnose-startup` mostra a localização do log quando o bloqueio não é obtido, ajudando a investigar encerramentos sem janela.

### Melhorias e correções

- Se houver uma segunda inicialização antes de o serviço da interface estar pronto, o pedido de exibir a janela aguarda o fim da inicialização, evitando sua criação prematura.
- Cada inicialização tem um log próprio; a instância principal mantém os vinte mais recentes. Uma segunda inicialização não rotaciona o `app.log` normal do aplicativo em execução.
- A atualização melhora o diagnóstico de [#71](https://github.com/modelflare-ai/AnyModelBot/issues/71), mas a causa do encerramento imediato no Win11 Insider Build 26300 ainda não foi confirmada. Se `ELECTRON_RUN_AS_NODE` selecionar o modo Node, o código do aplicativo não será executado; essa variável precisa ser verificada primeiro. No Windows, a pasta padrão de logs é `%APPDATA%\anymodel bot\data\logs`, com um espaço no nome.

## 0.1.33 - 2026-11-14

### Novidades

- **Regras reunidas em Agendado:** a nova página lista as regras de todos os bots e destaca as que precisam de atenção. Cartões da conversa, Tarefas e Agendado compartilham os mesmos controles. Crie regras antes da primeira conversa e mantenha-as desativadas. Alterações feitas pela conversa podem ser desfeitas; uma criação desfeita pode ser restaurada por dez minutos.
- **Recuperação de execuções e resumos de grupos:** regras de calendário recuperam uma única execução recente dentro do prazo de até doze horas, mostrando o horário original. Regras por intervalo não são recuperadas. Há agendamento mensal, três próximas execuções, fusos e estimativas de custo. Resumos de um grupo do aplicativo preservam a data original mesmo quando atrasados.
- **Dez modelos de bots:** escolha um papel para escrever, trabalhar ou estudar, confira a persona, a memória e as regras e compare modelos adequados. As regras começam desativadas e pedem destino e grupo de origem quando necessário.
- **Prévia de recursos no painel direito:** abra arquivos e sites de conversas, grupos e espaços de trabalho sem sair do chat. Compatível com Markdown, texto e código, PDF, imagens e HTML, com download e abertura externa.
- **Espaços de trabalho adaptados ao painel:** a navegação de projetos dos bots oficiais se recolhe em larguras menores. Expanda o espaço e volte à conversa mantendo o estado da edição.
- **Continuar após conceder permissões no macOS:** um cartão substitui os erros repetidos. O aplicativo verifica as permissões automaticamente e, quando possível, retoma as etapas pendentes na conversa original, preservando rascunhos. Se houver outra mensagem ou uma espera superior a trinta minutos, é preciso clicar em Continuar.

### Melhorias e correções

- Melhorias no retorno do login do Modelflare, nos nomes e avatares das contas e na orientação inicial. Listas de aplicativos conectados, pesquisa e mensagens de erro estão mais claras.
- Melhorias no layout do canvas do Film Studio e nos dados dos gráficos do US Stock Research. PPT Master e Company Research também adotam o novo espaço de trabalho.
- Os resultados identificam a regra de origem e respeitam a preferência de notificações. Uma opção impede a suspensão antes da execução quando conectado à energia; não desperta um computador já suspenso ou fechado.

## 0.1.32 - 2026-11-11

### Novidades

- **Espanhol e português (Brasil):** O app ganhou dois novos idiomas de interface. Escolha um em Configurações → Geral → Idioma; se o idioma do seu sistema for espanhol ou português, o app passa a usá-lo automaticamente. A interface, o menu da bandeja do sistema, as mensagens de sistema dos seus bots e as Novidades estão traduzidos.
- **Bots oficiais em espanhol e português:** PPT Master, Estúdio de cinema, Pesquisa de empresas e Ações dos EUA têm nome, descrição, sugestões iniciais, interface do espaço de trabalho e exemplos em espanhol e português.

### Melhorias e correções

- Os gráficos de Ações dos EUA entendem números com vírgula decimal (como 12,5%), e as variações dos indicadores principais seguem o formato numérico do idioma da interface.

## 0.1.31 - 2026-11-11

### Novidades

- **Conectar apps:** O menu do avatar no canto inferior esquerdo tem um novo item, Conectar apps. Conecte os apps que você usa e seus bots poderão ler e gravar o conteúdo deles. Conecte uma vez e todos os bots podem usar por padrão; você pode restringir por bot e por ferramenta em Apps, nas configurações de cada bot.
- **Apps integrados:** GitHub, Notion, Linear, Atlassian (Jira e Confluence) e Canva se conectam em um ou dois passos.
- **Apps integrados para a China:** Feishu (ler e gravar documentos na nuvem, ler mensagens de conversas em grupo), Tencent Docs, DingTalk, Amap e Yuque. A interface em chinês mostra esses apps primeiro.
- **Conectores personalizados (MCP):** Adicione-os em Meus MCPs, na página Apps. Cole uma URL, um JSON de mcpServers, um comando `claude mcp add` ou um comando de inicialização local, e ele é reconhecido; você também pode preencher o formulário ou editar o JSON. Servidores remotos e comandos locais funcionam, com login, cabeçalhos, parâmetros de consulta ou uma URL exclusiva para autenticação, até 20 conectores.
- **Pergunta antes de alterar seus dados:** Ferramentas somente leitura rodam na hora. Por padrão, as gravações pedem sua confirmação no chat antes, e você pode escolher Sempre permitir esta ferramenta, o que pode ser revogado depois nas configurações do bot. Exclusões e qualquer envio para outras pessoas sempre perguntam. Bots somente leitura não podem gravar.
- **Corrija uma conexão pelo chat:** Quando uma tarefa precisa de um app que não está conectado, ou quando um login expirou ou uma chave parou de funcionar, aparece um cartão no chat. Clique nele para conectar ou corrigir, e o bot continua a tarefa.
- **Painel direito:** O painel de informações agora é uma fileira de abas: Visão geral, Tarefas e Memória. Os bots oficiais acrescentam uma aba Espaço de trabalho com a própria interface, e a área principal é sempre o chat.
- **Seções da barra lateral:** Organize bots, conversas em grupo e bots oficiais em seções criadas por você. As seções podem ser adicionadas, renomeadas, excluídas e arrastadas para mudar a ordem.
- **Bots oficiais com visual próprio:** PPT Master, Estúdio de cinema, Pesquisa de empresas e Ações dos EUA ganham cada um seu próprio avatar e uma nova capa. Os bots cujo avatar você não mudou são atualizados automaticamente.

### Melhorias e correções

- Configurações › Conexões agora se chama Canais de chat e só reúne contas de apps de chat. Suas contas do Notion existentes foram movidas para Conectar apps e não precisam ser autorizadas de novo.
- As contas de mensagens do Feishu existentes também foram movidas para o cartão do Feishu em Conectar apps, sem nova autorização; autorize de novo para também ler e gravar documentos na nuvem.
- Criar e atualizar páginas do Notion agora pede confirmação antes, seguindo a regra acima.
- Tokens, chaves e URLs exclusivas dos apps são armazenados em um arquivo separado, fora do banco de dados, e ficam mascarados na interface e nos logs.
- O macOS não exibe mais o pedido de acesso ao chaveiro: o login do Modelflare é protegido por permissões de arquivo, como as outras credenciais.
- Quando o login ou a conexão com o Modelflare falha, a mensagem informa o motivo real de rede.
- Você pode arrastar a janela pelo espaço vazio da página Descobrir.
- O guia de uma nova conversa em grupo agora tem três dicas curtas e duas ou três sugestões iniciais; clique em uma sugestão para colocá-la no campo de mensagem.
- As configurações de modelo na página Novo bot seguem o visual do grupo Modelo nas configurações do bot, e o botão Criar tem a mesma largura do formulário.
- A nota abaixo de Feedback no menu do avatar foi removida.

## 0.1.30 - 2026-11-10

### Novidades

- **Créditos de Bot:** Contas com créditos de Bot do Modelflare veem um anel e a porcentagem restante no canto inferior esquerdo. Clique nele para ver seus créditos de Bot, o saldo da conta e o link Recarregar. Os créditos de Bot só podem ser usados no AnyModelBot, e as requisições feitas com chaves emitidas pelo app usam esses créditos primeiro. Os números são atualizados quando você abre o cartão e depois que cada mensagem é processada. Contas sem créditos de Bot veem o mesmo canto de antes.
- **$1 em créditos de Bot para contas novas:** A página de login e a página de chave de API agora mencionam o crédito de cadastro. As assinaturas do Modelflare adicionam créditos de Bot equivalentes a 10% do plano, como também explica o cartão dos créditos de Bot.
- **Novidades:** Depois de uma atualização, a primeira inicialização mostra o que mudou, e você pode rolar para baixo para ver todas as versões. Clicar no aviso de nova versão na barra lateral mostra primeiro as notas da nova versão, para você decidir antes de baixar ou reiniciar. O registro de alterações está sempre disponível em Configurações → Sobre.
- **Bots oficiais como espaços de trabalho no estilo desktop:** Pesquisa de empresas, PPT Master, Estúdio de cinema e Ações dos EUA mostram seus trabalhos em uma lista à esquerda e o conteúdo à direita. Novo abre um formulário guiado curto. A barra superior alterna entre Espaço de trabalho e Chat, onde você vê a conversa completa. Ações dos EUA mostra os números principais em gráficos, o Estúdio de cinema tem um storyboard com faixas de imagem, vídeo e áudio, e o PPT Master permite folhear as prévias.
- **Escolha de modelo nos bots com interface própria:** O campo de mensagem funciona como em um chat comum, com o seletor de modelos, o menu + e os comandos de barra.
- **Chats recentes na pesquisa:** Antes de você digitar, a janela de pesquisa lista os chats recentes agrupados em Hoje, Ontem, 7 dias anteriores e Mais antigas.

### Melhorias e correções

- Login do WeChat por QR code: quando ele pede o código mostrado no celular, o código é verificado na hora, em vez de depois de cerca de meio minuto. Se o código estiver errado, o app avisa, e muitos códigos errados fazem aparecer um novo QR code.
- O menu da conta tem a mesma largura da área da conta, e passar o mouse escurece só o avatar. A navegação das configurações ocupa toda a barra lateral, com a área da conta fixa na parte inferior.
- As sugestões iniciais nos bots com interface própria formam uma fileira de chips de uma linha; passe o mouse para ler uma sugestão longa por inteiro.

## 0.1.29 - 2026-11-09

### Novidades

- **Download automático de atualizações, ativado por padrão:** Os apps de desktop instalados baixam as novas versões em segundo plano e depois oferecem Reiniciar e atualizar na barra lateral e em Configurações → Sobre. Desative os downloads automáticos em Configurações → Geral para baixar manualmente.
- A instalação exige o seu clique e espera até que não haja conversas ativas nem tarefas em segundo plano. Um encerramento normal do app não instala atualizações automaticamente.
- Quem usa a 0.1.28 ou anterior precisa instalar esta versão manualmente uma vez antes de usar as atualizações pelo app. Funciona no macOS, no Windows e no AppImage para Linux; implantações via Docker e a partir do código-fonte continuam sendo atualizadas manualmente.
- **De volta ao app depois de entrar:** Depois que você aprova no navegador, a página espera até o app estar realmente conectado antes de dizer que você entrou e, então, leva você de volta ao AnyModelBot. Se algo falhar, ela explica o motivo. A página de chave de API também permite entrar com uma conta Modelflare.
- **Um modelo escolhido no seu primeiro login:** Se você ainda não tiver um modelo padrão, o app escolhe um modelo de baixo custo que suporta ferramentas (DeepSeek primeiro), para que o crédito de teste cubra algumas tarefas típicas. Se nenhum servir, ele explica o motivo e deixa você escolher.
- **Permissões do uso do computador no macOS pedidas só quando necessário:** Na primeira vez que um bot precisar clicar, digitar ou olhar a tela sem a permissão de Acessibilidade ou de Gravação de Tela, aquele turno para e o chat informa qual permissão está faltando, com botões para solicitá-la, abrir a página correspondente dos Ajustes do Sistema e verificar de novo. Se for preciso reabrir o app, os rascunhos não enviados são mantidos.
- **Capas no Descobrir:** Os bots oficiais agora têm cenas ilustradas de capa que acompanham o tema claro ou escuro, e os bots em destaque aparecem como cartões grandes.

### Melhorias e correções

- Mensagens de erro mais claras: saldo baixo, credenciais expiradas, modelos indisponíveis, limites de requisições e falhas de rede têm cada um sua própria explicação e uma ação correspondente, como Recarregar ou trocar de modelo. O erro original fica em Detalhes do erro e pode ser copiado com os segredos removidos. O mesmo erro não aparece mais duas vezes, a barra lateral mostra só “Falhou: motivo” e Enviar de novo avisa que a tarefa inteira será executada desde o início. O bot Pesquisa de empresas recolhe os erros de tarefa da mesma forma.
- A área da conta no canto inferior esquerdo sempre mostra o saldo e um link Recarregar, e o saldo baixo é sinalizado ali, em vez de em um aviso separado no app. O menu dela tem feedback, verificar atualizações e sair; sair com tarefas em execução pede confirmação antes. Com sua própria chave de API, você pode entrar no Modelflare por ali e manter suas chaves e configurações.
- Lista de primeiros passos: “Conecte o app de chat que você usa” deixa você escolher um canal e abre as configurações dele, e só conta quando ele está realmente conectado. “Diga olá” exige uma resposta de verdade. Depois que você diz “lembre-se de …”, a lista é atualizada em segundos. As orientações não aparecem mais enquanto você tem um rascunho ou uma tarefa em execução, e a lista se recolhe quando tudo está concluído.
- Depois que você substitui uma chave ou troca a origem dos modelos, o app lembra você de conferir os modelos dos bots existentes. Na configuração inicial, esse lembrete não aparece.
- Salvar as configurações do bot várias vezes seguidas mostra um único “Salvo”. Bots novos mantêm as configurações de modelo recolhidas, mostrando o padrão herdado, e não escolhem mais em silêncio o primeiro modelo da lista. Ao criar um grupo com vários bots, o app explica como ele funciona, com exemplos de prompts baseados nos membros.
- Clicar em Descobrir durante uma pesquisa leva você de volta ao Descobrir.
- Os bots com interface própria (Pesquisa de empresas, PPT Master, Estúdio de cinema, Ações dos EUA) agora usam o mesmo campo de mensagem dos chats comuns. As sugestões iniciais formam uma fileira de cartões, então as longas não são mais cortadas. A resposta mais recente é renderizada em Markdown, respostas longas podem ser expandidas e você pode abrir a conversa completa.
- Uma interface mais limpa: menos linhas divisórias e bordas, campos de entrada preenchidos e linhas fixas de Precisa de você e Descobrir na barra lateral, com um ponto azul em vez de um número (o número continua na dica e para leitores de tela).
- Bordas mais limpas nos avatares dos bots: a franja clara em volta dos avatares em fundos escuros sumiu, e os avatares pequenos agora usam imagens já redimensionadas para o tamanho deles, então as bordas ficam mais suaves.
- Os instaladores para macOS passam por verificação da assinatura Developer ID e da notarização da Apple antes do lançamento e não são publicados se qualquer uma das verificações falhar.

## 0.1.28 - 2026-11-08

### Novidades

- **Bots oficiais incluídos no app:** Pesquisa de empresas, PPT Master, Estúdio de cinema e Ações dos EUA incluem no instalador suas interfaces, exemplos, personas e habilidades. A primeira visualização e a instalação não exigem baixar pacotes de bots. As chamadas aos modelos e a pesquisa online ainda precisam de conexão com a internet.

### Melhorias e correções

- Corrigimos o conteúdo cortado dos bots do catálogo e a falta de rolagem. O campo de mensagem não cobre mais o conteúdo, e as atualizações preservam os projetos e dados existentes.
- Os builds de lançamento reutilizam os dados de checksum incluídos no Electron para reduzir timeouts de rede ao buscar arquivos de checksum, mantendo a verificação completa de hash.
- Os builds para macOS no GitHub, tanto para Intel quanto para Apple silicon, agora recorrem ao TCP para os serviços da Apple, contornando quedas conhecidas de conexão HTTP/3. Assinatura, carimbos de data/hora e notarização continuam obrigatórios.

## 0.1.27 - 2026-11-08

### Novidades

- **Bots oficiais incluídos no app:** Pesquisa de empresas, PPT Master, Estúdio de cinema e Ações dos EUA incluem no instalador suas interfaces, exemplos, personas e habilidades. A primeira visualização e a instalação não exigem baixar pacotes de bots. As chamadas aos modelos e a pesquisa online ainda precisam de conexão com a internet.

### Melhorias e correções

- Corrigimos o conteúdo cortado dos bots do catálogo e a falta de rolagem. O campo de mensagem não cobre mais o conteúdo, e as atualizações preservam os projetos e dados existentes.
- Os builds de lançamento reutilizam os dados de checksum incluídos no Electron para reduzir timeouts de rede ao buscar arquivos de checksum, mantendo a verificação completa de hash.
- Os builds para Mac Intel no GitHub agora recorrem ao TCP para os serviços da Apple, contornando quedas conhecidas de conexão HTTP/3. Assinatura, carimbos de data/hora e notarização continuam obrigatórios.

## 0.1.26 - 2026-11-08

### Novidades

- **Bots oficiais incluídos no app:** Pesquisa de empresas, PPT Master, Estúdio de cinema e Ações dos EUA incluem no instalador suas interfaces, exemplos, personas e habilidades. A primeira visualização e a instalação não exigem baixar pacotes de bots. As chamadas aos modelos e a pesquisa online ainda precisam de conexão com a internet.

### Melhorias e correções

- Corrigimos o conteúdo cortado dos bots do catálogo e a falta de rolagem. O campo de mensagem não cobre mais o conteúdo, e as atualizações preservam os projetos e dados existentes.
- Os builds de lançamento reutilizam os dados de checksum incluídos no Electron para reduzir timeouts de rede ao buscar arquivos de checksum, mantendo a verificação completa de hash.

## 0.1.25 - 2026-11-08

### Novidades

- **Bots oficiais incluídos no app:** Pesquisa de empresas, PPT Master, Estúdio de cinema e Ações dos EUA incluem no instalador suas interfaces, exemplos, personas e habilidades. A primeira visualização e a instalação não baixam mais pacotes de bots; as atualizações vêm com as versões do app. As chamadas aos modelos e a pesquisa online ainda precisam de conexão com a internet.

### Melhorias e correções

- Corrigimos o conteúdo dos bots do catálogo, que ficava cortado em uma faixa estreita no topo e deixava uma grande área em branco sem rolagem. Agora o conteúdo ocupa o espaço disponível, e o campo de mensagem não o cobre mais.
- As atualizações do app preservam os projetos e dados existentes dos bots e só passam para a interface atualizada depois que ela fica pronta, evitando uma tela em branco.

## 0.1.24 - 2026-11-07

### Novidades

- **Importe habilidades de um ZIP:** Em Configurações do bot → Habilidades, importe um ZIP que contenha `SKILL.md`, visualize o nome e a descrição e depois adicione. Veja, ative, desative ou exclua habilidades, e confirme a substituição ao importar de novo o mesmo nome. Scripts, referências e recursos são preservados.
- **Pesquise o histórico de conversas:** Pesquise pela barra lateral as mensagens armazenadas neste dispositivo, filtre por bot, conversa, canal ou data e vá direto à mensagem original. `Ctrl/Cmd+Shift+F` abre a pesquisa global; `Ctrl/Cmd+F` pesquisa no chat atual, incluindo o histórico que ainda não foi carregado. A pesquisa não faz chamadas a modelos.
- As habilidades são gerenciadas separadamente para cada bot, e as alterações são aplicadas quando o bot está ocioso. A substituição preserva o estado de ativação, a exclusão mantém o que já foi gerado no espaço de trabalho, e pacotes importados não podem sobrescrever habilidades integradas nem as dos bots do catálogo.

## 0.1.23 - 2026-11-06

### Novidades

- Adicionamos o bot do catálogo Estúdio de cinema, para vídeos curtos, séries em episódios, bibliotecas de recursos, storyboards, canvas, narração, legendas e renderização local. As regras criativas e o mecanismo de composição foram portados do PRINTFILM (MIT).
- Os bots do catálogo podem pré-visualizar áudio/vídeo e guardar tomadas de mídia. IDs de geração persistentes permitem que um trabalho interrompido recupere a tarefa original sem reenvio automático.
- Os downloads de bots no Descobrir voltaram a funcionar. Atualize para a 0.1.23 para usar a nova chave de assinatura do catálogo.

## 0.1.22 - 2026-11-04

### Novidades

- **Use suas próprias chaves de API oficiais:** Você não precisa mais de uma conta. Na primeira execução, clique em Usar sua própria chave de API ou vá em Configurações → Modelos e insira uma chave da OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Kimi, GLM, Qwen, MiniMax ou Mistral. As requisições aos modelos vão direto ao provedor, quem cobra é o provedor e a chave fica neste dispositivo. A geração de imagens e vídeos continua disponível só pelo Modelflare.
- **Keenable para pesquisa na web:** Escolha-o em Configurações → Rede e acesso e insira uma chave.

### Melhorias e correções

- A aba Modelflare nas Configurações agora se chama Modelos, e você pode entrar no Modelflare por ali se ainda não tiver entrado.
- Pesquisa de empresas, Ações dos EUA e PPT Master agora suportam japonês, coreano e russo.

### Privacidade

- Usando só chaves de API oficiais e sem login, o app não lê os dados da conta nem o catálogo de preços do Modelflare. O gateway integrado lê o catálogo público de modelos em models.dev, e essa requisição não leva chaves nem conteúdo de conversas.

## 0.1.21 - 2026-11-03

### Novidades

- **Configuração de canais mais fácil:** As Conexões nas Configurações foram refeitas. Cada app mostra como conectar, então é só seguir os passos para escanear um código ou inserir um token. Se ainda estiver aguardando uma primeira mensagem para concluir a vinculação, ele avisa. Você também pode adicionar mais contas do mesmo app.

### Melhorias e correções

- **Exclusão de bots mais clara:** A confirmação agora informa qual bot vai responder nos canais de chat daquele bot depois disso. Se for o seu último bot, ela avisa que essas mensagens não terão resposta.
- **Remoção de bots do Descobrir:** Uma caixa de seleção na mesma confirmação permite manter os dados do bot.
- **Visual mais limpo:** O fundo da janela não tem mais brilho, as ações usam cores neutras e os tamanhos de fonte não usam mais meio pixel, então o texto fica mais nítido no Windows.
- **Alerta de saldo:** Quando o saldo fica baixo, a barra lateral apenas avisa. Selecione seu avatar para ver o valor.
- **O vidro fosco segue o sistema:** A opção foi removida, e o app agora segue a configuração de reduzir transparência do sistema.
- Enquanto você cria um bot, a barra lateral mostra o avatar e o nome dele conforme você digita, e não pisca mais para outro bot ao terminar.
- Os menus suspensos agora acompanham a página durante a rolagem, e o layout do Descobrir foi refinado.

## 0.1.20 - 2026-11-03

### Novidades

- **Descobrir:** A barra lateral agora tem Descobrir, com bots prontos, cada um com sua própria interface. Ao abrir um deles, você vê um exemplo, e ele só é instalado quando você envia a primeira mensagem. Remova quando quiser.
- **Pesquisa de empresas:** Informe o nome de uma empresa e ele pesquisa finanças, notícias, setor e negócios, depois escreve um relatório com links das fontes para os fatos principais. Pode exportar um PDF se o Python estiver instalado.
- **Ações dos EUA:** Escreve relatórios de análise a partir dos documentos protocolados na SEC, com cada número rastreável.
- **PPT Master:** Transforma documentos ou temas em apresentações PPTX editáveis e também pode criar templates ou editar apresentações que você já tem. Precisa do Python.
- **12 avatares de especialistas:** O seletor de avatares agora tem personagens de 12 áreas, incluindo direito, saúde, finanças, programação e design.

### Privacidade

- Na inicialização e a cada 6 horas, o app lê o catálogo de bots em anymodel.bot e baixa o pacote de um bot quando você o abre ou usa. Essas requisições só fazem download; seus dados não são enviados. Para desativar o catálogo, defina a variável de ambiente `AMB_CATALOG=off`.

## 0.1.19 - 2026-11-03

### Mudanças importantes

- **Agora é preciso entrar:** Colar uma chave de API não é mais suportado; todos entram com uma conta Modelflare. Depois de atualizar, qualquer chave que você tenha inserido antes é removida deste dispositivo e o app pede que você entre. Seus bots e conversas continuam funcionando depois disso.
- **O login agora funciona no Docker e em implantações remotas:** Entre pelo navegador em qualquer dispositivo e depois cole no app o link da barra de endereços. Durante a configuração pela linha de comando, digite `remote`.

### Novidades

- **Esforço de raciocínio:** Escolha Automático, Baixo, Médio ou Alto. Níveis mais altos pensam mais e respondem mais devagar. No Automático, o modelo decide, e os modelos que não permitem ajuste não são afetados.
- **Mais detalhes ao testar um modelo:** A Solução de problemas agora mostra separadamente os resultados do gateway integrado e do endpoint direto, com código de status, tempo gasto e o erro original.

### Melhorias e correções

- Se o endpoint da lista de modelos não responder, o app para de esperar depois de 30 segundos, então “Testar modelo” não fica mais carregando para sempre.
- Atualizamos a página de parceiros, a página inicial e a página de download do site.

## 0.1.18 - 2026-11-03

### Novidades

- Esta versão inclui suporte completo a cinco idiomas, seleção manual do domínio de API e testes de latência, lembretes de atualização, diagnóstico de proxy local e as atualizações do site, da página de download e da página de parceiros. Veja a seção 0.1.17 abaixo para os detalhes dos recursos.

### Correções

- Corrigimos uma verificação da documentação que identificava incorretamente o conteúdo do roadmap em checkouts do Windows com finais de linha CRLF. Testes de regressão agora cobrem LF, CRLF e CR. Esta correção não muda o comportamento do app.

## 0.1.17 - 2026-11-03

### Novidades

- **Cinco idiomas:** Japonês, coreano e russo se juntam ao chinês simplificado e ao inglês em todo o app, na bandeja do sistema, nas mensagens do sistema, nos pedidos de autorização, no site e na documentação. Troque o idioma durante a configuração inicial, nas Configurações ou pela paleta de comandos.
- **Domínios de API e testes de latência:** Escolha manualmente `modelflare.dev`, `origin.modelflare.dev` ou `cf.modelflare.dev` e compare os tempos de resposta a partir do dispositivo em que o app roda. Os testes não enviam chave de API, não fazem chamadas a modelos e nunca trocam de domínio automaticamente.
- **Lembretes de atualização:** A barra lateral e a página Sobre mostram as atualizações disponíveis. Abra a página de download ou dispense o lembrete daquela versão.
- **Página de parceiros no site:** Saiba mais sobre parcerias e preencha um formulário de inscrição. Sem um endpoint de envio, o formulário deixa claro que usa o e-mail, em vez de afirmar que a inscrição foi enviada.

### Melhorias e correções

- Os arquivos de tradução estão organizados por módulo. As verificações de lançamento validam conteúdo ausente, placeholders, plurais e links da documentação. Melhoramos os plurais em russo, os valores e as datas localizados, os métodos de entrada em japonês e coreano e as quebras de linha no celular.
- Os erros de autorização do Feishu e do Notion seguem o idioma atual. Conexões recusadas a um proxy local agora trazem orientações práticas, mantendo o erro original.
- Refinamos os efeitos de céu do site, a página de download e os layouts para celular, com imagens de compartilhamento localizadas, anotações de idioma para mecanismos de busca e páginas 404.

## 0.1.16 - 2026-11-02

### Novidades

- **Conversas em grupo:** Com dois ou mais bots, clique em ＋ na barra lateral para criar uma conversa em grupo e falar com vários bots ao mesmo tempo. Responde quem você mencionar com @; sem @, continua o bot que respondeu por último. Os bots também podem mencionar outro membro com @ para passar a vez. Cada bot mantém seu próprio modelo, espaço de trabalho e memória, e os custos são contabilizados por bot.

### Alterações

- **O saldo não atrapalha:** O canto inferior esquerdo agora mostra só seu avatar, seu nome e o botão de configurações. Clique no avatar para ver o saldo e recarregar. Você continua recebendo um lembrete na barra lateral quando o saldo fica abaixo do nível de alerta.

## 0.1.15 - 2026-11-02

### Novidades

- **Contas compartilhadas por todos os bots:** Adicione contas de chat e do Notion uma única vez em Configurações › Conexões, e todos os bots poderão usá-las. Cada serviço pode ter várias contas, cada uma com seu próprio apelido.
- **Troque de bot pelo chat:** Envie `/bot` em um app de chat para ver seus bots e `/bot name` uma vez para trocar. Aquele chat fica com o novo bot, então você não precisa repetir isso a cada mensagem. Cada bot também conhece os outros, então pode responder quando você perguntar.
- **Telegram, Slack e Discord:** Cole um token para conectar. Não é preciso endereço público, e imagens e arquivos funcionam nos dois sentidos.
- **Notion:** Conecte com autorização em um clique ou com um token. Os bots podem pesquisar, ler, criar e editar páginas e consultar bancos de dados. Eles não podem excluir páginas.
- **Leitura de mensagens do Feishu:** Autorize com um QR code e depois peça a qualquer bot para “verificar meu segundo Feishu”. Ele lê conversas e pesquisa mensagens em seu nome, somente leitura.
- **Adicione o Feishu escaneando:** Ao adicionar uma conta de chat do Feishu, escaneie um QR code para criar o app em vez de inserir um App ID e um Secret.

### Melhorias

- **A pesquisa na web não precisa mais de uma chave da DeepSeek:** Ela é grátis por padrão, e você pode trocar para Tavily, Exa, Bocha, Zhipu ou seu próprio SearXNG.
- **Personagens separados dos papéis:** Um avatar só define a aparência do bot, e escolher um template não o altera.

### Alterações

- A configuração dos canais de chat saiu do painel de informações de cada bot e foi para Configurações › Conexões. As contas existentes são migradas automaticamente, sem novo login, e o mesmo bot continua respondendo por padrão.
- Proprietários e listas de permitidos agora pertencem à conta, então qualquer pessoa permitida nela pode falar com qualquer bot. Excluir um bot não afeta mais as contas.
