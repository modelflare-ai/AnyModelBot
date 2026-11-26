# Üçüncü taraf bildirimleri

[简体中文](./THIRD_PARTY_NOTICES.md) | [繁體中文（台灣）](./THIRD_PARTY_NOTICES_zh-TW.md) | [English](./THIRD_PARTY_NOTICES_en.md) | [日本語](./THIRD_PARTY_NOTICES_ja.md) | [한국어](./THIRD_PARTY_NOTICES_ko.md) | [Русский](./THIRD_PARTY_NOTICES_ru.md) | [Español](./THIRD_PARTY_NOTICES_es.md) | [Português (Brasil)](./THIRD_PARTY_NOTICES_pt.md) | Türkçe

anymodel bot'un kendisi MIT Lisansı altında yayınlanır (LICENSE dosyasına bak). Aşağıdaki bileşenler bu programla birlikte dağıtılır veya programa taşınmıştır ve her biri özgün lisansını korur.

Kodun bir kısmı Fei2411/DS-Bot'tan (Apache-2.0) taşınmış veya uyarlanmıştır; aşağıdaki “DS Bot” bölümüne bak.

## Heroicons (arayüz simgeleri)

Arayüz simgeleri Heroicons 2.2.0 Outline içinden seçilir ve `ui/icons/heroicons.js` içinde SVG düğüm verisi olarak dağıtılır. Heroicons MIT lisanslıdır, telif Tailwind Labs, Inc. Tam lisans [ui/icons/LICENSE](./ui/icons/LICENSE) içindedir. Sabitlenen commit ve kaynak sağlama toplamları `ui/icons/heroicons-source.json` içinde kayıtlıdır.

https://github.com/tailwindlabs/heroicons/releases/tag/v2.2.0

## Lucide (panel-left / panel-right)

Sol ve sağ panel denetimleri Lucide 1.73.0'dan `panel-left` / `panel-right` kullanır ve önceki yuvarlatılmış dikdörtgeni dikey bir ayırıcıyla korur. Kaynak ve köken: `ui/icons/lucide.js` ve `ui/icons/lucide-source.json`. Tam ISC / MIT lisansları: [ui/icons/lucide-LICENSE](./ui/icons/lucide-LICENSE).

## highlight.js (önizleme panelinde kod vurgusu)

Önizleme panelinin kod görünümü ve Markdown kod blokları highlight.js 11.12.0 ile vurgulanır. Yalnızca çekirdek ve 31 yaygın dil dağıtılır (npm paketi `@highlightjs/cdn-assets` içindeki resmi ES modülü derlemesi), `ui/vendor/hljs/` içinde, `scripts/vendor-hljs.mjs` ile kopyalanır. highlight.js BSD-3-Clause lisanslıdır, telif Ivan Sagalaev ve katkıda bulunanlar; tam lisans [ui/vendor/hljs/LICENSE](./ui/vendor/hljs/LICENSE) içindedir.

https://github.com/highlightjs/highlight.js

## magpie (yerleşik model ağ geçidi, ikili olarak gelir; arayüz biçeminin parçaları ondan uyarlanmıştır)

Kaynak: https://github.com/yetone/magpie (vendor/magpie alt modülü, v0.1.1720)

- İkili olarak gelir: yerleşik model ağ geçidi.
- Uyarlanan: `ui/design/tokens/semantic.css`,
  `ui/design/components/` (`button.css`, `list.css`, `seg.css`, `popover.css`, `toast.css`) ve `ui/css/settings.css`
  içindeki nötr renkler, köşe yarıçapları, hareket ve bileşen biçemleri (`.list` / `.row`, `.seg` parçalı denetim, `.pop` açılır menü, ayarlar sekmeleri, “Kaydedildi” hapı)
  `internal/gui/assets/app.css` dosyasından uyarlanmıştır. magpie adını, magpie logosunu, `assets/icons/` içindeki satıcı logolarını,
  sponsor/iş ortağı görüntülerini veya site ekran görüntülerini kullanmayız.

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

## openclaw-weixin (WeChat iLink kanalı; src/channels/weixin içindeki kodun parçaları bu projeden taşınmıştır)

