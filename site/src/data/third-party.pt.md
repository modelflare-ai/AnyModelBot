# Avisos de terceiros

[简体中文](./THIRD_PARTY_NOTICES.md) | [English](./THIRD_PARTY_NOTICES_en.md) | [日本語](./THIRD_PARTY_NOTICES_ja.md) | [한국어](./THIRD_PARTY_NOTICES_ko.md) | [Русский](./THIRD_PARTY_NOTICES_ru.md) | [Español](./THIRD_PARTY_NOTICES_es.md) | Português (Brasil)

O próprio anymodel bot é distribuído sob a licença MIT (veja LICENSE). Os componentes abaixo são distribuídos com este programa ou foram portados para ele, e cada um mantém sua licença original.

Parte do código foi portada ou adaptada de Fei2411/DS-Bot (Apache-2.0); veja a seção “DS Bot” abaixo.

## Heroicons (ícones da interface)

Os ícones da interface são selecionados do Heroicons 2.2.0 Outline e distribuídos como dados de nós SVG em `ui/icons/heroicons.js`. O Heroicons usa a licença MIT, com direitos autorais de Tailwind Labs, Inc. A licença completa está em [ui/icons/LICENSE](./ui/icons/LICENSE). O commit fixado e as somas de verificação estão registrados em `ui/icons/heroicons-source.json`.

https://github.com/tailwindlabs/heroicons/releases/tag/v2.2.0

## magpie (gateway de modelos integrado, distribuído como binário; parte dos estilos da interface foi adaptada dele)

Fonte: https://github.com/yetone/magpie (submódulo vendor/magpie, v0.1.1720)

- Distribuído como binário: o gateway de modelos integrado.
- Adaptado: as cores neutras, os raios de borda, as animações e os estilos de componentes em `ui/design/tokens/semantic.css`,
  `ui/design/components/` (`button.css`, `list.css`, `seg.css`, `popover.css`, `toast.css`) e `ui/css/settings.css`
  (`.list` / `.row`, o controle segmentado `.seg`, o menu pop-up `.pop`, as abas das configurações, o selo “Salvo”) foram adaptados de
  `internal/gui/assets/app.css`. Não usamos o nome magpie, o logotipo do magpie, os logotipos de fornecedores em `assets/icons/`,
  imagens de patrocinadores/parceiros nem capturas de tela do site.

```
MIT License

Copyright (c) 2026 yetone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## openclaw-weixin (canal WeChat iLink; parte do código em src/channels/weixin foi portada deste projeto)

Fonte: https://github.com/Tencent/openclaw-weixin

```
Tencent is pleased to support the open source community by making openclaw-weixin available. 

Copyright (C) 2026 Tencent.  All rights reserved. 

openclaw-weixin is licensed under the MIT.


Terms of the MIT:
--------------------------------------------------------------------
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Dependências npm (tempo de execução)

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0 (veja o LICENSE dentro do pacote)
- ws 8.22.0 — MIT
- yauzl 3.4.0 — MIT
- yaml 2.9.1 — ISC
- electron-updater 6.8.12 — MIT
- @modelcontextprotocol/client 2.2.0 — MIT

As licenças das dependências transitivas acompanham cada pacote em node_modules. O app de desktop também inclui o Electron (MIT) e componentes como o Chromium; as licenças deles estão em LICENSE e LICENSES.chromium.html, na pasta de instalação.

## Runtime de agente DeepSeek Harness (DSH) — MIT

O app de desktop e a imagem Docker incluem os pacotes npm sem modificações `@deepseek-ai/dsh@0.2.1-rc.4` e
`@deepseek-ai/dsh-sdk-client@0.2.1-rc.4` em `dsh/` (`dsh-runtime/` ao executar a partir do código-fonte); eles rodam como um processo filho separado.

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

As dependências transitivas do DSH são distribuídas sem modificações, cada uma com sua licença no diretório do próprio pacote. A maioria é MIT / Apache-2.0 / BSD / ISC;
entre elas também estão `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5` (MPL-2.0; código-fonte no projeto LibreOffice) e
`@img/sharp-libvips-*` (LGPL-3.0-or-later, como bibliotecas dinâmicas que podem ser substituídas separadamente).

`dsh-runtime/plugins/amb-bridge.mjs` (o plugin de aprovações / barreira de leitura) é código original deste projeto (MIT).

As regras de chat (`src/agent/prompts/system.ts`), o segmento do prompt de sistema relido a cada requisição ao modelo (`dsh-runtime/plugins/amb-prompt.mjs`)
e os testes de convenções de prompt e limites de caracteres (`test/prompts.unit.test.ts`) se inspiram no dsh-superagent da DeepSeek
(MIT, Copyright (c) 2026 DeepSeek Harness Team): nos seus princípios de atenção, no segmento do prompt de sistema por requisição e nos seus testes de prompt.
O texto e o código foram reescritos para este projeto; nenhuma parte do código dele foi copiada.

## dsh-superagent (design da fila de saída persistente — MIT)

Fonte: https://github.com/deepseek-ai/dsh-superagent-prototype (um protótipo de pesquisa do DeepSeek Harness Team)

