# Como contribuir

[简体中文](./CONTRIBUTING.md) | [繁體中文（台灣）](./CONTRIBUTING_zh-TW.md) | [English](./CONTRIBUTING_en.md) | [日本語](./CONTRIBUTING_ja.md) | [한국어](./CONTRIBUTING_ko.md) | [Русский](./CONTRIBUTING_ru.md) | [Español](./CONTRIBUTING_es.md) | Português (Brasil) | [Türkçe](./CONTRIBUTING_tr.md)

Obrigado por ajudar a melhorar o AnyModelBot. Relatos de bugs, correções, documentação e ideias são todos bem-vindos.

## Perguntas e feedback

- **Perguntas, ideias e projetos para mostrar:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Bugs e pedidos de recursos:** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues), usando os modelos de issue
- **Chat com a comunidade:** [Discord](https://discord.gg/umBN6wX3zJ) · [Telegram](https://t.me/+Tx6Payfzxqk2ZGVl)
- **Problemas de segurança:** não abra uma issue pública; relate em particular, como descrito na [política de segurança](./SECURITY_pt.md)
- **Qualquer outro assunto:** envie um e-mail para [support@anymodel.bot](mailto:support@anymodel.bot)

Ao relatar um bug, inclua:

- A versão (Configurações → Sobre), seu sistema operacional e arquitetura (por exemplo, Windows 11 x64, macOS 15 Apple silicon) e como você executa o app (desktop / linha de comando / Docker)
- Os passos para reproduzir, o que você esperava e o que aconteceu
- Diagnóstico: Configurações → Solução de problemas → “Copiar diagnóstico” (chaves de API e tokens são substituídos por `***`). Os logs ficam em `logs/app.log`, dentro da pasta de dados; veja onde ela fica em [docs/privacy_pt.md](./docs/privacy_pt.md#pasta-de-dados)
- O ID do modelo, se o problema envolver um modelo específico

## Ambiente de desenvolvimento

Requer Node.js 22.13+ e Go 1.26.8+ (para compilar o gateway magpie incluído).

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup          # baixa o submódulo vendor/magpie e o compila em build/bin/
```

| Comando | O que faz |
| :--- | :--- |
| `npm start` | Executa pela linha de comando: gateway + bots + console em `http://127.0.0.1:3600/` |
| `npm run dev` | O mesmo, reiniciando quando o código muda |
| `npm run electron:dev` | App de desktop em modo de desenvolvimento |
| `npm run electron:smoke` | Teste de fumaça do app de desktop (usa xvfb-run no Linux sem interface gráfica) |
| `npm run typecheck` | Verificação de tipos do TypeScript |
| `npm test` | Testes unitários + testes de ponta a ponta offline + testes de integração do gateway |
| `npm run test:dsh-bundle` | Teste de integração do DSH real no Electron (execute `prepare:dsh` + `bundle:dsh` antes) |
| `npm run docs:check` | Autoverificação do README |

A estrutura do repositório, o empacotamento e a configuração dos canais estão no [guia de desenvolvimento](./docs/development_pt.md).

## Branches e pull requests

1. Faça um fork do repositório e crie um branch a partir do `master`.
2. Antes de enviar, execute:

   ```bash
   npm run typecheck && npm test
   ```

   Se você alterou o README ou `docs/`, execute também `npm run docs:check`.
3. Abra um pull request para o `master` descrevendo o que mudou, por quê e como você verificou. Inclua capturas de tela para mudanças na interface.
4. Para qualquer coisa maior que uma pequena correção (novos recursos, mudanças de arquitetura, novas dependências), abra primeiro uma issue para combinarmos a abordagem antes que você invista seu tempo.
5. Mantenha uma mudança por PR; siga o estilo de commit existente (`feat(scope): …`, `fix(scope): …`).

## Mudanças na interface

- Use os tokens e componentes de `ui/design` (veja `ui/design/README.md`); nada de cores ou tamanhos de fonte avulsos.
- A cor de destaque da marca é o amarelo-esverdeado fluorescente `#d7ff00`; não introduza azul na interface.
- O console é Preact + htm, sem etapa de build; não adicione um bundler nem dependências de front-end que precisem de compilação.
- Confira os temas claro e escuro.
- Use `t()` para os textos da interface. Adicione as traduções em `ui/locales/<idioma>/` para todos os idiomas do manifesto, incluindo `zh-TW` para chinês tradicional (Taiwan). Execute `npm run i18n:check` antes de enviar as alterações.

## Código e dependências de terceiros

- Ao adicionar uma dependência ou portar ou adaptar código externo, atualize `THIRD_PARTY_NOTICES.md` com a origem, a versão e a licença.
- Não adicione componentes cujas licenças sejam incompatíveis com a distribuição sob MIT, como AGPL, SSPL ou FSL.

## Código de conduta

Seja gentil e atenha-se aos fatos. Respeite todos os participantes e critique ideias, não pessoas; assédio, ataques pessoais e linguagem discriminatória não são aceitos. Os mantenedores podem remover conteúdo que não atenda a essas expectativas. Para relatar uma preocupação, envie um e-mail para [support@anymodel.bot](mailto:support@anymodel.bot).

## Licença

As contribuições que você enviar são distribuídas sob a [Licença MIT](./LICENSE) deste repositório.
