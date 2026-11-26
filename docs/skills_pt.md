# Importar e gerenciar habilidades

[简体中文](./skills.md) | [繁體中文（台灣）](./skills_zh-TW.md) | [English](./skills_en.md) | [日本語](./skills_ja.md) | [한국어](./skills_ko.md) | [Русский](./skills_ru.md) | [Español](./skills_es.md) | Português (Brasil) | [Türkçe](./skills_tr.md)

A partir do AnyModelBot 0.1.24, você pode adicionar a um bot fluxos de trabalho que já tem, na forma de pacotes de habilidades em ZIP, para tarefas como relatórios semanais, processamento de documentos e pesquisa.

## Importar

1. Abra as configurações do bot de destino, encontre Habilidades e clique em Importar ZIP.
2. Selecione um ZIP local e revise o nome, a descrição e o número de arquivos. Expanda as instruções para lê-las por inteiro.
3. Clique em Adicionar habilidade. O bot pode carregá-la quando uma tarefa relacionada precisar dela.

Cada ZIP contém uma habilidade. O `SKILL.md` pode ficar na raiz do ZIP ou dentro de uma pasta que envolva o conteúdo. Arquivos de apoio, como `scripts/`, `references/` e `assets/`, são preservados. A importação não acessa o GitHub nem executa scripts de instalação automaticamente.

O `SKILL.md` precisa de um frontmatter YAML e de um corpo com as instruções, por exemplo:

```markdown
---
name: weekly-report
description: Escrever relatórios semanais a partir das anotações de trabalho do usuário.
---

Organize o trabalho concluído, os problemas e os planos para a próxima semana e, depois, use o formato pedido pelo usuário.
```

Os nomes usam letras minúsculas do alfabeto inglês, dígitos e hifens simples, com até 64 caracteres. Os arquivos ZIP podem ter até 20 MB, com até 64 MB e 2.000 entradas depois de extraídos. O `SKILL.md` pode ter até 256 KB, e cada bot pode ter até 100 habilidades importadas. Se um ZIP contiver vários arquivos `SKILL.md`, empacote cada habilidade separadamente.

## Instalar pela biblioteca de habilidades ou pelo GitHub

- Na aba Habilidades de Apps e habilidades, você navega pela biblioteca por categoria ou por autor; a seção de habilidades nas configurações do bot também tem “Ver habilidades”. Clique em “Copiar instrução de instalação” e envie para qualquer bot.
- Você também pode enviar ao bot o link do GitHub de uma habilidade (um repositório, uma pasta `/tree/<branch>/<caminho>` ou um arquivo `SKILL.md`) e dizer “instale isto”.
- O bot lê o nome, a descrição, a origem, a licença e o número de arquivos da habilidade e mostra um cartão de confirmação. Nada é gravado até você clicar em Instalar, e a habilidade é instalada só naquele bot. Nos canais de chat, responda com o código do cartão; os cartões do Feishu têm botões. Só o dono pode instalar habilidades.
- As habilidades instaladas mostram a origem “GitHub · repositório” na lista; em Ver aparecem o repositório, o caminho, o branch, o commit instalado e a hora da instalação.

## Importar deste computador (Minha biblioteca de habilidades)

Habilidades já instaladas para outras ferramentas do computador (como Claude Code, Codex, Cursor ou CodeBuddy) podem ser importadas de uma vez para Minha biblioteca de habilidades e depois ativadas nos seus bots.

