# Registro de alterações

[简体中文](./CHANGELOG.md) | [English](./CHANGELOG_en.md) | [日本語](./CHANGELOG_ja.md) | [한국어](./CHANGELOG_ko.md) | [Русский](./CHANGELOG_ru.md) | [Español](./CHANGELOG_es.md) | Português (Brasil)

Aqui estão as mudanças que você vai notar no app. Para versões mais antigas, veja as [versões no GitHub](https://github.com/modelflare-ai/AnyModelBot/releases).

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
