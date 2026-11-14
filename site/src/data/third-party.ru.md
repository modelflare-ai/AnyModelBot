# Уведомления о сторонних компонентах

[简体中文](./THIRD_PARTY_NOTICES.md) | [English](./THIRD_PARTY_NOTICES_en.md) | [日本語](./THIRD_PARTY_NOTICES_ja.md) | [한국어](./THIRD_PARTY_NOTICES_ko.md) | Русский | [Español](./THIRD_PARTY_NOTICES_es.md) | [Português (Brasil)](./THIRD_PARTY_NOTICES_pt.md)

Сам anymodel bot распространяется под лицензией MIT, см. LICENSE. Перечисленные ниже компоненты включены в программу или перенесены в неё; каждый сохраняет исходную лицензию.

Часть кода перенесена или адаптирована из Fei2411/DS-Bot (Apache-2.0); см. раздел «DS Bot» ниже.

## Heroicons (значки интерфейса)

Значки интерфейса взяты из Heroicons 2.2.0 Outline и поставляются как данные SVG-узлов в `ui/icons/heroicons.js`. Лицензия MIT, авторские права принадлежат Tailwind Labs, Inc. Полная лицензия находится в [ui/icons/LICENSE](./ui/icons/LICENSE), фиксированный коммит и контрольные суммы исходников — в `ui/icons/heroicons-source.json`.

https://github.com/tailwindlabs/heroicons/releases/tag/v2.2.0

## magpie — встроенный шлюз моделей и источник части стилей интерфейса

Источник: https://github.com/yetone/magpie (подмодуль vendor/magpie, v0.1.1720).

- Поставляется в виде исполняемого файла как встроенный шлюз моделей.
- Нейтральные цвета, скругления, анимации и стили компонентов в `ui/design/tokens/semantic.css`, `ui/design/components/` (`button.css`, `list.css`, `seg.css`, `popover.css`, `toast.css`) и `ui/css/settings.css` адаптированы из `internal/gui/assets/app.css`. Это `.list` / `.row`, сегментированный переключатель `.seg`, всплывающее меню `.pop`, вкладки настроек и индикатор «Сохранено». Имя и логотип magpie, логотипы поставщиков из `assets/icons/`, изображения спонсоров и партнёров и снимки его сайта не используются.

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

## openclaw-weixin — канал WeChat iLink

Часть кода `src/channels/weixin` перенесена из этого проекта.

Источник: https://github.com/Tencent/openclaw-weixin

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

## Зависимости npm времени выполнения

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0, см. LICENSE внутри пакета
- ws 8.22.0 — MIT
- yauzl 3.4.0 — MIT
- yaml 2.9.1 — ISC
- electron-updater 6.8.12 — MIT
- @modelcontextprotocol/client 2.2.0 — MIT

Лицензии транзитивных зависимостей находятся внутри соответствующих пакетов в node_modules. Настольное приложение также включает Electron (MIT), Chromium и другие компоненты; их лицензии находятся в LICENSE и LICENSES.chromium.html в папке установки.

## Среда агента DeepSeek Harness (DSH) — MIT

Настольное приложение и Docker-образ включают неизменённые npm-пакеты `@deepseek-ai/dsh@0.2.1-rc.4` и `@deepseek-ai/dsh-sdk-client@0.2.1-rc.4` в `dsh/` (`dsh-runtime/` при запуске из исходников). Они работают в отдельном дочернем процессе.

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

Транзитивные зависимости DSH поставляются без изменений, со своими лицензиями в каталогах пакетов. Большинство использует MIT / Apache-2.0 / BSD / ISC. Также включены `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5` (MPL-2.0; исходники в проекте LibreOffice) и `@img/sharp-libvips-*` (LGPL-3.0-or-later, отдельно заменяемые динамические библиотеки).

`dsh-runtime/plugins/amb-bridge.mjs` — плагин разрешений и ограничения чтения — оригинальный код этого проекта под MIT.

Правила общения (`src/agent/prompts/system.ts`), перечитываемый при каждом запросе сегмент системной инструкции (`dsh-runtime/plugins/amb-prompt.mjs`), тесты соглашений об инструкциях и ограничения длины (`test/prompts.unit.test.ts`) используют идеи dsh-superagent от DeepSeek (MIT, Copyright (c) 2026 DeepSeek Harness Team): принципы внимания, обновляемый на каждый запрос системный сегмент и тестирование инструкций. Тексты и код написаны заново для этого проекта; исходный код не копировался.

## dsh-superagent — устройство постоянной очереди исходящих сообщений, MIT

Источник: https://github.com/deepseek-ai/dsh-superagent-prototype (исследовательский прототип DeepSeek Harness Team).