- Onde: menu do avatar › Minha biblioteca de habilidades › Importar deste computador…, ou configurações do bot › Habilidades › Importar deste computador…. A busca só funciona no app para desktop do computador onde fica a biblioteca; no navegador ou remotamente, continue usando um ZIP ou um link do GitHub.
- Seis locais são verificados automaticamente: `~/.codebuddy/skills/`, `~/.qwenworkcn/skills/`, `~/.agents/skills/`, `~/.claude/skills/`, `~/.cursor/skills/` e `~/.codex/skills/`. Só pastas e nomes de arquivo `SKILL.md` são listados; instruções, memórias e contas não são lidas. Para outros locais (como `~/.workbuddy/skills/`, `.user_skills/` do Doubao ou um projeto), use Escolher pasta…; num projeto só são verificados locais conhecidos como `.claude/skills/`. A pasta pessoal, a raiz de um disco e a pasta de dados de aplicativos nunca são percorridas inteiras.
- No início nada está selecionado. As habilidades só são lidas depois de selecionadas e de você clicar em Próximo. A revisão mostra para cada uma: pronta para importar, já existe (conteúdo idêntico; mantém o estado), mesmo nome com conteúdo diferente (pulada por padrão; Salvar separadamente mantém o nome de invocação e acrescenta um número ao nome exibido) ou incompatível (com o motivo). As que têm scripts aparecem como “Contém scripts; importar não os executa” e as com dependências, “Dependências não verificadas”.
- Ao abrir a partir de um bot, “Usar em {bot} após importar” vem marcado; a partir da biblioteca, elas só entram na biblioteca. No fim você vê quantas foram adicionadas, ativadas, puladas e com falha. Se a ativação falhar (já existe uma habilidade com o mesmo nome ativada ou o bot está cheio), o conteúdo adicionado continua na biblioteca.
- Não são importadas habilidades com possíveis arquivos privados (`.env`, `id_rsa`, `credentials.json`, `memory.md`…), links que apontam para fora do local escolhido, restrições que este app não consegue manter igual (como `allowed-tools` ou `hooks`), variáveis de caminho da plataforma (como `${CLAUDE_PLUGIN_ROOT}`) ou arquivos referenciados que faltam. `disable-model-invocation` e `user-invocable` são mantidos como estão; `allow_implicit_invocation: false` do Codex é gravado como `disable-model-invocation: true`.
- Importar é copiar: a origem não muda nem é sincronizada. Cada habilidade fica uma única vez na biblioteca e cada bot guarda só um interruptor: Adicionar da biblioteca… nas configurações do bot, ou o interruptor, afeta apenas aquele bot. Habilidades ZIP e do GitHub instaladas nos bots e as que você salvou também aparecem na biblioteca.
- Em Minha biblioteca de habilidades, abra uma habilidade para ver o conteúdo e os bots que a usam. Se nenhum bot tiver uma habilidade importada ativada, ⋯ › Remover da biblioteca apaga só a cópia da biblioteca.

## Usar, substituir e excluir

- Uma habilidade vale apenas para o bot ao qual você a adicionou (sobre Minhas habilidades, veja abaixo). Esse bot usa as mesmas habilidades no app e nos canais de chat.
- Na lista, veja as instruções, ative, desative ou exclua habilidades. As alterações esperam até o bot ficar ocioso.
- Depois de importar, o aviso diz quando a habilidade fica pronta (a partir da sua próxima mensagem, quando a tarefa atual terminar ou depois de carregar) e mostra um exemplo **Experimente dizer** com **Inserir na mensagem** (abre o chat deste bot) e **Copiar**. Ele fica até você usar um botão ou fechá-lo.
- Importe de novo uma habilidade com o mesmo nome, revise-a e clique em Substituir habilidade. A substituição preserva o estado ativado ou desativado.
- Excluir uma habilidade remove os arquivos dela e mantém o que já foi gerado no espaço de trabalho.
- Nomes integrados, como `media`, `computer-use` e `amb-app`, e as habilidades fornecidas pelos bots do catálogo não podem ser sobrescritos por pacotes importados.

As habilidades rodam com as permissões que o bot já tem. Uma habilidade que precisa de Python, de outro software ou da conexão de uma conta exige esse ambiente. Habilidades que dependem de ferramentas específicas de outro cliente podem precisar de ajustes. Ter um formato compatível não significa que todas as ferramentas de apoio estejam instaladas.

## Usar numa conversa

- Clique em **+** › **Habilidades e apps**, à esquerda da caixa de mensagem, para ver as habilidades e apps que este bot pode usar agora. Ao escolher uma, "Use {nome} para me ajudar a…" vai para a caixa de mensagem; complete a frase e envie. O bot decide se vai usá-la.
- Nas configurações, cada habilidade mostra **Ativa**, **Ativa a partir da sua próxima mensagem** ou **Carregando** ao lado do nome, com uma linha **Experimente dizer** embaixo. Clique nessa linha para colocar o exemplo na caixa de mensagem deste bot.
- Enquanto o bot usa uma habilidade ou um app, o processo acima da resposta mostra "Usando a habilidade · {nome}" e, para apps, uma linha por ferramenta: "Usando {app} · {ferramenta}" (com o nome de exibição da ferramenta quando o app oferece um). Quando a resposta termina, isso vira uma linha, "Usado: …", que você pode expandir para ver todas as etapas.
- Pergunte ao bot "Quais habilidades você tem?" ou "Quais apps você tem?" e ele lista os que pode usar agora, cada um com um exemplo que você pode enviar.
- Uma habilidade cujo `SKILL.md` define `disable-model-invocation: true` nunca é usada pelo bot por conta própria e não aparece em **Habilidades e apps**. Escreva `/nome-da-habilidade` numa mensagem para usá-la.

