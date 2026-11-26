# 目錄 Bot 開發框架

[简体中文](./bot-framework.md) | 繁體中文（台灣） | [English](./bot-framework_en.md)

一個 Bot 就是一個目錄。App 裡不放任何單個 Bot 的程式碼，上架新 Bot 不用發布版本。不管誰來做、做多少個，都過同一道約束檢查，風格和安全由框架保證。

目錄為空時，現有使用者看不到任何變化：側邊欄沒有新入口，新手流程和原來一樣。

## 入門

需要 Node.js 22.13+：

```bash
git clone git@github.com:modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run bot -- new <id>            # 從範本起一個目錄：bots/<id>/
npm run bot -- check bots/<id>     # 靜態檢查，範本裡的 TODO 填完才能過
```

`check` 通過後，請人看一眼值不值得上，然後直接提交到 master。不用提 PR。

## 架構

```text
作者（人 / Claude + 開發技能 / 以後的流水線）
        │
        ▼
Bot 包：bots/<id>/ ──► 約束檢查 ──► 人看一眼 ──► dist/catalog ──► App 安裝套件
                                                              │
                                                              ▼
App：本機目錄 · 執行階段（沙箱 iframe、橋接、狀態檔案）· 介面套件 · Bot 程序
```

| 部分 | 位置 | 做什麼 |
| --- | --- | --- |
| 包格式 | `src/botkit/format.ts`、`schema.ts` | `bot.json` 的結構、權限、上限，資料約定用的 JSON Schema 子集 |
| 約束檢查 | `src/botkit/check.ts`、`render.ts`、`evals.ts` | 靜態規則、繪製、真實模型評估測試 |
| 封裝發布 | `src/botkit/bundle.ts`、`pack.ts`、`sign.ts` | 內容尋址的包、簽名的目錄、下架 |
| 目錄載入 | `src/botkit/catalog.ts`、`config.ts` | 預設讀內建目錄、驗證並解壓縮本機包；明確設定才使用遠端目錄 |
| 執行個體 | `src/botkit/installer.ts`、`app-skill.ts` | 第一次使用時安裝，升級、下架、移除 |
| 伺服器端 | `src/web/botapp.ts`、`src/botkit/static.ts` | 目錄和執行個體的介面；介面的靜態路由和 CSP（`amb-bot check` 繪製也用） |
| 介面套件 | `ui/botkit/` | Bot 的介面唯一能引用的東西 |
| 容器 | `ui/screens/bot-app.js`、`discover.js`、`ui/lib/bot-bridge.js` | iframe、橋接、輸入欄位、發現頁 |
| 權限 | `src/agent/host.ts`、`dsh-runtime/plugins/amb-bot-gate.mjs` | 沒聲明的權限執行階段拒絕 |
| 工具 | `src/cli/amb-bot.ts`、`assets/bot-template/` | `amb-bot` 指令和範本 |

## Bot 包

```text
bots/<id>/
  bot.json           中繼資料：名稱、一句話、大頭貼、權限、可點的話、引入的技能、版本
  persona.md         人設和系統提示
  skills/            技能。引入的技能也放這裡，隨目錄一起發布
  ui/                介面：index.html、靜態資源、locales/
  state.schema.json  介面和 Bot 之間的資料約定
  sample.<lang>.json 範例資料，開啟時按使用者的語言顯示。zh-CN、en 必須有，其餘語言缺了退回 en
  evals/             tasks.json（評估測試任務）、injection.json（提示注入用例）
  cover/             可選：發現頁封面 light.png、dark.png
```

### 封面

發現頁卡片上方是一張封面：`cover/light.png`、`cover/dark.png`，跟著介面主題換。封裝時先用它，沒有時退回 `.check/` 裡的介面螢幕截圖，再沒有就顯示大頭貼。

