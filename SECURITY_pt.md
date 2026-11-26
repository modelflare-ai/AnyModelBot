# Política de segurança

[English / 简体中文](./SECURITY.md) | [繁體中文（台灣）](./SECURITY_zh-TW.md) | [日本語](./SECURITY_ja.md) | [한국어](./SECURITY_ko.md) | [Русский](./SECURITY_ru.md) | [Español](./SECURITY_es.md) | Português (Brasil) | [Türkçe](./SECURITY_tr.md)

## Como relatar uma vulnerabilidade

**Não** abra issues, discussões nem pull requests públicos sobre problemas de segurança.

Relate em particular de uma destas formas:

1. **Relatório privado de vulnerabilidade do GitHub (preferencial):** vá até a aba **Security** do repositório → **Report a vulnerability**.
2. **E-mail:** [support@anymodel.bot](mailto:support@anymodel.bot), com “Security” no assunto.

Inclua:

- A versão do AnyModelBot (Configurações → Sobre), o sistema operacional e a arquitetura, e como você executa o app (desktop / linha de comando / Docker)
- Qual é o problema e o que um invasor poderia fazer com ele
- Passos para reproduzir ou uma prova de conceito
- Logs ou diagnósticos que ajudem (Configurações → Solução de problemas → “Copiar diagnóstico” remove chaves e tokens)

## O que acontece depois

1. Confirmamos que recebemos o seu relatório.
2. Investigamos e mantemos você informado sobre a nossa avaliação.
3. Combinamos com você uma correção e um prazo de divulgação e, em seguida, publicamos uma versão corrigida.
4. Com a sua permissão, damos o crédito a você nas notas da versão.

## Versões com suporte

As correções de segurança entram na versão mais recente. Antes de relatar, confira se o problema ainda existe na [versão mais recente](https://github.com/modelflare-ai/AnyModelBot/releases).

## Escopo

Dentro do escopo: o app AnyModelBot deste repositório (app de desktop, linha de comando, imagem Docker gerada a partir deste repositório) e o console local dele.

Fora do escopo aqui: os serviços do próprio Modelflare (relate-os pela [Central de Confiança do Modelflare](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)), as plataformas WeChat e Feishu e projetos upstream como magpie, DeepSeek Harness e Cua — relate esses casos aos mantenedores deles. Se estiver em dúvida, envie um e-mail para nós e faremos o encaminhamento.