## Salvar o que você fez como habilidade

Quando um bot faz algo do jeito certo, você pode salvar como ele fez em Minhas habilidades, usar de novo depois ou agendar.

- Para começar: no menu + da caixa de texto escolha “Salvar como habilidade…”, envie `/skill` ou apenas diga “salvar como habilidade”. Para salvar só uma parte, diga “salve a etapa 3 como habilidade”. Se o bot ainda estiver respondendo, ele espera esta rodada terminar.
- O bot mostra “Montando a habilidade…” e depois um cartão de rascunho: título e nome do arquivo, quando usar, etapas, o que você corrigiu (dá para desmarcar), apps e habilidades usados e “Experimente dizer”. “Editar” abre o próprio arquivo da habilidade, que é verificado de novo ao concluir. Nada é gravado até você clicar em Salvar; o cartão expira em 30 minutos.
- Segredos (chaves de API, tokens, senhas, códigos de verificação, cookies, números de documentos) nunca entram na habilidade e não dá para salvar se você os colocar de volta ao editar. Telefones, e-mails, nomes, nomes de grupos e caminhos de arquivos fora do espaço de trabalho ficam destacados e, por padrão, em “Perguntar a cada vez”: viram marcadores e o bot pergunta antes de cada uso. Escolha “Manter” para gravar o original na habilidade.
- Também dá para salvar uma tarefa não concluída: o rascunho diz onde ela parou e a habilidade fica “Não verificada” até ser concluída com sucesso uma vez.
- Se o título for igual, ou o bot perceber que é a mesma tarefa, o cartão mostra quantas mudanças há e oferece “Atualizar” ou “Salvar como nova”. Ao atualizar, a versão anterior fica guardada e pode ser restaurada em Gerenciar.
- Minhas habilidades é uma lista única guardada só neste computador, com até 100 habilidades, contadas à parte das importadas em cada bot. No início ela fica ativada só no bot que a salvou; para usar em outro bot, ative o interruptor na lista de habilidades dele. Só o dono pode salvar habilidades, e não a partir de um grupo do WeChat ou Feishu.
- Na lista de habilidades, as linhas de Minhas habilidades têm “Ver” e “Gerenciar”. Em Gerenciar você exporta um ZIP (só os arquivos desta habilidade, com um aviso se ela mantém dados pessoais), restaura a versão anterior ou a exclui. Um ZIP exportado pode ser importado em outro computador como habilidade de ZIP local.
- Depois de salvar, “Agendar” faz o bot perguntar o horário e criar uma rotina “Executar uma tarefa” que sempre usa a versão mais recente. Habilidades que precisam controlar o computador, gerar imagens ou vídeos ou iniciar tarefas em segundo plano, e as não verificadas, não podem ser agendadas. Se a habilidade for excluída, desativada para esse bot ou, depois de atualizada ou restaurada, passar a pedir novas respostas, ganhar etapas que as execuções agendadas não fazem ou ficar não verificada, a rotina é pausada e aparece em Precisam de atenção, em Agendado.
- Com mais de 10 habilidades, a lista ganha uma caixa de busca e os filtros “Todas / Minhas habilidades / GitHub / ZIP local / Desativadas”. Os nomes das habilidades na atividade abrem os detalhes delas.

## Armazenamento

Os pacotes extraídos ficam em `skills/<ID do bot>/`, na pasta de dados. As habilidades ativadas são copiadas para `dsh/<ID do bot>/skills/` para o runtime. A importação só envia arquivos para a instância do AnyModelBot que você está usando; em uma implantação em servidor, os arquivos ficam armazenados nesse servidor. Os nomes e as descrições das habilidades ativadas, assim como as instruções ou referências carregadas durante o uso, passam a ser contexto enviado ao modelo selecionado. Veja [Dados e privacidade](./privacy_pt.md).

Minhas habilidades ficam em `my-skills/` no diretório de dados e, na execução, são copiadas para `dsh/<ID do bot>/skills/` de cada bot em que estão ativadas.

Habilidades importadas deste computador ficam em `skill-library/` no diretório de dados e, na execução, são copiadas para `dsh/<ID do bot>/skills/` de cada bot que as tiver ativadas. Ao excluir um bot, as habilidades instaladas nele continuam em Minha biblioteca de habilidades.