- 畫這個 Bot 在做的事（場景、道具），不畫單獨的機器人大頭貼——大頭貼已經在卡片的名字旁邊。
- 官方 Bot 的封面是一套：用這個 Bot 大頭貼的材質和配色，把它頭頂的配件和工作裡的道具做成一小組毛氈、布藝的靜物（PPT 大師是薰衣草紫毛氈底座上的三張投影片卡，盡職調查助手是芥黃人字呢卷宗 + 黃銅放大鏡，影視創作室是黑毛氈場記板 + 黃銅膠片盤，美股研究報告是黃綠毛絨柱 + 霓虹走勢箭頭）。淺中性灰無縫背景，物件居中、四周留足空白（大卡會再裁成 16:9），顏色只來自物件；不寫字、不放標誌、人物和機器人。深色版用圖片編輯（images/edits）把淺色版換成炭灰底重新打光，構圖不變。用 gpt-image-2.5 畫 1536×1024，再裁成 16:10 壓成 256 色 PNG：

  ```bash
  ffmpeg -i in.png -vf "crop=1536:960,scale=1200:750:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a" -compression_level 9 cover/light.png
  ```

- 必須是 PNG，單張不超過 500 KB（用戶端取線上目錄的縮略圖時按介面套件的上限拒絕），`amb-bot check` 會攔（`format.cover`）。

### bot.json

| 欄位 | 說明 |
| --- | --- |
| `id` | 小寫字母、數字、連字元，2–48 個字元 |
| `version`、`minAppVersion` | Bot 版本；App 版本不夠的使用者看不到這個 Bot |
| `name`、`summary` | 名稱（≤ 24 字元）、一句話（≤ 80 字元） |
| `about` | 1–3 行說明，顯示在資訊面板 |
| `starters` | 2–3 句可點的話，每句都要讓介面發生看得見的變化。還沒用過時顯示在輸入欄位上方的一排單行膠囊裡，放不下時省略、懸停看全文，寫短一點（中文 20 字左右以內） |
| `avatar` | 基礎角色 `blue`、`yellow`、`green`、`red`、`purple`、`orange`，或領域專家 `law`、`health`、`finance`、`code`、`design`、`writing`、`education`、`science`、`data`、`marketing`、`cooking`、`translate`；只決定長相。專家要新版 App 才認得，用了就把 `minAppVersion` 設到發布它們的那個版本。不能和目錄裡別的 Bot 撞大頭貼（封裝時攔）。`slides`、`film`、`dossier`、`ticker` 是 PPT 大師、影視創作室、盡職調查助手、美股研究報告的專屬形象，別的 Bot 不能用 |
| `permissions` | 見下表 |
| `skills` | 引入的技能：`name`、`source`、`sha256`（`amb-bot hash` 算）、`author`、`license`、`url`。自己撰寫的不用列 |

文案欄位都寫成 `{ "zh-CN": …, "en": … }`。框架要求這兩種，`zh-TW`、`ja`、`ko`、`ru`、`es`、`pt`、`tr` 缺了退回 `en`。這個儲存庫裡上架的 Bot 九種語言都要有，文案、介面和範例資料都算，`test/bot-catalog-site.unit.test.ts` 會檢查。

### 權限

| 權限 | 允許 | 沒聲明時 |
| --- | --- | --- |
| `workspace-write` | 寫自己的工作區。因為要寫 `app/state.json`，這項必須有 | 權限預設是唯讀 |
| `network` | 連線上網搜尋、抓網頁、指令連線上網。第一次用時問使用者 | 工具被拒絕；Linux 上指令沒有網路；指令碼裡連線上網過不了靜態檢查 |
| `channel-send` | 背景任務，結果會主動發到聊天管道。第一次用時問使用者 | `task_start`、`task_message` 被拒絕 |
| `computer-use` | 操作電腦 | 不載入 |
| `accounts` | 使用者授權的帳號（Notion、飛書資料） | 不載入 |

macOS 和 Windows 上，指令層面的網路中斷靠靜態掃描，執行階段只攔工具呼叫。

## 介面

介面執行於 `sandbox="allow-scripts allow-forms"` 的 iframe 裡，是不透明來源：不能連線上網（`connect-src 'none'`）、沒有 Cookie、碰不到 App 的介面。所有資料都經橋接走父頁面。

只能引用介面套件和自己目錄裡的檔案：

```html
<link rel="stylesheet" href="/amb/botapp/kit/kit.css" />
<script type="module" src="./app.js"></script>
```

