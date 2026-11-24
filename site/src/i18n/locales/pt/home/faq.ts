export default {
  "h2": "Perguntas.",
  "h2dim": "Respostas diretas.",
  "ask": "Tem uma dúvida? Clique para abrir.",
  "more": "Não encontrou? Consulte a documentação",
  "community": "Ou pergunte na comunidade",
  "items": [
    {
      "q": "Como adiciono habilidades a um bot?",
      "a": "São quatro jeitos: copie uma instrução de instalação da biblioteca em Apps e habilidades ou envie ao bot o link do GitHub de uma habilidade e confirme o cartão; importe um ZIP com um SKILL.md (até 20 MB) em configurações do bot → Habilidades → Importar ZIP; no app para desktop, importe em Minha biblioteca de habilidades → Importar deste computador… as habilidades que Claude Code, Codex, Cursor e ferramentas parecidas instalaram neste computador e ative-as nos bots que precisarem; ou, quando um bot faz algo do jeito certo, diga “salvar como habilidade” ou envie /skill e confirme o rascunho para guardar em Minhas habilidades, onde dá para ativar em outros bots, exportar como ZIP ou agendar. Segredos nunca entram numa habilidade; os programas e a conexão necessários dependem de cada habilidade."
    },
    {
      "q": "Como encontro uma conversa antiga?",
      "a": "Pesquise no histórico de conversas pela barra lateral, ou pressione Ctrl/Cmd+Shift+F para a busca global e Ctrl/Cmd+F para a conversa atual. Filtre por bot, conversa, canal ou data e selecione um resultado para ir até a mensagem. A busca abrange só os registros armazenados neste dispositivo e não faz chamadas a modelos."
    },
    {
      "q": "Qual a diferença para o Grok Bot, o OpenAI dots ou o Claude Duet?",
      "a": "Eles também trabalham para você em segundo plano e consultam você quando a decisão é sua. A diferença: o AnyModelBot é de código aberto (MIT) e roda no seu próprio computador ou servidor. Ele funciona com GPT, Claude, Gemini, Grok e outros; o app é grátis e os modelos são cobrados por uso, sem a assinatura de um único fornecedor. O README no GitHub tem uma tabela comparativa completa. Grok Bot, dots e Claude Duet são produtos da xAI, da OpenAI e da Anthropic, respectivamente; o AnyModelBot não tem vínculo com essas empresas."
    },
    {
      "q": "Qual a diferença entre os seis personagens?",
      "a": "Só o nome e a aparência. Nenhum deles tem uma função fixa. O avatar só ajuda a distinguir seus bots de relance. Você escolhe o nome, a persona, o modelo e o espaço de trabalho, e todo bot pode conversar, trabalhar no seu computador e se lembrar das coisas. Os templates do app são só um ponto de partida: dá para mudar cada palavra ou começar do zero."
    },
    {
      "q": "Meus dados são enviados para os servidores de vocês?",
      "a": "Conversas, memória, arquivos e chaves ficam armazenados no seu dispositivo. As solicitações aos modelos vão para o provedor que você escolher: diretamente, se você usar sua própria chave de API oficial, ou, caso contrário, pelo Modelflare, onde a retenção de logs segue o documento “Retenção de dados”. O conteúdo da tela visto durante o uso do computador é enviado ao modelo escolhido."
    },
    {
      "q": "Funciona offline?",
      "a": "Não. Os modelos vêm do Modelflare ou das APIs oficiais dos provedores; modelos locais não são suportados."
    },
    {
      "q": "Posso usar no celular?",
      "a": "Ainda não há um app próprio; converse com ele no Slack, Telegram ou Discord."
    },
    {
      "q": "Uma conta de chat pode falar com vários bots?",
      "a": "Sim. Adicione a conta uma vez em Configurações › Canais de chat e todos os bots passam a compartilhá-la. Cada serviço pode ter várias contas, cada uma com um apelido. Um bot padrão responde às novas conversas; envie /bot e um nome uma vez para trocar, e essa conversa fica com o novo bot. Envie /bot para ver seus bots."
    },
    {
      "q": "Os bots podem trabalhar com meus apps, como Notion ou GitHub?",
      "a": "Sim, depois que você os conectar. Use Apps e habilidades no menu do avatar: GitHub, Notion, Linear, Atlassian e Canva já vêm integrados, e você pode adicionar conectores MCP personalizados. Dá para conectar várias contas do mesmo app e perguntar a qualquer bot sobre elas pelo número ou pelo apelido. Ferramentas somente leitura rodam na hora, gravações pedem sua confirmação antes, e exclusões ou qualquer coisa enviada a outras pessoas sempre pedem confirmação. Bots somente leitura só podem ler."
    },
    {
      "q": "E se eu não tiver uma conta Modelflare?",
      "a": "Na primeira execução, clique em Entrar / Criar conta com Modelflare e cadastre-se no navegador. O app se conecta sozinho quando você volta, sem chave para copiar. Em Docker ou num servidor remoto, cole o link da página que abre depois que você entra. Os três domínios de API estão disponíveis; compare os tempos de resposta e escolha um nas Configurações. Você também pode dispensar a conta: clique em Usar sua própria chave de API e insira uma chave oficial da OpenAI, Anthropic, Google Gemini, DeepSeek ou de outro provedor, e as solicitações aos modelos vão direto para eles."
    },
    {
      "q": "O uso do computador é seguro?",
      "a": "Ele se limita a 24 ações de uma lista de permitidos; funciona automaticamente por padrão, e dá para mudar para pedir confirmação antes de ações que alteram a interface; o conteúdo da tela vai para o modelo; experimente primeiro em uma máquina ou conta dedicada."
    },
    {
      "q": "Como verifico um download?",
      "a": "Cada download mostra um SHA-256; use Get-FileHash no Windows e shasum -a 256 no macOS/Linux. A página Releases do GitHub também inclui um arquivo SHA256SUMS, que você pode verificar de uma vez com sha256sum -c."
    },
    {
      "q": "O bot continua lá depois que eu fecho a janela?",
      "a": "Fechar a janela o mantém na bandeja do sistema (iniciar com o sistema é opcional); ele fica offline quando o computador está desligado ou em suspensão; use Docker para tê-lo sempre ligado."
    },
    {
      "q": "Vocês coletam telemetria?",
      "a": "O que podemos confirmar: a telemetria do driver de uso do computador (Cua) está desligada e a atualização automática do magpie está desativada. Veja o diagrama de fluxo de dados para entender o caminho das solicitações aos modelos. O código tem licença MIT — leia você mesmo."
    }
  ]
};
