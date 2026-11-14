# Avisos de terceros

[简体中文](./THIRD_PARTY_NOTICES.md) | [English](./THIRD_PARTY_NOTICES_en.md) | [日本語](./THIRD_PARTY_NOTICES_ja.md) | [한국어](./THIRD_PARTY_NOTICES_ko.md) | [Русский](./THIRD_PARTY_NOTICES_ru.md) | Español | [Português (Brasil)](./THIRD_PARTY_NOTICES_pt.md)

El propio anymodel bot se publica bajo la licencia MIT (ver LICENSE). Los componentes que se indican a continuación se distribuyen con este programa o se portaron a él, y cada uno conserva su licencia original.

Parte del código se portó o adaptó de Fei2411/DS-Bot (Apache-2.0); consulta la sección “DS Bot” más abajo.

## Heroicons (iconos de la interfaz)

Los iconos de la interfaz se seleccionan de Heroicons 2.2.0 Outline y se distribuyen como datos de nodos SVG en `ui/icons/heroicons.js`. Heroicons usa la licencia MIT, con derechos de autor de Tailwind Labs, Inc. La licencia completa está en [ui/icons/LICENSE](./ui/icons/LICENSE). El commit fijado y las sumas de comprobación se registran en `ui/icons/heroicons-source.json`.

https://github.com/tailwindlabs/heroicons/releases/tag/v2.2.0

## magpie (gateway de modelos integrado, distribuido como binario; parte de los estilos de la interfaz se adaptó de él)

Fuente: https://github.com/yetone/magpie (submódulo vendor/magpie, v0.1.1720)

- Distribuido como binario: el gateway de modelos integrado.
- Adaptado: los colores neutros, los radios de las esquinas, las animaciones y los estilos de componentes de `ui/design/tokens/semantic.css`,
  `ui/design/components/` (`button.css`, `list.css`, `seg.css`, `popover.css`, `toast.css`) y `ui/css/settings.css`
  (`.list` / `.row`, el control segmentado `.seg`, el menú emergente `.pop`, las pestañas de ajustes, la etiqueta “Guardado”) están adaptados de
  `internal/gui/assets/app.css`. No usamos el nombre magpie, el logotipo de magpie, los logotipos de proveedores de `assets/icons/`,
  imágenes de patrocinadores o socios ni capturas de pantalla del sitio web.

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

## openclaw-weixin (canal WeChat iLink; parte del código de src/channels/weixin se portó de este proyecto)

Fuente: https://github.com/Tencent/openclaw-weixin

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

## Dependencias de npm (en tiempo de ejecución)

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0 (ver el LICENSE del paquete)
- ws 8.22.0 — MIT
- yauzl 3.4.0 — MIT
- yaml 2.9.1 — ISC
- electron-updater 6.8.12 — MIT
- @modelcontextprotocol/client 2.2.0 — MIT

Las licencias de las dependencias transitivas se conservan junto a cada paquete en node_modules. La app de escritorio también incluye Electron (MIT) y componentes como Chromium; sus licencias están en LICENSE y LICENSES.chromium.html en la carpeta de instalación.

## Runtime del agente DeepSeek Harness (DSH) — MIT

La app de escritorio y la imagen de Docker incluyen sin modificar los paquetes npm `@deepseek-ai/dsh@0.2.1-rc.4` y
`@deepseek-ai/dsh-sdk-client@0.2.1-rc.4` en `dsh/` (`dsh-runtime/` al ejecutar desde el código fuente); se ejecutan como un proceso hijo independiente.

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

Las dependencias transitivas de DSH se incluyen sin modificar, cada una con su licencia en la carpeta de su paquete. La mayoría son MIT / Apache-2.0 / BSD / ISC;
también se incluyen `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5` (MPL-2.0; código fuente en el proyecto LibreOffice) y
`@img/sharp-libvips-*` (LGPL-3.0-or-later, como bibliotecas dinámicas que se pueden reemplazar por separado).

`dsh-runtime/plugins/amb-bridge.mjs` (el plugin de aprobaciones / restricción de lectura) es código original de este proyecto (MIT).

Las reglas de chat (`src/agent/prompts/system.ts`), el segmento del prompt del sistema que se vuelve a leer en cada solicitud al modelo (`dsh-runtime/plugins/amb-prompt.mjs`)
y las pruebas de convenciones de prompts y los límites de caracteres (`test/prompts.unit.test.ts`) toman ideas de dsh-superagent de DeepSeek
(MIT, Copyright (c) 2026 DeepSeek Harness Team): sus principios de atención, el segmento del prompt del sistema por solicitud y sus pruebas de prompts.
El texto y el código se reescribieron para este proyecto; no se copió nada de su código.

## dsh-superagent (diseño de la cola de salida persistente — MIT)

Fuente: https://github.com/deepseek-ai/dsh-superagent-prototype (un prototipo de investigación del DeepSeek Harness Team)