```js
import { html, mount, useBot, Page, Card } from "/amb/botapp/kit/kit.js";

function App() {
  const bot = useBot();
  if (!bot.ready) return null;
  return html`<${Page} title=${bot.state?.title}>…<//>`;
}
mount(App);
```

### useBot()

| 欄位 | 說明 |
| --- | --- |
| `ready` | 橋接就緒 |
| `state` | `app/state.json` 的內容，不合約定的部分已剪掉；Bot 改了檔案自動更新 |
| `issues` | 不合約定的地方，給偵錯用 |
| `sample` | 還是範例資料（還沒建立執行個體） |
| `busy` | Bot 正在回覆 |
| `lang`、`t(key, params)` | 目前語言和 `ui/locales/<語言>.json` 裡的文案 |
| `send(text, action)` | 以使用者身分傳送訊息。`action` 是介面操作，Bot 收到 `[ui-action] {…}` |
| `stop()` | 停止目前回合 |
| `pickFile({ accept, multiple })` | 讓使用者選檔案，放進 `app/inbox/`，返回 `[{ name, size, path }]` |
| `readFile(path)` | 讀 `app/` 下的其他文字檔（≤ 2 MB） |
| `readImage(path)` | 讀 `app/` 下的圖片（png、jpg、gif、webp、svg，≤ 16 MB），返回 `{ url }`，放進 `<img>`；需要執行個體，範例資料裡的圖放在 `ui/` 下用相對路徑 |
| `readMedia(path)`、`releaseMedia(url)` | 0.1.23 起可預覽 `app/` 下的音訊與視訊（單個 ≤ 200 MB，同時最多 4 個）。返回 `{ url, size }`，用於 `<video>` / `<audio>`；切換素材或移除安裝元件時釋放 URL。資料經父頁面傳入，Blob URL 在沙箱內建立 |
| `openFile(path, { reveal })` | 開啟 `app/` 下的檔案。要在使用者點選時呼叫。預設在右側「預覽」開啟；不支援的格式提供下載與系統開啟。桌面版 `{ reveal: true }` 仍在資料夾中顯示 |
| `desktop` | 是桌面版，能用系統程式開啟檔案 |
| `expanded`、`setExpanded(boolean)` | 工作台是否展開；使用者點選時可展開，收起保留目前編輯狀態。新套件能力要求 App 0.1.33 起 |
| `openUrl(url)` | 在右側預覽外部網頁：使用者確認位址後才開啟，只放行 http(s)，保留瀏覽器開啟入口 |

主題、語言、字級、動效偏好由套件自動跟隨，介面不用管。

### 元件

`Page`、`Section`、`Card`（`on` 時用高亮底色）、`Row`、`Stack`、`Grid`、`Button`、`Field`、`Notice`、`Empty`、`Meter`、`Table`、`Link`（外部連結，點開前讓使用者確認）。設計系統的類（`.btn`、`.field`、`.t-title`…）和 token（`--fg`、`--well`、`--space-*`、`--fs-*`）都能直接用，規範見 [ui/design/README.md](../ui/design/README.md)。JS 裡的 `style` 同樣不能寫死顏色、間距和字級，只放算出來的值，例如條形的寬度。

### 桌面工作區

專屬介面首先支援右側面板。有多份作品（專案、研究、任務）的 Bot 使用套件的 `Workspace({ label, current, children })`：第一個子項是導覽，後面是內容。`label` 為清單名稱，`current` 為目前專案或新增頁面的標題。新元件要求 App 0.1.33 起：

```js
html`<${Workspace} label=${listTitle} current=${selectedTitle}>
  <nav class="kit-ws-list">
    <div class="kit-list-head"><h2 class="t-label">專案</h2><button class="btn sm">新增</button></div>
    <button class="kit-item on"><span class="kit-item-title">名稱</span><span class="kit-item-meta">…</span></button>
  </nav>
  <main class="kit-ws-main">
    <header class="kit-bar"><div class="kit-bar-text"><h1>目前這一份</h1><p>狀態 · 一行說明</p></div><div class="kit-bar-actions">…</div></header>
    <div class="kit-ws-body"><div class="kit-tabs" role="tablist">…</div>…</div>
  </main>
<//>`;
```

- iframe 小於 1100px 時，導覽收進頂部專案選擇器，點選外部或按 Escape 關閉；到達 1100px 後常駐左側。宿主提供「展開工作台 / 返回對話」，切換時不移除安裝 Bot 介面。
- `.kit-ws-main` 聲明 `workspace-content` 容器，內部多欄用容器查詢，按扣除導覽後的實際寬度切換。外部 Bot 原有的直接 `<div class="kit-ws">` 結構仍可使用。
- Bot 的名字已經在容器頂欄裡，介面裡不再寫大標題；免責聲明這類每次都一樣的話放在末尾的 `.kit-foot`，不佔頂部。
- 主操作按進度提供「下一步」，其餘收進「更多」。預設主分頁保持四個左右；畫布、設定等輔助工具按需進入。長描述、版本、任務歷史使用局部折疊，目前產生狀態展示在目前作品附近。
- 容器底部的範例是一排單行膠囊，可點的話寫短一點，放不下時會被省略。
- 對話在主區、工作台在右側；展開工作台時暫時隱藏對話，返回時還原原有寬度和狀態。Bot 不需要自己做聊天。
- 讓新手和懂行的人都能入門，每個 Bot 做兩樣東西：清單頂上的「新增」是精靈——點選幾項，介面把要求寫成一句話（發出前顯示出來）再 `send`；另外至少一個懂行的人熟悉的專業檢視，例如研究報告的關鍵數字、來源核對、放映、分鏡表。

元件按真實需要加到 `ui/botkit/kit.js`：加進套件，不要在單個 Bot 裡繞過。套件隨 App 發布，所以往裡加東西要發布版本。新能力登記在 `src/botkit/format.ts` 的 `KIT_SINCE`，用到它的 Bot 的 `minAppVersion` 不能更低，檢查會攔（`ui.min-app-version`）。

### 橋接

`ui/lib/bot-bridge.js` 驗證 `event.source`，只開放白名單方法，核准相關介面永遠不開放。

| 方法 | 作用 |
| --- | --- |
| `init` | 下發語言、主題、字級、動效偏好、文案和 Bot 基本資訊 |
| `readFile`、`readImage` | 唯讀工作區 `app/` 下的檔案，走不出去 |
| `readMedia`、`releaseMedia` | 讀取受限類型和大小的音訊與視訊，管理預覽資源；不能讀取 HTML 或指令碼 |
| `openFile` | 預覽 `app/` 下的檔案，提供下載與系統開啟。父頁面確認使用者剛點過才執行 |
| `send`、`stop` | 傳送訊息、停止 |
| `subscribe` | 接收 `turn`、`file`、`env` 事件 |
| `pickFile` | 選檔案 |
| `openChannels` | 開啟連線設定，讓使用者綁定聊天管道 |
| `openUrl` | 使用者確認位址後在右側預覽外部網頁 |
| `reportError`、`rendered` | 上錯誤誤（退回對話檢視）、繪製完成 |

一期不開放麥克風、攝影機和外部地圖。確實需要時評估怎麼安全地開放，加進橋接和約束檢查。

## 資料約定

Bot 維護工作區裡的 `app/state.json`，結構由 `state.schema.json` 規定。介面唯讀它，改資料只通過 `send` 讓 Bot 去改。這樣同一個 Bot 在聊天管道裡改的東西，回到電腦上介面也是新的。

每個目錄 Bot 都自動帶著宿主產生的 `amb-app` 技能（`src/botkit/app-skill.ts`）：告訴 Bot 怎麼讀寫這份狀態、怎麼處理介面操作、在聊天管道裡怎麼回覆。這些不用寫進 `persona.md`。

Schema 支援的關鍵字：`type`、`properties`、`required`、`additionalProperties`、`items`、`enum`、`const`、`minimum`、`maximum`、`minLength`、`maxLength`、`minItems`、`maxItems`。用了別的關鍵字，檢查會錯誤。

模型不一定每次都照約定寫，所以讀檔案時先驗證：不合約定的欄位去掉，缺必填欄位的清單項去掉，介面能繪製多少繪製多少，同時寫本機記錄。

### 框架的邊界

這幾條是執行階段的限制，設計 Bot 時要考慮：

- **不能註冊工具**：Bot 的能力來自模型內附的工具、技能說明和技能裡的指令碼。
- **指令碼調不到模型，也讀不到使用者的環境變數**：需要模型的步驟由 Bot 和它的子代理（`agent` 工具）完成；搜尋用 `web_search`，App 設定中的搜尋介面和 Key 由宿主管理。
- **背景任務只能寫自己的資料夾**（`tasks/<slug>-<id>/`），寫不了 `app/state.json`：要讓介面即時更新的長任務放在目前回合裡跑，單回合預設上限 30 分鐘。
- **結果回到發起的對話**：在聊天管道裡發起就回到那個管道，不能指定發到別的管道。

## 使用者怎麼走

| 動作 | 發生什麼 |
| --- | --- |
| 開啟 | 從安裝套件解出介面，顯示範例資料，頂部標明「範例」。不連線上網下載、不建立執行個體、不裝技能、不起程序、不調模型 |
| 第一次傳送訊息（打字或點可點的話） | 從安裝套件解出執行套件，驗證 sha256；建立執行個體 `cat-<id>`，範例資料寫成初始狀態，自動留在「我的」 |
| 之後 | 和普通 Bot 一樣，也能在聊天管道裡用（`/bot` 能切到）。不進其他 Bot 的同伴名單 |
| App 升級帶來新的 Bot 包 | 下次開啟時替換技能和介面，保留專案資料。使用者改過人設的不再跟隨；正在工作的等下次 |
| 空閒 10 分鐘 | 代理程序結束，下一則訊息再拉起 |
| 移除 | 問一句是否保留資料。不保留就清掉工作區和技能；保留的話再次使用接著用 |

只看沒用的 Bot 不留任何東西，被新上架的頂掉後，還能在發現頁找到。

## 約束檢查

```bash
npm run bot -- check bots/<id>          # 靜態：幾秒，每次改完都跑
npm run bot -- check bots/<id> --full   # 可選：再跑繪製和真實模型，上架不依賴它
```

| 類別 | 規則前綴 | 檢查什麼 |
| --- | --- | --- |
| 格式 | `format.*` | 必需檔案齊全，`bot.json` 合法，TODO 填完，範例資料符合約定 |
| 來源 | `source.*` | 引入的技能有作者和原頁面，授權條款在白名單（MIT、MIT-0、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC、CC0-1.0），哈希對得上，沒有符號連結；執行套件檔案數和解開後的大小不超限（用戶端解包時同樣的上限） |
| 權限 | `permissions.*`、`risk.*` | 指令碼連線上網要聲明；管道執行、刪工作區外的檔案、讀金鑰、混淆執行、留常駐項、提權一律不過 |
| 介面 | `ui.*` | CSS 和 JS 裡都不寫死顏色、間距、字級；沒有內聯指令碼和外部資源，外部連結用 `Link`；不連線上網，不碰儲存和外層頁面；壓縮後 ≤ 500 KB；中英文案鍵一致 |
| 繪製 | `render.*` | 淺色、深色、390px 沒有錯誤、空白、溢出和對比度問題 |
| 行為 | `behavior.*` | 評估測試任務完成率 ≥ 80%，每句可點的話都讓介面變化，寫出的狀態符合約定 |
| 安全 | `security.*` | 提示注入用例全部通過 |

不通過時會指出具體哪一條。每發現一類新問題，就在 `src/botkit/check.ts` 加一條規則，不靠人記。

繪製、行為、安全三類只在 `--full` 裡跑。`--full` 是可選的，封裝和上架都不依賴它。要跑的話需要兩樣東西：

- 繪製用 Playwright，不是 App 的依賴：`npm i --no-save playwright && npx playwright install chromium`。螢幕截圖留在 `.check/`；沒有畫好的封面（見下）時，提交後封裝時用作發現頁縮略圖；兩樣都沒有時，發現頁卡片顯示大頭貼。
- 評估測試連到執行中的 App：先裝 Go 1.26.8+，執行 `npm run setup && npm start` 並登入 Modelflare（`--app <位址>`，預設本機設定的連接埠；有權杖時設 `AMB_UI_TOKEN`）。評估測試會真實安裝並呼叫模型，跑完清掉。

評估測試任務寫在 `evals/tasks.json`：`{ id, prompt, changed?, contains?, notContains?, file?, files? }`，至少 3 個。`file: { name, text }` 把檔案放進 `app/inbox/`。`files` 檢查產物，只信檔案本身：`{ match（路徑的正則）, minBytes?, zipHas?（zip 裡要有的項目）, absent?（這樣的檔案不能存在） }`。評估測試時沒人點核准：Bot 聲明過的權限第一次用時的確認算通過，其餘拒絕，Bot 的提問答「按你的建議繼續」。注入用例寫在 `evals/injection.json`：`{ id, prompt, file?: { name, text }, mustNotContain }`，至少 1 個。

## 發布和下架

官方 Bot 隨 App 一起發布。`npm run build` 自動執行 `build:catalog`，檢查 `bots/` 下的全部 Bot，把介面、各語言的範例資料、人設、技能和可用縮略圖打到 `dist/catalog/`。Electron 的 `dist/**` 封裝規則和 Docker 映像檔都會包含這些資源，不需要目錄簽名私密金鑰。首次預覽和安裝只從內建包讀取，按 sha256 驗證後解壓縮到資料目錄；舊的線上目錄快取不會覆寫內建目錄。

`npm start`、`npm run dev` 和 `npm run init` 會先產生內建目錄；直接執行 `tsx src/main.ts` 前，先執行 `npm run build:catalog`。官方 Bot 的上新、升級和下架跟隨 App 版本發布。GitHub Release 工作流程會用封裝後的執行檔驗證所有內建 Bot 能在禁止網路請求的條件下載入和安裝。

以下簽名目錄流程保留給明確設定遠端目錄的部署：

目錄儲存庫的結構：

```text
bots/<id>/          每個 Bot 一個目錄
catalog.json        { "featured": [id…], "removed": { id: { reason, security? } } }
catalog.lock.json   每個 Bot 上次發布的記錄，由 pack 維護，留在發布機器上
```

```bash
npm run bot -- pack --root . --out dist-catalog            # 需要 AMB_CATALOG_PRIVATE_KEY
npm run bot -- takedown <id> --root . --reason "原因" [--security]
npm run bot -- who-uses <技能> --root .
```

- `pack` 把每個 Bot 過一遍靜態檢查，有一個不過就什麼都不寫。產物是 `index.json`、`index.json.sig`、`bundles/`、`thumbs/`，放到目錄位址下就算發布。
- 明確使用遠端目錄的用戶端啟動時和之後每 6 小時拉一次（帶 ETag），驗簽失敗不更新；快取也要驗簽。介面和技能按 sha256 驗證。
- 下架後重新 `pack` 並發布，24 小時內用戶端生效。普通下架只提示使用者；`--security` 會立刻停掉程序、刪掉技能，使用者的資料不動。
- `.github/workflows/bot-catalog.yml` 在 `bots/**` 或 `catalog.json` 推到 master 時檢查並封裝，產物作為 CI artifact；怎麼放到線上由發布環境決定。儲存庫還沒設定 `AMB_CATALOG_PRIVATE_KEY` 時只檢查，不封裝。

### 可選的線上目錄

預設使用 `dist/catalog/`，不連線 `anymodel.bot/catalog/`。只有明確設定 `AMB_CATALOG_URL` 才改用遠端目錄；`AMB_CATALOG_PUBKEY` 指定其公開金鑰，未指定時沿用舊官方目錄的公開金鑰。

- **私密金鑰**只放在發布機器上（`AMB_CATALOG_PRIVATE_KEY`），不要提交。丟了就要換公開金鑰併發布版本，所以要另外備份。
- **遠端發布**：在發布機器上拉最新的 master，執行 `pack`，把產物放到目錄位址下；只影響明確連線該遠端目錄的用戶端。
- **`catalog.lock.json`** 留在發布機器上，每次 `pack` 前放回儲存庫根目錄。
- **官方網站**：`/bots` 頁面的內容來自 `site/src/data/catalog-bots.json`。上架或改了 Bot 的文案後，在 `site/` 執行 `npm run sync` 並提交，再部署官方網站。
- **關閉目錄**：設環境變數 `AMB_CATALOG=off`，內建和遠端目錄都會關閉。測試預設這樣跑，內建目錄有獨立的離線測試。

本機聯調可以不改程式碼：設環境變數 `AMB_CATALOG_URL` 和 `AMB_CATALOG_PUBKEY`。

### 簽名金鑰與還原

發布機器的簽名金鑰儲存在 `.runtime/catalog/signing.json`，包含 Ed25519 公私密金鑰，目錄權限為 `0700`、檔案為 `0600`。`.runtime/` 和本機 `catalog.lock.json` 已加入 Git 忽略；發布程序讀取 `privateKey` 後傳給 `AMB_CATALOG_PRIVATE_KEY`，不要列印或寫入指令歷史。

age 用於加密私密金鑰備份，不代替目錄簽名。目前沿用 Modelflare 的 age 收件人和備份儲存：加密物件位於已設定備份目標的 `anymodelbot/catalog-signing/` 前綴下。本機 `.runtime/catalog/backup-receipt.json` 記錄物件位址、大小和 SHA-256；上傳後核對遠端物件大小。

還原時，從該前綴下載對應的 `.json.age`，用離線保管的 age 私密金鑰解密，再將簽名檔案以 `0600` 權限放回上述路徑。使用前從私密金鑰推導公開金鑰，與 `src/botkit/config.ts` 的 `CATALOG_PUBLIC_KEY` 比較；不一致時不能直接發布。0.1.23 因原私密金鑰丟失而更換了目錄公開金鑰，舊版使用者需要升級後才能載入新目錄。

## 讓 Claude 做 Bot

`.claude/skills/amb-bot-dev/` 是 Bot 開發技能：把這份文件的約束寫成 Claude 照著做的步驟。跟 Claude 說要做什麼，它從範本起目錄，寫到 `check` 通過為止。以後想要批次產生，流水線也只是多一個作者，產物一樣過約束檢查，架構不用改。

## 介面

都在 `/amb/api` 下。錯誤只返回 `code`，文案在介面詞典 `botapp.errors.*` 裡。

| 介面 | 說明 |
| --- | --- |
| `GET /catalog` | 目錄清單 |
| `POST /catalog/sync` | 立刻同步 |
| `POST /catalog/dev`、`DELETE /catalog/dev/:id` | 登記、取消本機目錄（只在回環模式） |
| `GET /catalog/:id` | 一個項目 |
| `POST /catalog/:id/preview` | 準備介面，返回位址；不建立執行個體 |
| `GET /catalog/:id/file?path=` | 還沒有執行個體時讀範例資料 |
| `POST /catalog/:id/install` | 建立執行個體 |
| `GET /bots/:id/app` | 執行個體的來源、版本、有沒有新版本 |
| `POST /bots/:id/app/update` | 升級 |
| `GET /bots/:id/app/file?path=` | 讀 `app/` 下的檔案 |
| `GET /bots/:id/app/image?path=` | 讀 `app/` 下的圖片，返回 data URL |
| `GET /bots/:id/app/list` | 列出 `app/` 下的檔案（評估測試用） |
| `GET /bots/:id/app/download?path=` | 讀取 `app/` 下的檔案；加 `download=1` 強制下載 |
| `GET /bots/:id/app/preview?path=` | 取得 `app/` 下檔案的預覽描述 |
| `POST /bots/:id/app/open` | 桌面版開啟 `app/` 下的檔案，或在資料夾中顯示 |
| `POST /bots/:id/app/inbox` | 放檔案進 `app/inbox/` |
| `GET /bots/:id/app/watch` | SSE：`app/` 下的檔案變化 |

靜態檔案在 `/amb/botapp/` 下：`kit/`（套件和設計系統）、`b/<sha256>/`（介面套件）、`d/<id>/`（開發目錄）、`thumb/<sha256>`（縮略圖）。這條路徑不要權杖，因為沙箱頁帶不上 Cookie；這裡沒有使用者資料。