Kaynak: https://github.com/Tencent/openclaw-weixin

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

## npm bağımlılıkları (çalışma zamanı)

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0 (paketteki LICENSE dosyasına bak)
- ws 8.22.0 — MIT
- yauzl 3.4.0 — MIT
- yaml 2.9.1 — ISC
- electron-updater 6.8.12 — MIT
- @modelcontextprotocol/client 2.2.0 — MIT

Geçişli bağımlılıkların lisansları her paketle birlikte node_modules içinde tutulur. Masaüstü uygulama ayrıca Electron (MIT) ve Chromium gibi bileşenler içerir; lisansları kurulum dizinindeki LICENSE ve LICENSES.chromium.html içindedir.

## DeepSeek Harness (DSH) ajan çalışma zamanı — MIT

Masaüstü uygulama ve Docker imajı değiştirilmemiş npm paketleri `@deepseek-ai/dsh@0.2.1-rc.4` ve
`@deepseek-ai/dsh-sdk-client@0.2.1-rc.4` dosyalarını `dsh/` içinde gönderir (kaynaktan çalışırken `dsh-runtime/`); ayrı bir alt süreç olarak çalışırlar.

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

DSH'nin geçişli bağımlılıkları değiştirilmeden gönderilir; her birinin lisansı paket dizinindedir. Çoğu MIT / Apache-2.0 / BSD / ISC'dir;
ayrıca `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5` (MPL-2.0; kaynak LibreOffice projesinde) ve
`@img/sharp-libvips-*` (LGPL-3.0-or-later, ayrı değiştirilebilir dinamik kitaplıklar olarak) içerirler.

`dsh-runtime/plugins/amb-bridge.mjs` (onay / okuma çiti eklentisi) bu projenin özgün kodudur (MIT).

Sohbet kuralları (`src/agent/prompts/system.ts`), her model isteğinde yeniden okunan sistem istemi kesimi (`dsh-runtime/plugins/amb-prompt.mjs`)
ve istem uzlaşısı testleri ile karakter sınırları (`test/prompts.unit.test.ts`) DeepSeek'in dsh-superagent projesinden
fikir alır (MIT, Copyright (c) 2026 DeepSeek Harness Team): dikkat ilkeleri, istek başına sistem istemi kesimi ve istem testleri.
Metin ve kod bu proje için yeniden yazıldı; kodunun hiçbiri kopyalanmadı.

## dsh-superagent (kalıcı giden kuyruğun tasarımı — MIT)

Kaynak: https://github.com/deepseek-ai/dsh-superagent-prototype (DeepSeek Harness Team'in bir araştırma prototipi)

`src/core/outbox.ts` dosyasının tasarımı (kalıcı giden kuyruk) onun `src/app/outbox.ts` ve `src/app/effects.ts` dosyalarından uyarlanmıştır:
göndermeden önce bir makbuz yaz, her kimliği yalnızca bir kez gönder, bir sohbet içinde sırayla gönder ve başarısız bir mesaj arkadakileri tutsun, `Later` (henüz gönderilemez, başarısızlık sayılmaz),
üstel geri çekilmeli yeniden denemeler ve kapanışta gönderilmemiş mesajları sonraki başlangıç için tutma. Kod bu projenin sqlite deposu ve kanalları için yeniden yazıldı, kopyalanmadı.

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

## DS Bot (uzun süreli bellek, bağlam kâhyası, bot ayarları — Apache-2.0)

Kaynak: https://github.com/Fei2411/DS-Bot

Aşağıdakiler DS Bot'tan taşındı veya uyarlandı ve Apache License 2.0 Bölüm 4 altında değiştirildi (TypeScript ile yeniden yazıldı, bu projenin deposuna ve kanallarına bağlandı, Çince istemler):

- src/agent/memory.ts: üç bellek katmanının (ekip / bot / grup) MEMORY.md + konu dosyası biçimi, boyut sınırları ve giz süzgeci örüntüleri (ds-bot/src/host/memory.js dosyasından uyarlandı).
- src/agent/steward.ts, src/agent/manager.ts: bağlam kâhyasının eşik algoritması ve karar istemleri (sıkıştır / yeni bir kesim başlat + devir) ve dondurulmuş bellek öneki (ds-bot/src/host/steward.js ve docs/plans/2026-10-09-context-and-memory.md dosyalarından uyarlandı).
- src/agent/settings.ts: bot başına izin hazır ayarları ve ayarlara yaklaşım.