O design de `src/core/outbox.ts` (a fila de saída persistente) foi adaptado de `src/app/outbox.ts` e `src/app/effects.ts` desse projeto:
gravar um recibo antes de enviar, enviar cada id uma única vez, enviar em ordem dentro de uma conversa (uma mensagem que falhou bloqueia as seguintes), `Later` (ainda não pode ser enviada, não conta como falha),
novas tentativas com backoff exponencial e, ao encerrar, guardar as mensagens não enviadas para a próxima inicialização. O código foi reescrito para o armazenamento sqlite e os canais deste projeto, e não copiado.

```
MIT License

Copyright (c) 2026 DeepSeek Harness Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DS Bot (memória de longo prazo, gestor de contexto, configurações do bot — Apache-2.0)

Fonte: https://github.com/Fei2411/DS-Bot

Os itens a seguir foram portados ou adaptados do DS Bot e modificados conforme a Seção 4 da Apache License 2.0 (reescritos em TypeScript, integrados ao armazenamento e aos canais deste projeto, com prompts em chinês):

- src/agent/memory.ts: o formato MEMORY.md + arquivos de tópico das três camadas de memória (equipe / bot / grupo), os limites de tamanho e os padrões de filtragem de segredos (adaptado de ds-bot/src/host/memory.js).
- src/agent/steward.ts, src/agent/manager.ts: o algoritmo de limiares e os prompts de decisão do gestor de contexto (compactar / iniciar um novo segmento + transição) e o prefixo de memória congelado (adaptado de ds-bot/src/host/steward.js e docs/plans/2026-10-09-context-and-memory.md).
- src/agent/settings.ts: as predefinições de permissão por bot e a abordagem das configurações.

NOTICE do DS Bot (trecho com a declaração de direitos autorais):

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

O NOTICE do DS Bot informa que o formato de memória em Markdown (uma entrada por linha, metadados [key: value], um índice MEMORY.md com links para os arquivos de tópico) vem do AgentMemoryRepo (MIT), e que as notas de transição e as ideias sobre quando compactar se baseiam em OpenAI Codex, OpenCode, goose, pi, Gemini CLI, Hermes Agent e outros projetos (nenhuma parte do código deles foi copiada).

O texto completo da Apache License 2.0 está em LICENSES/Apache-2.0.txt (distribuído com o programa) e em https://www.apache.org/licenses/LICENSE-2.0 .

## kimi-computer-use (ponte MCP de uso do computador para macOS — MIT)

Fonte: https://github.com/songkeys/kimi-computer-use (submódulo vendor/kimi-computer-use; o instalador para macOS inclui bin/, skills/, LICENSE e NOTICE)

Este projeto inclui a ponte MCP via stdio desse projeto (bin/computer-use-mcp-bridge.mjs, usada sem alterações) e skills/computer-use/SKILL.md com as ferramentas renomeadas. O kimi-computer-use é um projeto independente e não oficial, que não inclui nem redistribui software da OpenAI, da Kimi ou de outros fornecedores; o uso do computador depende do OpenAI Codex Computer Use e do app ChatGPT/Codex, instalados pelo próprio usuário no macOS 14.4+.

```
MIT License

Copyright (c) 2026 Songkeys

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Cua Driver (driver multiplataforma de uso do computador — MIT)

Fonte: https://github.com/trycua/cua (libs/cua-driver, release cua-driver-rs-v0.37.0)

Os instaladores incluem o executável oficial pré-compilado `cua-driver` de cada plataforma (sem modificações), junto com seu LICENSE e seu THIRD_PARTY_NOTICES.md (em resources/cua-driver/, na pasta de instalação). O script de build scripts/fetch-cua-driver.mjs fixa a versão e verifica o SHA256 de cada arquivo da release. O dsh-runtime/plugins/amb-cua-mcp.mjs deste projeto apenas filtra ferramentas e gera o manifesto na frente do MCP via stdio do driver; nenhuma parte do código dele foi copiada.

**Não incluídos**: quaisquer componentes AGPL, como cua-perception e OmniParser, e conteúdo sob licença FSL, como o Cua Spaces.

```
MIT License

Copyright (c) 2025 Cua AI, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Os avisos de terceiros das dependências do próprio Cua Driver estão no THIRD_PARTY_NOTICES.md que o acompanha.

## yuque-mcp (servidor MCP oficial do Yuque, distribuído como um único arquivo — MIT)

Fonte: https://github.com/yuque/yuque-mcp-server (pacote npm yuque-mcp 1.0.0)

- Distribuído como um único arquivo empacotado (`vendor/yuque-mcp/yuque-mcp.mjs`, gerado por `scripts/vendor-yuque-mcp.mjs`; a única alteração é que a leitura da versão a partir do `package.json` em tempo de execução foi substituída por uma constante). Conectar apps › Yuque o usa para se conectar ao Yuque.
- As dependências empacotadas nesse arquivo e suas licenças estão listadas no `THIRD_PARTY_LICENSES.txt` que o acompanha (`vendor/yuque-mcp/` no repositório, `resources/yuque-mcp/` no app instalado).

```
MIT License

Copyright (c) 2026 cwg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