Архитектура постоянной исходящей очереди `src/core/outbox.ts` адаптирована из `src/app/outbox.ts` и `src/app/effects.ts`: запись квитанции до отправки, отправка каждого ID один раз, порядок сообщений внутри разговора с блокировкой следующих при ошибке предыдущего, состояние `Later` — пока невозможно отправить, но это не ошибка, — повторные попытки с экспоненциальной задержкой и сохранение неотправленного до следующего запуска. Код переписан под SQLite-хранилище и каналы этого проекта, а не скопирован.

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

## DS Bot — долговременная память, управление контекстом и настройки ботов, Apache-2.0

Источник: https://github.com/Fei2411/DS-Bot

Следующие части перенесены или адаптированы из DS Bot с изменениями по разделу 4 Apache License 2.0: переписаны на TypeScript, подключены к хранилищу и каналам проекта, добавлены инструкции на китайском.

- src/agent/memory.ts: формат MEMORY.md и файлов тем для трёх уровней памяти — команда, бот и группа, — ограничения размера и шаблоны фильтрации секретов. Адаптировано из ds-bot/src/host/memory.js.
- src/agent/steward.ts, src/agent/manager.ts: алгоритм порогов и инструкции выбора действий для управления контекстом — сжатие или новый сегмент с передачей, — а также фиксированный префикс памяти. Адаптировано из ds-bot/src/host/steward.js и docs/plans/2026-10-09-context-and-memory.md.
- src/agent/settings.ts: режимы разрешений каждого бота и подход к настройкам.

Выдержка из NOTICE DS Bot с уведомлением об авторских правах:

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

В NOTICE DS Bot указано, что Markdown-формат памяти — одна запись в строке, метаданные [key: value], индекс MEMORY.md со ссылками на темы — основан на AgentMemoryRepo (MIT). Идеи заметок для передачи и выбора момента сжатия опираются на OpenAI Codex, OpenCode, goose, pi, Gemini CLI, Hermes Agent и другие проекты. Их код не копировался.

Полный текст Apache License 2.0 находится в LICENSES/Apache-2.0.txt, поставляемом с программой, и по адресу https://www.apache.org/licenses/LICENSE-2.0 .

## kimi-computer-use — MCP-мост управления macOS, MIT

Источник: https://github.com/songkeys/kimi-computer-use (подмодуль vendor/kimi-computer-use; установщик macOS включает bin/, skills/, LICENSE и NOTICE).

Проект включает неизменённый stdio MCP-мост bin/computer-use-mcp-bridge.mjs и skills/computer-use/SKILL.md с переименованными инструментами. Это независимый неофициальный проект; он не включает и не распространяет ПО OpenAI, Kimi и других поставщиков. Управление компьютером требует OpenAI Codex Computer Use и приложения ChatGPT/Codex, самостоятельно установленных пользователем на macOS 14.4+.

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

## Cua Driver — кроссплатформенный драйвер управления компьютером, MIT

Источник: https://github.com/trycua/cua (libs/cua-driver, выпуск cua-driver-rs-v0.37.0).

Установщики содержат официальный готовый исполняемый файл `cua-driver` для каждой платформы без изменений, вместе с LICENSE и THIRD_PARTY_NOTICES.md в resources/cua-driver/ папки установки. Скрипт сборки scripts/fetch-cua-driver.mjs фиксирует версию и проверяет SHA256 каждого архива. Наш dsh-runtime/plugins/amb-cua-mcp.mjs лишь фильтрует инструменты и создаёт манифест перед его stdio MCP; исходный код не копировался.

**Не включены:** компоненты под AGPL, в том числе cua-perception и OmniParser, и содержимое под FSL, например Cua Spaces.

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

Уведомления о зависимостях самого Cua Driver находятся в поставляемом с ним THIRD_PARTY_NOTICES.md.

## yuque-mcp (официальный MCP-сервер Yuque, поставляется одним файлом — MIT)

Источник: https://github.com/yuque/yuque-mcp-server (npm-пакет yuque-mcp 1.0.0)

- Поставляется одним собранным файлом (`vendor/yuque-mcp/yuque-mcp.mjs`, создаётся скриптом `scripts/vendor-yuque-mcp.mjs`; единственное изменение — чтение версии из `package.json` во время работы заменено константой). Его использует «Подключить приложения › Yuque» для подключения к Yuque.
- Включённые в этот файл зависимости и их лицензии перечислены в прилагаемом `THIRD_PARTY_LICENSES.txt` (в репозитории — `vendor/yuque-mcp/`, в установленном приложении — `resources/yuque-mcp/`).

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