El diseño de `src/core/outbox.ts` (la cola de salida persistente) está adaptado de sus `src/app/outbox.ts` y `src/app/effects.ts`:
escribir un recibo antes de enviar, enviar cada ID una sola vez, enviar en orden dentro de una conversación de modo que un mensaje fallido bloquee a los que vienen detrás, `Later` (todavía no se puede enviar, no cuenta como fallo),
reintentos con espera exponencial y, al apagar, conservar los mensajes sin enviar para el siguiente inicio. El código se reescribió para el almacenamiento sqlite y los canales de este proyecto; no se copió.

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

## DS Bot (memoria a largo plazo, gestor de contexto, ajustes de bots — Apache-2.0)

Fuente: https://github.com/Fei2411/DS-Bot

Lo siguiente se portó o adaptó de DS Bot y se modificó según la Sección 4 de la Apache License 2.0 (reescrito en TypeScript, integrado con el almacenamiento y los canales de este proyecto, prompts en chino):

- src/agent/memory.ts: el formato MEMORY.md + archivos de temas de las tres capas de memoria (equipo / bot / grupo), los límites de tamaño y los patrones del filtro de secretos (adaptado de ds-bot/src/host/memory.js).
- src/agent/steward.ts, src/agent/manager.ts: el algoritmo de umbrales del gestor de contexto y los prompts de decisión (compactar / iniciar un nuevo segmento + traspaso), y el prefijo de memoria congelado (adaptado de ds-bot/src/host/steward.js y docs/plans/2026-10-09-context-and-memory.md).
- src/agent/settings.ts: los perfiles de permisos por bot y el enfoque de los ajustes.

NOTICE de DS Bot (extracto de la declaración de copyright):

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

El NOTICE de DS Bot indica que el formato de memoria en Markdown (una entrada por línea, metadatos [key: value], un índice MEMORY.md que enlaza los archivos de temas) proviene de AgentMemoryRepo (MIT), y que las notas de traspaso y las ideas sobre cuándo compactar se inspiran en OpenAI Codex, OpenCode, goose, pi, Gemini CLI, Hermes Agent y otros proyectos (no se copió código de ninguno de ellos).

El texto completo de la Apache License 2.0 está en LICENSES/Apache-2.0.txt (distribuido con el programa) y en https://www.apache.org/licenses/LICENSE-2.0 .

## kimi-computer-use (puente MCP de uso de la computadora para macOS — MIT)

Fuente: https://github.com/songkeys/kimi-computer-use (submódulo vendor/kimi-computer-use; el instalador de macOS incluye bin/, skills/, LICENSE y NOTICE)

Este proyecto incluye su puente MCP por stdio (bin/computer-use-mcp-bridge.mjs, usado tal cual) y skills/computer-use/SKILL.md con las herramientas renombradas. Es un proyecto independiente y no oficial, y no incluye ni redistribuye software de OpenAI, Kimi ni otros proveedores; el uso de la computadora depende de OpenAI Codex Computer Use y de la app ChatGPT/Codex, que el usuario instala por su cuenta en macOS 14.4+.

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

## Cua Driver (driver multiplataforma de uso de la computadora — MIT)

Fuente: https://github.com/trycua/cua (libs/cua-driver, versión cua-driver-rs-v0.37.0)

Los instaladores incluyen el ejecutable oficial precompilado `cua-driver` para cada plataforma (sin modificar), junto con su LICENSE y su THIRD_PARTY_NOTICES.md (en resources/cua-driver/ dentro de la carpeta de instalación). El script de compilación scripts/fetch-cua-driver.mjs fija la versión y verifica el SHA256 de cada archivo comprimido publicado. El archivo dsh-runtime/plugins/amb-cua-mcp.mjs de este proyecto solo filtra herramientas y genera el manifiesto delante de su MCP por stdio; no se copió nada de su código.

**No incluido**: ningún componente AGPL, como cua-perception y OmniParser, ni contenido con licencia FSL, como Cua Spaces.

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

Los avisos de terceros de las propias dependencias de Cua Driver están en el THIRD_PARTY_NOTICES.md que se distribuye con él.

## yuque-mcp (servidor MCP oficial de Yuque, distribuido como un solo archivo — MIT)

Fuente: https://github.com/yuque/yuque-mcp-server (paquete npm yuque-mcp 1.0.0)

- Se distribuye como un único archivo empaquetado (`vendor/yuque-mcp/yuque-mcp.mjs`, generado por `scripts/vendor-yuque-mcp.mjs`; el único cambio es que la lectura de la versión desde `package.json` en tiempo de ejecución se reemplazó por una constante). Conectar apps › Yuque lo usa para conectarse a Yuque.
- Las dependencias empaquetadas en ese archivo y sus licencias se enumeran en el `THIRD_PARTY_LICENSES.txt` que lo acompaña (`vendor/yuque-mcp/` en el repositorio, `resources/yuque-mcp/` en la app instalada).

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