DS Bot'un NOTICE dosyası (telif bildirimi alıntısı):

```
DS Bot
Copyright 2026 Fei2411 and the DS Bot contributors

This product is licensed under the Apache License, Version 2.0 (see LICENSE).
```

DS Bot'un NOTICE dosyası, Markdown bellek biçiminin (satır başına bir girdi, [key: value] üst verisi, konu dosyalarına bağlanan bir MEMORY.md dizini) AgentMemoryRepo'dan (MIT) geldiğini ve devir notları ile ne zaman sıkıştırılacağı fikirlerinin OpenAI Codex, OpenCode, goose, pi, Gemini CLI, Hermes Agent ve başka projelerden yararlandığını belirtir (kodlarının hiçbiri kopyalanmadı).

Apache License 2.0'ın tam metni LICENSES/Apache-2.0.txt içindedir (programla birlikte dağıtılır) ve https://www.apache.org/licenses/LICENSE-2.0 adresindedir.

## kimi-computer-use (macOS bilgisayar kullanımı MCP köprüsü — MIT)

Kaynak: https://github.com/songkeys/kimi-computer-use (vendor/kimi-computer-use alt modülü; macOS kurucusu bin/, skills/, LICENSE ve NOTICE gönderir)

Bu proje stdio MCP köprüsünü (bin/computer-use-mcp-bridge.mjs, olduğu gibi kullanılır) ve yeniden adlandırılmış araçlarla skills/computer-use/SKILL.md dosyasını gönderir. Bağımsız, resmi olmayan bir projedir ve OpenAI, Kimi veya başka satıcılardan yazılım ne gönderir ne yeniden dağıtır; bilgisayar kullanımı, kullanıcının macOS 14.4+ üzerinde kurduğu OpenAI Codex Computer Use ve ChatGPT/Codex uygulamasına dayanır.

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

## Cua Driver (platformlar arası bilgisayar kullanımı sürücüsü — MIT)

Kaynak: https://github.com/trycua/cua (libs/cua-driver, sürüm cua-driver-rs-v0.37.0)

Kurucular her platform için resmi önceden derlenmiş `cua-driver` yürütülebilir dosyasını (değiştirilmemiş), LICENSE ve THIRD_PARTY_NOTICES.md dosyasıyla birlikte gönderir (kurulum dizininde resources/cua-driver/). Derleme betiği scripts/fetch-cua-driver.mjs sürümü sabitler ve her sürüm arşivinin SHA256 değerini doğrular. Bu projenin dsh-runtime/plugins/amb-cua-mcp.mjs dosyası yalnızca araçları süzer ve stdio MCP'sinin önünde bildirimi üretir; kodunun hiçbiri kopyalanmadı.

**Gönderilmez**: cua-perception ve OmniParser gibi herhangi bir AGPL bileşeni ve Cua Spaces gibi FSL lisanslı içerik.

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

Cua Driver'ın kendi bağımlılıklarına ait üçüncü taraf bildirimler onunla gelen THIRD_PARTY_NOTICES.md içindedir.

## yuque-mcp (resmi Yuque MCP sunucusu, tek dosya olarak gelir — MIT)

Kaynak: https://github.com/yuque/yuque-mcp-server (npm paketi yuque-mcp 1.0.0)

- Tek paketlenmiş dosya olarak gelir (`vendor/yuque-mcp/yuque-mcp.mjs`, `scripts/vendor-yuque-mcp.mjs` ile üretilir; tek değişiklik, sürümün çalışma zamanında `package.json` dosyasından okunmasının bir sabitle değiştirilmesidir). Uygulamaları bağla › Yuque, Yuque'a bağlanmak için onu kullanır.
- O dosyaya paketlenmiş bağımlılıklar ve lisansları eşlik eden `THIRD_PARTY_LICENSES.txt` içinde listelenir (depoda `vendor/yuque-mcp/`, kurulu uygulamada `resources/yuque-mcp/`).

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
