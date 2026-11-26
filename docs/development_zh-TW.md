# 開發文件

[简体中文](./development.md) | 繁體中文（台灣） | [English](./development_en.md) | [日本語](./development_ja.md) | [한국어](./development_ko.md) | [Русский](./development_ru.md) | [Español](./development_es.md) | [Português (Brasil)](./development_pt.md) | [Türkçe](./development_tr.md)

這份文件給想從原始碼執行、封裝或參與開發的人看。普通使用者直接從 [Releases](https://github.com/modelflare-ai/AnyModelBot/releases) 下載安裝套件即可，見 [README](../README_zh-TW.md#-下載與執行)。

- 一個機器人 = 人設 + 預設模型 + 記憶。帳號是全域的（設定 › 聊天管道），所有機器人共用，同一個服務可以加多個。定位：自用、單使用者。
- 模型來自 Modelflare 帳號或使用者自己的官方 API Key。[Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)：首次啟動登入（或註冊）Modelflare 帳號，模型自動列出。請求經過內建的 [magpie](https://github.com/yetone/magpie) 閘道轉送。
- 三種執行方式，同一套程式碼：**桌面版（Electron）**、**命令列 `npm start`**、**Docker**。

## 目錄結構

```
src/
  core/          統一訊息類型、對話佇列與去重、執行階段（/model /reset、串流）、重新啟動後的提醒、准入（主人 + 允許名單）、持久化出站佇列
  delivery/      主動訊息的投遞：免打擾、每天上限、合併摘要、微信 24 小時視窗和續期提醒
  agent/         代理模式：DSH 宿主與橋接、核准、權限預設、記憶與上下文管家、DSH 對話目錄
    prompts/     交給代理模型的全部提示詞：人設、聊天規則、記憶說明、每段第一則訊息、技能說明
  tools/         代理用的能力：連線上網搜尋（search.ts）、生圖 / 生影片（media/）、電腦操作（computer-use/）、Windows PowerShell（pwsh/）、連線應用程式——內建應用程式連接器和自訂 MCP（apps/）、現有的 Notion / 飛書帳號（accounts/）
  llm/           OpenAI 相容用戶端（模型連接介面）
  magpie/        內建 magpie 守護：隔離目錄、空閒連接埠、自動產生金鑰、健康檢查、崩潰重新啟動、乾淨結束
  channels/      feishu/（持續連線 + CardKit）  weixin/（iLink，MIT 聲明見 LICENSE.openclaw-weixin）  messenger/（Telegram、Slack、Discord，共用一套收發）
  tasks/         背景任務和規則：執行、階段、花費、保留與清理、時間表
  botkit/        目錄 Bot 框架：包格式、檢查、封裝簽名、目錄、安裝、介面靜態路由（見 docs/bot-framework.md）
  skills/        使用者自己裝的技能（ZIP 包）
  store/         SQLite（node:sqlite，不必原生編譯）
  domain/        純資料形狀和規則：機器人設定、免打擾時段、時間表、目錄 Bot 記錄、代理步驟；不做 I/O，只依賴 i18n。store 只依賴它（依賴方向由 test/architecture.unit.test.ts 檢查）
  account/       Modelflare 帳號：PKCE 回環登入、權杖輪換、餘額與提醒、機器人預算 Key、模型能力與參考價
  web/           管理介面服務：server.ts 啟動、鑒權、分發；routes/ 按領域放介面（JSON API + 串流對話 SSE）；http.ts 是共用的小函式
  cli/           init 首次設定精靈、weixin-login
  providers/     模型從哪來：modelflare.ts（線路、金鑰驗證 GET /v1/models、模型路由與歸因）、modelflare-domains.ts（線路測速）、official.ts（官方 API 廠商表，位址寫死）
  updates/       更新：check.ts（檢查新版本）、desktop.ts（桌面版的下載與重新啟動）
  guide.ts       入門清單的進度
  i18n/          伺服器端多語言：錯誤、狀態文字、系統匣選單、機器人發出的系統訊息（messages/<命名空間>.ts）
  diagnostics.ts 疑難排解：探測、記錄尾部、脫敏的診斷報告
  version.ts     應用程式版本號碼（package.json）
  main.ts        命令列入口
electron/        桌面版主程序（啟動器 + 系統匣）
ui/              管理介面（Preact + htm，無建置步驟）
  design/        設計系統：tokens/、base/、components/、機器人形象 bots/
  locales/       介面文案：zh-CN/、zh-TW/ 與 en/，每個命名空間一個檔案
  css/ lib/ components/ screens/ assets/ main.js
dsh-runtime/     DSH 代理執行階段的依賴清單與 AnyModelBot 外掛程式（plugins/）
scripts/         setup / build-magpie / fetch-cua-driver / prepare-dsh / bundle-dsh / electron-smoke / check-readme 等
vendor/          git 子模組：magpie（建置時編譯）、deepseek-harness、kimi-computer-use
site/            官方網站（Astro 靜態站），說明見 site/README.md
docs/            開發文件、隱私說明、README 素材（docs/assets/）
```

## 從原始碼執行（命令列）

需要 Node.js 22.13+、Go 1.26.8+（用於從原始碼編譯 magpie）。

```bash
npm install
npm run setup        # 拉取 vendor/magpie 子模組並編譯到 build/bin/
npm run init         # 可選：終端機裡的首次設定（登入 Modelflare 帳號、飛書認證資料）
npm start            # 啟動全部：內建閘道 + 機器人 + 管理介面 http://127.0.0.1:3600/
```

資料預設在 `./data`（`AMB_DATA_DIR` 可改）。其餘環境變數見 `.env.example`。

管理介面要帶存取權杖才能開啟：沒設 `AMB_UI_TOKEN` 時自動產生並存在資料目錄的 `ui-token`，在終端機裡啟動時會列印一次帶權杖的位址。Linux 上代理執行的指令只在 bubblewrap 沙箱裡執行（Debian / Ubuntu：`apt install bubblewrap`），bubblewrap 用不了時指令被拒絕、不退到別的沙箱；確實只能用只限制寫檔案的 Landlock 時設 `AMB_ALLOW_LANDLOCK=1`。

## 桌面版（Electron）

```bash
npm run electron:dev     # 開發執行
npm run electron:smoke   # 冒煙測試（Linux 無顯示器時自動用 xvfb-run）
npm run dist             # 封裝目前平台（magpie 隨附在 resources/magpie/）
npm run dist:linux | dist:mac | dist:win
npm run test:dsh-bundle  # 用 Electron 跑真實 DSH 整合測試，載入封裝後的 build/dsh（需先 prepare:dsh + bundle:dsh）
```

- DSH 代理執行階段：`scripts/prepare-dsh.mjs` 按目標平台安裝 `dsh-runtime/`，`scripts/bundle-dsh.mjs` 把它打成 `resources/dsh/dsh.asar`（全部 JS，一個檔案）加上 `resources/dsh/node_modules/`（只有原生包，約 55 個檔案）。Electron 主程序和 `ELECTRON_RUN_AS_NODE` 子程序直接讀 asar，不必首啓解壓縮；安裝套件因此只需解出幾百個檔案（Windows 上解壓縮與殺毒逐個掃描是安裝慢的主因）。開發時仍直接用 `dsh-runtime/`。
- Windows 上代理執行指令用的 PowerShell：經沙箱時 Windows PowerShell 5.1 每條指令要二三十秒，PowerShell 7 約 1 秒。應用程式按這個順序選：系統裡能用的 PowerShell 7（背景按 DSH 的方式試執行一次，什麼都不下載）→ 應用程式內建的 PowerShell 7 → Windows PowerShell 5.1。沒有能用的 7 且代理模式開著時，應用程式在背景自動下載官方 PowerShell 7.6.9（LTS）的 zip，裝到 `%LOCALAPPDATA%\AnyModelBot\pwsh\`：不需要管理員權限，不寫註冊表、不改 PATH，不影響你自己的 PowerShell。版本和 x64 / arm64 兩個 zip 的 SHA256 寫死在 `src/tools/pwsh/private.ts`（升級用 `node scripts/pwsh-hashes.mjs <版本>`），下載後核對哈希、解壓縮後核對微軟 Authenticode 簽名，再按 DSH 的方式試執行（版本、讀寫暫存檔、拉起外部程式）通過才用；裝失敗或裝了一半的不會被用，下次啟動會清掉。裝的時候對話頁和 設定 → 一般 顯示進度，`/status` 也有，裝好之前指令照常用 5.1；裝好後空閒的代理程序在背景換用它，不用重新啟動應用程式。執行中代理拉不起它（被殺毒軟體刪除或隔離、被策略攔截）就自動退回上一種並提示原因；設定 → 疑難排解 可以安裝、重新安裝、改回系統預設。Windows 10 1607 / Server 2016 以前的系統不下載。桌面版下載走系統 Proxy（Chromium 網路堆疊）；命令列版用 Node 的 fetch（較新的 Node 設 `NODE_USE_ENV_PROXY=1` 後認 `HTTPS_PROXY`）；`AMB_PWSH_MIRROR` 可換成映像檔前綴（照樣核對哈希和簽名），`AMB_PWSH_AUTO_INSTALL=0` 關掉自動安裝。
- 代理執行的指令能連線上網（沙箱只限制寫檔案），用的是你的代理：應用程式環境變數裡的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`（及小寫）和憑證、軟體源變數（`SSL_CERT_FILE`、`REQUESTS_CA_BUNDLE`、`NODE_EXTRA_CA_CERTS`、`PIP_INDEX_URL`、`npm_config_registry`、`GOPROXY` 等）原樣傳下去；環境裡沒設代理時，桌面版每次拉起代理程序都問一次系統 Proxy（系統設定和 PAC），按 `http://主機:連接埠` 傳下去（見 `src/agent/proxy-env.ts`）。本機位址（`127.0.0.1`、`localhost`、`::1`）總是並進 `NO_PROXY`，永不走代理。
- 資料目錄：`<userData>/data`（macOS `~/Library/Application Support/anymodel bot/data`，Windows `%APPDATA%\anymodel bot\data`，Linux `~/.config/anymodel bot/data`）。記錄在資料目錄的 `logs/app.log`。
- 啟動診斷（自 0.1.34 起，協助疑難排解 #71）：進入桌面主程序後、申請單一執行個體鎖定之前，另寫 `logs/startup-<時間>-<PID>.log`，記錄實際資料目錄、平台、版本、鎖結果和啟動階段。每個程序單獨寫，主執行個體保留最近 20 份，不影響正常 `app.log`。資料目錄無法寫入時嘗試系統臨時目錄下的 `anymodel-bot-startup-*`。帶 `--diagnose-startup` 啟動時，未獲得單一執行個體鎖定會顯示記錄位置；普通的第二次啟動仍交給已有執行個體。
- Windows 秒退疑難排解：目錄名是帶空格的 `anymodel bot`。`--help` 顯示 Node.js usage 不能證明程式使用 Node SEA；Electron 的 `ELECTRON_RUN_AS_NODE` 環境變數會在應用程式程式碼執行前切到 Node 模式，這時應用程式自己的記錄也不會初始化。先檢查該變數，並在單次啟動的子程序環境中清除它；不要把跳過單一執行個體鎖定作為修復。需要原生啟動記錄時可使用 Electron 的 `--enable-logging=file --log-file="<可寫路徑>"`。這些路徑與切換開關的實際結果應一並提供給維護者。
- 單執行個體；關閉視窗預設隱藏到系統匣（設定 → 一般 可改為結束）；系統匣選單：開啟 / 在瀏覽器中開啟 / 開機時自動啟動（macOS、Windows）/ 開啟資料目錄 / 結束。
- macOS 下視窗無標題列，紅綠燈嵌在側欄頂部；視窗最小寬度 860。
- 介面只監聽 127.0.0.1，且每次啟動產生隨機存取權杖，其他本機程式無法直接呼叫管理介面。
- 結束時先停管道、再停 magpie；若上次被強殺殘留 magpie 程序，下次啟動會自動清理（Linux/macOS）。

發布：在 `CHANGELOG.md`、`CHANGELOG_zh-TW.md`, `CHANGELOG_en.md`、`CHANGELOG_ja.md`、`CHANGELOG_ko.md`、`CHANGELOG_ru.md`、`CHANGELOG_es.md`、`CHANGELOG_pt.md` 和 `CHANGELOG_tr.md` 寫好這個版本的更新紀錄（使用者能感受到的變化，不寫網站和內部改動。官方網站英文頁不顯示提到微信、飛書的行），改 `package.json` 的版本號碼並提交，推播 `v<版本>` 標籤。這個版本沒寫更新紀錄時，發布流程開始就會失敗；寫了就作為 GitHub Release 的說明，官方網站更新紀錄頁也顯示它。應用程式裡的「更新了什麼」快顯視窗讀的也是它：`CHANGELOG*.md` 隨安裝套件和 Docker 映像檔封裝（`src/changelog.ts`），還沒安裝的新版本在使用者點開時從那個版本標籤下讀取。`.github/workflows/release.yml` 會在六種系統 / 架構上各自封裝，並把安裝套件和 `SHA256SUMS` 發到 GitHub Release。簽名與公證所需的儲存庫金鑰見該檔案開頭的注釋。同一個標籤還會觸發 `.github/workflows/docker.yml`，把 x64 + arm64 映像檔發布到 `ghcr.io/modelflare-ai/anymodel-bot`（`<版本>` 和 `latest` 兩個標籤）。 標籤發布版本時 macOS 包必須帶 Developer ID 簽名並完成公證，封裝後會對 .app 和 DMG 裡的 .app 做 `spctl` 等驗證，不通過就失敗。正式包關閉開發者工具；需要偵錯包時用 `npm run dist:debug`，或在手動執行 Release 時勾選 `debug_build`（檔名帶 `-debug-`，標籤上不允許，`scripts/check-build-flavor.mjs` 會核對封裝結果）。

每次發布版本必須同步官方網站、相關文件和各語言的 README。先執行 `npm --prefix site run sync` 同步官方網站內容；GitHub Release 和 Docker 發布後，按[官方網站部署說明](../site/README.md)更新線上官方網站，確認 `/download`、`/changelog` 和 `/bots` 的版本、下載連結與說明一致。只有線上官方網站也同步完成，才算本次發布完成。

應用程式內更新從 0.1.29 開始提供，使用 `electron-updater`，只在已封裝的 macOS、Windows 和 Linux AppImage 中啟用。`ui.autoDownloadUpdates` 預設 `true`，在「設定 → 一般」修改；下載完成只通知，不會在普通結束時安裝，點選重新啟動前會檢查活動對話和背景任務。0.1.28 及以前的使用者需手動安裝一次包含更新器的版本。GitHub 建置為 macOS 同時產生 DMG 和更新用 ZIP，並發布按架構區分的 `latest-${arch}` 更新清單及 blockmap；所有檔案上傳完成後才公開 Release。CLI、Docker 和未封裝的開發執行仍手動更新。

## Docker

使用者直接用已發布的映像檔：`docker run -d --name amb -p 3600:3600 -v amb-data:/data ghcr.io/modelflare-ai/anymodel-bot`。下面是從原始碼自己建置：

```bash
git submodule update --init --depth 1 vendor/magpie
docker build -t anymodel-bot .
docker run -d --name amb -p 3600:3600 -v amb-data:/data anymodel-bot
docker exec amb cat /data/ui-token     # 開啟 http://<主機>:3600/?token=<權杖>
```

容器內介面監聽 0.0.0.0，因此強制權杖存取。不要把 3600 連接埠直接暴露到公用網路。微信掃碼在 設定 › 聊天管道 裡完成。映像檔裡預設設了 `AMB_ALLOW_LANDLOCK=1`：按預設參數啟動的容器建不了 bubblewrap 要的命名空間，指令改用 Landlock（資料目錄對指令可讀，這時容器本身才是邊界）；加 `-e AMB_ALLOW_LANDLOCK=0` 則在 bubblewrap 用不了時拒絕執行指令。

## 模型（Modelflare）

- 首次啟動只有一個按鈕「登入 / 註冊 Modelflare」：在系統瀏覽器中登入（沒有帳號可當場註冊）並點「繼續」授權，回到本程式後自動為這台電腦簽發一把專用 API Key 並連線 → 選預設模型 → 開始對話。Docker 或遠端部署收不到瀏覽器登入的回呼：登入後瀏覽器會跳到打不開的 `127.0.0.1` 位址，把網址列裡的連結貼回首次啟動頁即可（`POST /amb/api/account/login/complete`，state 和 PKCE 驗證不變）。舊版本填過 API Key、沒有登入的，升級後 Key 會從本機移除，需要重新登入。 瀏覽器中的回呼頁先顯示「正在完成登入」，換權杖、讀帳號、簽發本機 Key、連接閘道全部成功後才顯示「登入成功」（失敗時顯示原因）；桌面版註冊了 `anymodelbot://` 連結，成功頁載入後自動嘗試開啟一次應用程式，「開啟 AnyModelBot」按鈕可以重試，只有應用程式確實收到這次的連結才顯示「已返回」。用自己的 API Key 的頁面下方也能直接用 Modelflare 帳號登入。第一次連接、全域預設模型還空著時，按 `src/account/first-model.ts` 的規則選一次首用模型（支援工具呼叫，單輪預佔和一個代表性任務的花費都在體驗額度內，優先 DeepSeek）；沒有合適的就不預選，讓使用者自己選。
- 登入方式：OIDC 授權碼 + PKCE（RFC 7636），按 RFC 8252 作為原生應用程式——本程式是公共用戶端（`client_id` 為 `anymodel-bot`，沒有也不需要用戶端金鑰），授權結果回呼到本機 `127.0.0.1` 的臨時連接埠。在 Modelflare 網頁個人資料頁的「已授權的應用程式」裡可以隨時撤銷；撤銷後本程式會發現並回到登入頁。
- 帳號認證資料（refresh token）存在資料目錄的 `modelflare-account.json`（權限 600），和內建閘道的 API Key 一樣只靠檔案權限保護，不用系統鑰匙串（0.1.30 及以前桌面版加密過的檔案，第一次讀到時改寫成明文）；介面只拿到帳號名稱。「登出」會撤銷這台電腦的授權，Modelflare 同時刪除登入時為它和各機器人簽發的 Key。
- 餘額：在設定 → 模型 頂部直接顯示帳戶餘額、Bot 額度和剩餘百分比；側欄不再顯示餘額圓環或懸停卡片。「充值」開啟 Modelflare 網頁，進入設定頁面和回到視窗時會重新整理，也可手動重新整理。餘額低於提醒線（預設 1 美元，可改或關閉）時在應用程式裡提醒一次，也可以設定讓機器人發到你的微信 / 飛書。
- 登入後還能在 設定 → 模型 查看按天、按模型的用量，Modelflare 發來的通知，以及複製邀請連結。
- 機器人預算（需要登入）：機器人設定 → 預算，開啟後這個機器人用自己的 Key（內建閘道裡單獨的 provider），最多花設定的美元數；關閉後回到共用的 Key。
- 推理強度：在模型選擇面板或 設定 → 模型 裡選（自動 / 低 / 中 / 高），全域一個，下一輪生效。自動時不發任何參數，用模型預設。只對支援的模型生效：Responses 介面的推理模型、模型資料標了推理的 Chat 和 Claude（Claude 4.6 起用 adaptive + `output_config.effort`，更早的用 `budget_tokens`）。
- 生圖 / 生影片：代理模式下機器人有 `media_models`（可用模型、預設模型、參數範圍、參考價）、`media_docs`（從 docs.modelflare.dev 即時讀該模型的請求格式）、`generate_image`、`generate_video` 四個工具，並內附一份 media 技能說明。各模型的參數格式不同，機器人按文件寫請求體，工作區裡的參考圖寫成 `workspace:路徑` 即可；Key 始終只在本程式裡，由本程式帶著該機器人用的 Key 調 Modelflare，結果存進機器人工作區的 `media/`，再交付到聊天。
- 產生前確認：直接產生，不打擾你。機器人選了不是預設的模型、要求沒說清，都不問：它按最合理的理解產生，再說一句用了什麼。只在預計花費超過 $0.5 時（按參考價、張數、影片時長和解析度估算；影片估不出來也算）先在聊天裡問你這次用哪個模型（附提示詞、參數、參考價和為什麼問）。可以確認、換成別的模型或取消；微信回覆編號或模型名，飛書 / 網頁點選。10 分鐘內沒回答就不產生。想每次都確認：機器人設定 → 生圖 / 生影片 → 產生前確認 →「每次都問」。
- 用作生圖參考（帳號登入；`src/tools/media/capabilities.ts`、`src/imagegen/`、`ui/components/composer.js`）：網頁單聊裡有圖片時，附件統計旁出現預設關閉的「用作生圖參考」切換開關。開啟後本條全部圖片按顯示順序作為參考，由宿主用右下角選的那個精確型號直接建置請求（`images_json` → `/v1/images/edits` JSON，`images_multipart` → multipart，`gemini_native` → `generateContent` 內容塊），不先呼叫聊天模型；選了純圖片生成型號時，純文字直接文生圖。能力只認 `GET /api/connected-app/model-capabilities?line=<line>`（`schema_version: 1`，每個型號的 `authorized`, `available`, `capabilities.{chat,vision,image_generation,reference_images}`, `image_generation.endpoint`, `reference_images.{encoding,max_images,formats,max_image_bytes,max_request_bytes,dimensions}`；三態寫 `supported` / `unsupported` / `unknown`，限制是數字或 `"none"`，`expires_in` 是秒數）。缺失、未知、過期或讀不到時不放行，不按型號名猜。條件不滿足時，輸入欄位外上方的一條驗證條只說最優先的原因，「切換模型」只開啟原選擇器。傳送時綁定帳號、精確型號與線路、有序的內容版本和能力修訂，提交前再復核；先寫 `media/.jobs/ref-<訊息 id>.json` 再提交，結果未知不自動重試。帳號登入時代理的 `generate_image` 也只能用目前所選型號；自訂 Key 原有行為不變。
- 連線上網搜尋：代理的 `web_search` 不用 DeepSeek 內附的搜尋（它要 DeepSeek 的 Key），經 `amb-web-search` 外掛程式交給本程式搜。預設免費、不用設定：依次試 Exa 的公開 MCP、必應、DuckDuckGo，上次成功的先試，出錯的（限流、驗證頁、必應提供不相干的結果）跳過 10 分鐘。設定 → 網路與存取 → 連線上網搜尋 可以換成 Tavily、Exa、博查、智譜（填 Key）或自己的 SearXNG，填了就先用它，出錯時退回免費的。Key 和管道權杖一樣存在本機資料庫裡，代理程序拿不到。桌面版搜尋走系統 Proxy；命令列版用 Node 的 fetch（設 `NODE_USE_ENV_PROXY=1` 後認 `HTTPS_PROXY`）。
- 聊天管道帳號（`src/core/routes.ts`）：微信、飛書、Telegram、Slack、Discord 的帳號也是全域的，在設定 › 聊天管道裡新增，可以起別名。訊息交給哪個機器人：這個人用 `/bot` 選過的 → 帳號的預設機器人 → 第一個機器人。`/bot` 列出機器人，發一次 `/bot 名字` 就切換並記住，之後這個對話一直和它聊。每個機器人的系統提示詞裡都有其他機器人的名單和切換方法，使用者問起時答得上來。名單和主人跟著帳號走，能用這個帳號的人可以和任何機器人聊。帳號的 key 是命名空間：升級前的管道 key 就是原來的機器人 id，登入狀態、配額、名單、佇列都不用搬，預設機器人也是原來那個。刪除機器人不影響帳號。
- 連線應用程式（`src/tools/apps/service.ts`）：全域一份（大頭貼選單 › 應用程式與技能），預設所有機器人都能用，可以按機器人、按工具收窄（機器人設定 › 應用程式）。一個應用程式在應用程式頁只有一張卡片，下面可以有多個帳號，例如對任何機器人說「看我第一個飛書和第二個飛書的訊息」，帳號用工具的 `account` 參數選（序號或名字）。
  - **內建應用程式**（`catalog.ts`）：飛書、騰訊文件、釘釘、高德地圖、語雀、Notion、GitHub、Linear、Atlassian、Canva。驗證方式和自訂連接器是同一套：授權登入（OAuth，動態註冊，`oauth.ts`）、請求標頭、查詢參數、專屬連結；語雀是隨安裝套件帶的本機程式（`vendor/yuque-mcp`，`scripts/vendor-yuque-mcp.mjs` 產生），使用者只貼上 Token。
  - **自訂連接器**：遠端 Streamable HTTP（連不上再試舊式 SSE）或本機指令，最多 20 個。貼上識別和表單 ⇄ JSON 在 `ui/lib/connector-config.js`。本機指令用登入 shell 的 PATH（`shell-path.ts`），第一次要下載軟體套件的（npx、uvx）等得久一些。
  - **由主程式來連**（`mcp-client.ts`，官方 `@modelcontextprotocol/client`）：憑證只在主程式裡，存在 `app-secrets.json`（權限 600，不進資料庫，`secrets.ts`）；`amb-connections` 外掛程式把每次工具呼叫經 bridge 交給本程式。MCP 連線的工具不一個個塞給模型，而是三個固定的工具：`app_tools` 找工具、`app_tool_schema` 看參數、`app_call` 執行，另有 `app_connect` 請使用者去連線（對話裡出卡片，連上後接著做）。
  - **核准**（`service.ts` 的 `gate`，問使用者在 `agent/manager.ts`）：唯讀直接用；寫入按機器人的權限檔位（唯讀機器人不給，預設檔位先問、可以「以後這個工具都允許」，完全權限直接執行）；刪除和對外傳送每次都問；「只觀察」的規則不能寫。工具的類別見 `classify.ts`：內建應用程式用內建的清單和官方標注，自訂連接器的標注只作初值、使用者可改。
  - **現有的 Notion、飛書帳號**（`src/tools/accounts/`）：升級前連好的照舊能用，不用重新授權，權杖在第一次啟動時從資料庫搬到 `app-secrets.json`。Notion（`notion.ts`）選一鍵授權或權杖：權杖走 REST API，一鍵授權用 OAuth + PKCE + 動態註冊、回呼到本機 `/oauth/notion/callback`，再調官方遠端 MCP（`mcp.notion.com`）；模型看到的仍是 `notion_search`、`notion_read_page`、`notion_query_database`、`notion_create_page`、`notion_update_page`，沒有刪除。飛書（`feishu.ts`）的現有帳號用使用者身分唯讀訊息（`feishu_list_chats`、`feishu_read_chat`、`feishu_search_messages`）；新連的飛書帳號走官方遠端 MCP（雲端文件讀寫 + 唯讀訊息），現有帳號重新授權後換成它。
- 預設圖片 / 影片模型：首次設定時和預設文字模型一起選，之後在 設定 → 模型 修改；選「自動」時用推薦順序裡第一個不需要參考素材的模型。
- 模型選擇器裡顯示上下文長度、視覺 / 工具 / 推理能力，以及每百萬 tokens 輸入 / 輸出的起步參考價（來自公開價格目錄，以帳單為準）。
- 性價比（需要登入）：應用程式簽發的 Key（本機 Key 和各機器人的預算 Key）都帶 Modelflare Smart Key 的路由策略 `routing_strategy`——省錢 `low_cost`（倍率最低的分組先試）、均衡 `balanced`（預設，從價格居中的分組開始）、品質 `stable`（倍率最高的先試）。在 設定 → 模型 → 性價比 或模型選擇器的第一個滑塊裡改，改的時候連同已有的 Key 一起改（`PATCH /api/connected-app/api-keys/<id>`），選擇存在本機資料庫（`account.routing`）。沒選過的老使用者第一次核對 Key 時把均衡套用至已有的 Key 上，只這一次（記錄 `applied the default key routing strategy`）。Modelflare 回顯了 `routing_strategy` 才算支援；拒絕（400 / 422）時不帶這個欄位再簽一次，簽發、核對、預算都不會因此失敗，忽略（不回顯）也一樣記為不支援，這時介面不顯示這個設定，一天後再試一次。
- 需求與意見回饋（`src/feedback/`、`src/web/routes/feedback.ts`、`ui/components/feedback.js`、`feedback-forms.js`）：三個分類「使用場景與建議 / 遇到問題 / 企業與合作」，各自的草稿、錯誤和聯繫許可獨立；入口決定預設分類（帳號選單、關於 → 使用場景；錯誤卡、疑難排解 → 問題；發現頁企業分區 → 企業）。本機服務構造並凍結快照（結構化欄位 + 可讀正文 + 機器標籤如 `[contact_consent:true]`，唯讀一次已選的診斷），只按快照 ID 傳送；Modelflare 走 schema 2（`POST /api/connected-app/feedback`，先讀 `GET …/feedback/capabilities`，不支援就阻止建單，不降級到舊協議），每次凍結產生一個提交 ID，逾時 20 秒或回執無效時按同一 ID 查詢（`GET …/feedback/submissions/{id}`）或由本人原樣重試。字數按 Unicode 碼點：主描述 10–4000，自由文字合計 4000，正文 7800。草稿存 `<資料目錄>/feedback-drafts/`（按帳號分檔案、600 權限、7 天清理），聯繫許可不落盤。外部閘道或未登入時只能本機寫草稿，郵件 / GitHub 的副本單獨構造、不帶聯繫方式。
- 模型智慧（模型選擇器的第二個滑塊）：在這個帳號能用、又有 Artificial Analysis 資料的模型裡，按智慧指數（越高越好）和每次任務的花費（越低越好）取帕累托前沿，最多 5 檔，最便宜的和最強的總在。智慧取應用程式實際用的那一檔：走 Responses 介面的推理模型預設發 medium，就用 AA 的 medium 那一行，其餘用 AA 的預設那一行（`src/account/model-quality.ts`）。花費 = AA 的每次任務花費（官方定價）× 這個模型在目前性價比下的價格比例（可用公開分組的倍率 × 售價倍率：省錢取最低，品質取最高，均衡取居中；企業專用分組不算；沒登入或不支援時按均衡估）。拖到哪一檔就把模型換成那個；點模型名進完整清單，照樣手動選，選了不在檔上的模型時滑塊顯示「自訂」。前沿不到兩檔時選擇器直接是清單。演算法在 `ui/lib/frontier.js`。
- AA 資料在儲存庫裡：`assets/model-quality.json`（`updatedAt`、`source`、只留用得到的欄位，已經按 Modelflare 的模型 ID 對應好）。重新整理：`node scripts/update-model-quality.mjs`，預設抓公開排行榜頁面 https://artificialanalysis.ai/leaderboards/models 和 Modelflare 的公開價格目錄；設了 `AA_API_KEY` 時改用官方 API（欄位還沒有拿 Key 核對過）。`--html <檔案>`、`--pricing <檔案>` 用儲存下來的頁面和目錄，`--dry-run` 只列印。頁面結構變了（找不到列、行的形狀不對、數字解析不出來、行數太少、對上的模型太少）時結束碼為 1 並說明是哪一項，原來的快照不動。名字按規則對不上的模型寫在指令碼的 `OVERRIDES` 裡。資料來自 Artificial Analysis，選擇器底部注明出處。
- 呼叫歸因：經 Modelflare 的請求都帶 `X-Modelflare-Skill: anymodel-bot/<版本>`，連結都帶 `utm_source=anymodelbot&utm_campaign=amb_<位置>`（應用程式內 `amb_signup`、`amb_topup`、`amb_console` 等，README 與儲存庫文件 `amb_readme`，官方網站 `amb_homepage`；格式由 `test/utm.unit.test.ts` 固定）。
- API 域名：`https://modelflare.dev/v1`、`https://origin.modelflare.dev/v1` 和 `https://cf.modelflare.dev/v1` 均可選擇。在 設定 → 模型 → API 域名 中選擇，也可手動測速。測速從執行 AnyModelBot 的裝置發起，不帶金鑰存取三個域名的 `/v1/models`，顯示三次探測的回應時間中位數和成功次數；401 表示已收到 API 回應，不代表金鑰有效或模型產生速度。域名不會自動切換；歷史設定 `auto` / `global` 仍指向主域名，`cn` 指向 origin，`cf` 指向 cf，相容值不代表地域或品質差異。
- 設定 → 模型：帳號、餘額與充值、餘額提醒、用量、通知、邀請；性價比、推理強度；預設模型、重新整理模型清單。
- 對話中輸入欄位右側的模型按鈕可為目前對話切換模型（也可設為機器人預設）；`/model`、`/reset`、`/new`、`/status`、`/stop`、`/help` 照常可用。
- 處理過程：代理回合的每一步（模型請求及用時與 tokens、工具呼叫及參數與輸出、重試、子代理）折疊在回覆上方的"用時"一行裡，點開查看；微信 / 飛書對話在資訊面板 → 最近對話裡看，正在處理的那一輪即時顯示並可中止。
- 卡住的訊息：`/stop`（任何管道）或資訊面板裡的「中止」立即結束正在處理的回合；代理 10 分鐘沒有任何進展（模型不回、工具不動、只在重試；等你核准或回答不算）會自動中止，單回合最長 30 分鐘（`AMB_AGENT_IDLE_TIMEOUT_MS`、`AMB_AGENT_TURN_TIMEOUT_MS` 可調）。中止只停這個對話的回合（經代理程序裡的 amb-control 外掛程式取消它），同一機器人的其它對話照常進行；10 秒內沒停下（`AMB_STOP_GRACE_MS`）才重新啟動代理程序。`/status` 顯示它走到了哪一步、多久沒有進展。網頁對話裡切到別的機器人或重新整理視窗不會打斷正在處理的訊息，回來時接著顯示（你的訊息、到目前為止的回覆和處理過程）；停止按鈕在排隊、代理啟動中、等你核準時也能用，純對話也一樣。
- 插話：代理正在處理時又發來的訊息（文字連同圖片 / 檔案）直接併入這一輪，模型在下一步就看到，回覆一起給（先回一句"收到"，經出站佇列發、10 分鐘沒發出去就不再發）；插話同樣先過准入（不在允許名單裡的人發的訊息不會併入）；代理還沒接手或正在收尾時照常排隊，指令（`/model`、`/reset`…）也排隊。網頁對話在回覆進行中同樣可以接著發。
- 長指令轉背景：指令跑過 30 秒（Windows PowerShell 60 秒）就轉成背景任務、不再卡住這一輪，代理先回覆"還在跑"；指令結束時代理被喚醒、拿到結果，回覆作為一條新訊息發到同一個對話（網頁對話即時顯示；微信、飛書和普通回覆一樣經出站佇列傳送：id 由代理對話和回合號推出、只發一次，微信傳送時才查 24 小時視窗和配額，飛書回覆你最近的那則訊息，這則訊息的 id 存在庫裡），處理過程裡能看到背景指令的步驟，`/status`、中止、看門狗都認這一輪。
- 每個對話用自己的模型：同一個代理程序裡各對話各走各的模型和介面（每種介面一個 provider，上下文視窗、最大輸出按模型），換模型不重新啟動代理程序；補丁裡沒列出的模型在執行中補上。
- 換新的代理程序：DSH 的 SDK 關不掉對話，背景任務和每次規則執行的對話都留在代理程序裡，直到它重新啟動（實測一個跑完、空閒的對話多佔約 0.25–0.45 MB）。一個代理程序開過 100 個以上這樣的對話後，等它完全空閒（沒有聊天回合、沒有在跑或收尾的任務和規則、沒有等核准的、沒有在壓縮的對話、程序裡沒有背景指令）就在背景換一個新的；對話照常接著用，不中斷任何東西，使用者看不到。疑難排解的代理狀態裡有 `taskSessions` 和 `recycles`；`AMB_DSH_RECYCLE_SESSIONS` 可改門檻。
- 重新啟動後的提醒：應用程式結束或崩潰時還沒處理完的訊息（每個對話在資料庫裡留一個處理中的標記，處理完就刪），下次啟動時在原對話裡說一次「上次的訊息「…」因為應用程式重新啟動沒有處理完，請重新傳送」，不會自動重發。網頁對話記進對話歷史；微信用存下的 context_token 傳送、佔用同一份回覆配額，超過 24 小時視窗或配額用完時等你在那個對話裡發下一則訊息時先說；飛書發到原單聊。
- 代理的對話介面：代理按 Modelflare 公開目錄裡該模型支援的介面選——有 Responses API 的（GPT-5.4 及以後、Grok 4.5 及以後、DeepSeek V4、GLM-5、Kimi K3 等）走 `/v1/responses`（推理模型預設推理強度 medium，加密推理隨歷史回放）；沒有 Responses、有 Anthropic Messages 的（Claude）走 `/v1/messages`；其餘模型、拿不到目錄時（例如離線）以及外部端點走 Chat Completions。介面按模型在代理程序裡第一次用到它時選定（疑難排解的代理狀態裡顯示最近一輪的 `api` 和程序裡的模型）；`AMB_AGENT_API=chat` 強制全部走 Chat Completions（疑難排解用）。純對話（非代理）仍走 Chat Completions。安全網：某個模型在 Responses / Messages 上的請求被上游拒絕（HTTP 400/404/405/415/422 或「不支援的參數 / 介面」，限流、餘額、權限、上游故障、上下文過長不算）時，這個模型 24 小時內改走 Chat Completions（記在資料目錄的 `dsh/api-fallback.json`，記錄有警告，代理狀態顯示 `openai-completions (fallback: 原因)`）；這一輪如果還沒呼叫過工具，這個對話換到 Chat 上自動重做一遍（不重新啟動代理程序），使用者照常收到回覆，已經呼叫過工具的則照常錯誤、下一輪起走 Chat。
- 內建閘道：magpie 以 `--gateway` 模式執行，使用本程式資料目錄內獨立的 HOME/設定目錄；**不讀取**你電腦上已有的 Claude/Codex 等訂閱認證資料，**不改寫**任何 agent 設定，關閉自動更新與帳號發現。它只供本程序內部呼叫，介面不再反代它的頁面或 `/v1`。
- API Key 只儲存在內建閘道的隔離設定中，不經過命令列參數、不寫記錄，前端只拿到尾號。
- 開發/測試：設定 `AMB_MAGPIE_BASE_URL` 可直接使用一個 OpenAI 相容端點（不啟動內建閘道，介面視為已連線，帳號功能不可用）；`AMB_MODELFLARE_BASE_URL` 可把 Modelflare 基址指向本機 mock，`AMB_MODELFLARE_ISSUER` 把登入與帳號介面指向本機 mock。

## 官方 API Key

- 引導頁的「使用自己的 API Key」和 設定 → 模型 都能填。支援的廠商和位址寫死在 `src/providers/official.ts`，介面（`GET /amb/api/official`、`PUT`/`DELETE /amb/api/official/<id>`）只認表裡的 id，不能填位址。
- 每家是內建閘道裡的一個 provider，id 為 `official-<廠商>`，模型 id 為 `official-<廠商>/<模型>`，和 Modelflare 的同名模型分得開。Key 不經命令列參數：經閘道本機介面的請求體寫入隔離設定。
- 驗證走閘道的模型清單介面（代理、各家的鑒權寫法都在閘道裡），通過才儲存。模型每小時和廠商的清單核對一次，不能對話的（語音、圖片、向量……）不進選擇器。
- 代理的介面按廠商定：OpenAI 走 Responses，Anthropic 走 Messages，其餘走 Chat Completions；上下文、價格、推理能力來自閘道的模型目錄（`/v1/models`）。只有官方 Key 時不讀 Modelflare 的目錄和帳號。
- 走官方 API 的模型不帶 `X-Modelflare-Skill`，不做伺服器端壓縮（壓縮端點來自 Modelflare 的目錄），也不受機器人預算限制（預算是 Modelflare Key 的額度）。生圖、生影片只有連著 Modelflare 時才有。
- 測試：`AMB_OFFICIAL_BASE_URL` 把所有廠商指向本機 mock（`test/official-providers.integration.test.ts`）。

## 介面

- 側欄：機器人清單（大頭貼 + 名稱 + 最近一則訊息），＋ 新增，右鍵 重新命名 / 刪除；清單分成可以新增、改名、刪除、拖曳排序的分組（預設「我的」和「上新」，存在伺服器端，各視窗共用），機器人、群聊和目錄 Bot 可以拖到別的分組或用選單裡的「移到分組」，新上架的目錄 Bot 自動進「上新」；頂部是收起、搜尋和新增三個操作，排程作為文字導覽。左下角大頭貼開啟帳號選單，可進入設定（`⌘/Ctrl+,`）；帳號旁的更新按鈕直接下載或在準備好後重新啟動更新。
- 群聊（`src/core/groups.ts`、`ui/screens/group.js`）：有兩個以上機器人時，＋ 選單裡可以建群。每個成員在群裡有自己的對話 `<機器人>:web:group:<群>`，模型、權限、記憶、核准、花費都和單聊走同一條路；使用者的話存在對話 `group:<群>`，時間線由這些訊息按 id 合併。@ 誰誰答（`@所有人` 全員），沒 @ 時上一個回答的接著答；機器人回覆裡 @ 別的成員就接力，一條使用者訊息最多接力 6 次。同一個群一次只有一個機器人在答。
- 對話頁：頂部懸浮的機器人名稱膠囊開啟資訊面板（`⌘/Ctrl+⇧+I`：預設由它回覆的管道帳號、待核准、任務和規則、記憶、最近對話，⚙ 進機器人設定）；回覆串流顯示（Markdown、程式碼塊一鍵複製），可隨時停止（`Esc`）；核准與提問以卡片形式出現在對話裡；向上翻閱時不會被拉回底部。
- 指令面板 `⌘/Ctrl+K`；外觀（跟隨系統 / 淺色 / 深色）在 設定 → 一般。
- 語言：簡體中文 / 繁體中文（台灣） / English / 日本語 / 한국어 / Русский / Español / Português (Brasil) / Türkçe，設定 → 一般 → 語言（引導頁右上角、指令面板裡也能切），預設跟隨系統（系統語言不在已支援語言中時用英文）。偏好存在 config.json 的 `ui.lang`，系統匣選單、伺服器端錯誤和狀態文字、機器人發到微信 / 飛書的系統訊息（`/help`、核准提示等）都跟著它；命令列 / Docker 下"跟隨系統"看 `AMB_LANG`，再看 `LC_ALL` / `LC_MESSAGES` / `LANG`，都沒有時用簡體中文。記錄、發給模型的提示詞和使用者自己起的機器人名不翻譯。
  - 台灣的系統偏好（`zh-TW`、`zh-Hant`）會自動選用繁體中文。命令列和 Docker 可透過 `AMB_LANG=zh-TW` 指定語言。
  - 介面文案在 `ui/locales/<語言>/<命名空間>.js`，程式碼裡寫 `t("命名空間.鍵", { 參數 })`（`ui/lib/i18n.js`）；伺服器端在 `src/i18n/messages/<命名空間>.ts`，鍵有類型檢查。每個介面請求帶 `x-amb-lang`，伺服器端在這個請求裡用同一種語言回話。
  - 新增文案須補齊本次發布的所有目標語言；`node scripts/i18n-check.mjs [檔案…]` 檢查介面程式碼裡有沒有漏掉的中文、用到的鍵在不在、全部語言詞典是否對齊（`npm test` 裡的 `test/i18n.unit.test.ts` 也會查）。確需留在程式碼裡的中文（字型名、匹配中文輸入的正則）在那一行寫 `// i18n-ignore`。
- 入門清單（新手引導）：對話空狀態裡是 6 步清單——打招呼、換模型、接到微信、讓它動手、讓它記住你、產生一張圖。最後一步在引導裡只放預置示範，不管帳號有沒有圖片 / 影片模型都一樣：和真的預設流程一樣直接產生、圖片顯示在對話裡，但不發給機器人、不呼叫模型、不扣費，圖是用戶端內附的 `ui/assets/guide-demo.svg`。目的是教會怎麼操作，不替使用者花錢；之後真的讓它畫圖、收到圖片也會算完成這一步。點「傳送這句」直接試，點「帶我去」或側欄左下角的清單入口，會有一張引導卡片指著要點的地方（那裡亮一圈）。做完自動打勾：對話裡有了回覆、換了模型、收到檔案 / 圖片、管道連上、記憶寫入；進度存在 config.json 的 `ui.guide`（介面 `/amb/api/guide`），老使用者已經做過的步驟會自動算完成。清單可以收起到左下角或「不再顯示」，設定 → 一般 → 入門清單 可以重新開始。 打招呼要有一條真正的回覆（出錯提示不算），管道要真的連上（只填了設定不算）；「連線常用聊天工具」這一步可以選微信、飛書、Telegram、Slack、Discord，介面語言只決定推薦哪個。明確說「記住……」時回合後的記憶整理會馬上做，不用等 90 秒。進度按使用者分開存（登入了 Modelflare 按帳號，存在 KV 的 `guide.owner.*`；沒登入時仍寫 config.json 的 `ui.guide`），全部做完是一個里程碑，之後自動收起、不再出現；自動顯示的引導卡片在輸入欄位有草稿或任務執行階段先不出來。
- 視覺：中性色與元件改編自 magpie 的介面（MIT），強調色為 Modelflare 螢光黃綠 `#d7ff00`。設計系統說明見 `ui/design/README.md`。

### 文件與網站預覽

訊息裡的檔案卡片、圖片（含 Markdown 圖片）、HTTP(S) 連結和本機檔案連結會開啟右側「預覽」。普通對話、專業 Bot、群聊與歷史訊息共用入口；每個機器人一套標籤，群聊、歷史訊息搜尋結果各一套，最多 12 個，重新啟動後清除。面板從上到下是標籤行（類型圖示、右鍵選單、「+」列出本對話交付的檔案）、檔案資訊行（檔名、桌面版的在資料夾中顯示、輔助資訊、檢視切換、「⋯」）和內容區。「預覽」有標籤時面板用寬尺寸（和工作台共用 `prefs.workW`），頂欄的「放大」鋪滿整個應用程式視窗。檢視切換、內容縮放、自動換行記在本機（`ui/lib/preview-prefs.js`）。按 Ctrl/⌘ 點選網頁連結仍使用瀏覽器的新分頁。

支援 Markdown（圖片、任務清單、大綱、原文）、程式碼與純文字（行號、著色、自動換行）、JSON（格式化、折疊）、CSV / TSV（表格、排序、搜尋、編碼切換）、HTML（預覽 / 原始碼）、圖片（縮放、拖曳）、PDF 和網址。文字超過 2 MB 只顯示前 2 MB（保留完整的行），CSV 讀前 10 MB、表格最多顯示 5 萬行；文字按 UTF-8、帶 BOM 的 UTF-8、GBK 自動識別，也能按指定編碼重讀。Office 等不支援的格式、空檔案、超過 32 MB 的網頁各有狀態和按鈕。著色用隨介面封裝的 highlight.js（只含約 30 種語言，`ui/vendor/hljs/`，由 `scripts/vendor-hljs.mjs` 從開發依賴複製）。外部網頁使用隔離 iframe，網站可能禁止嵌入或要求登入，此時使用「在瀏覽器中開啟 ↗」。不會通過反向代理繞過網站的嵌入限制。

檔案讀取沿用 `resolveFile` 的工作區/已交付檔案邊界。`GET /amb/api/conversations/:id/file/preview?path=&encoding=` 返回預覽描述（`kind`：text / html / image / pdf / empty / unsupported / tooLarge，文字帶 `encoding`、`truncated`、`totalLines`），普通檔案介面加 `download=1` 強制下載；桌面版 `POST …/file/save` 顯示系統儲存對話方塊（`DesktopHooks.saveFileAs`），`POST …/file/browser` 用系統預設瀏覽器開啟 HTML（`DesktopHooks.openFileInBrowser`）。`GET /amb/api/delivered-files?conv=` 列出本對話交付的檔案；`GET /amb/api/preview-watch?t=` 是已開啟標籤的檔案變化推播（`src/web/preview-watch.ts`：簽名穩定 1 秒後才報，先刪再寫不報消失）。產生的 HTML 經 `src/web/file-previews.ts` 獲得 1 小時有效的隨機存取位址（標籤開著時介面經 `POST /amb/api/preview-grants/renew` 續期）；不必控制台 Cookie，只能載入入口檔案所在目錄內的允許類型資源（網頁、樣式、指令碼、圖片、字型、音訊與視訊），單個資源上限 32 MB。預覽的網頁按不可信內容對待：只有指令碼和字型帶 CORS（ES 模組、`@font-face` 在不透明來源裡沒有它載入不了），其餘資源只能顯示，頁面指令碼讀不到內容（`connect-src 'none'`，不能 `fetch` / XHR，畫布讀不回圖片像素）；JSON 等資料檔案不提供，頁面要用的資料請內聯進 HTML 或寫成指令碼。目錄外、跨機器人、符號連結越界、硬連結和可執行附件均不開放；工作區外已交付的 HTML 只開放入口檔案。HTML 使用不透明來源沙箱，可以載入相對 CSS、JS、圖片及 HTTPS 靜態資源，但不能存取控制台 API、父頁面、表單提交或子框架；頁面裡注入的小指令碼把連結點選報給面板（同目錄的網頁新開標籤，外部連結用系統瀏覽器 / 新分頁）。開發伺服器、依賴後端介面的完整應用程式應通過外部網頁入口存取。

預覽狀態與公共入口在 `ui/lib/resource-preview.js`，展示在 `ui/screens/resource-preview.js`（程式碼檢視、CSV 表格、圖片分別在 `ui/components/code-view.js`、`csv-view.js`、`image-view.js`，純函式在 `ui/lib/preview-types.js`）。桌面版的 ⌘W / Ctrl+W 和內容縮放快速鍵由 `electron/main.ts` 先問介面（焦點在預覽面板時才處理）。專業 Bot 的 `openFile`、`openUrl` 也進入該面板，仍保留使用者點選/位址確認約束，檔案權限仍限於 `app/`。

### 0.1.33：排程規則與機器人範本

側欄時鐘開啟所有機器人的「排程」頁。表單預設使用該機器人的桌面對話，支援先關閉；範本規則可暫不設定投遞位置，啟用時補選。聊天建立與修改的規則會附帶卡片，撤銷建立有 10 分鐘還原視窗；後續修改會使舊卡的撤銷失效。排程、預算和撤銷由 `src/tasks/` 統一管理，API 在 `src/web/routes/tasks.ts`。

日曆類規則的補跑寬限最長 12 小時，每隔類不補跑；啟動或喚醒約一分鐘後只補最近一次。群日報讀取所選群的訊息，跨天補跑使用原定日期與截止時間。macOS 權限卡片保留原對話和草稿，授權後接著執行未完成步驟；已經發過新訊息或等待超過 30 分鐘時改為手動繼續。完整行為見[排程規則設計](./design/background-tasks-and-proactive.md)。

10 個範本的資料在 `ui/data/bot-templates.json`，各語言文案在 `ui/locales/<語言>/templates.json`，建立流程在 `src/templates/`。範本只負責預置人設、可選記憶和未啟用的規則，不擴大工具權限；模型選擇保留使用者決定。

### 多語言文案與發布檢查

譯文由維護者逐項撰寫和本土化，不使用翻譯介面。產品名、模型 ID、指令、URL 和 `{placeholder}` 參數保留原樣。

- 應用程式：`ui/locales/<語言>/<模組>.js`；伺服器端新增語言：`src/i18n/locales/<語言>/<模組>.ts`。
- 官方網站：`site/src/i18n/locales/<語言>/`，例如 `home/hero.ts` 對應 `home.hero.*`。頁面從詞典讀取文案。
- `ui/locales/manifest.json` 登記目標語言及 `ready` 狀態；官方網站儲存同內容的 `site/src/i18n/manifest.json`，檢查會驗證兩份一致。未完成的語言保持 `ready: false`，不加入正式選單和搜尋引擎語言標記。
- `npm run i18n:status` 查看逐語言、逐模組進度；`npm run i18n:check` 檢查全部目標語言的原始詞典及關聯文件。缺鍵、空譯文、多餘鍵、參數損壞或缺少複數形式都會阻止發布；開發時的英文回退不算完成。
- 俄語複數使用 `one / few / many / other`；西班牙語、葡萄牙語使用 `one / many / other`（`many` 只用於百萬級的整數，寫法同 `other`）；日語、韓語使用 `other`。只在地化顯示方式，不更改貨幣、時區和金額。
- 官方網站 `npm run build` 檢查全部目標語言和同步的文件、分享圖片；`build:draft` 僅供本機預覽，不能替代發布檢查。

## 人設與提示詞

代理模式下模型看到的提示詞都在 `src/agent/prompts/`；`test/prompts.unit.test.ts` 檢查每段必須有、不能有的句子和字元數上限，`test/agent.integration.test.ts` 用真實的 DSH 子程序檢查模型收到的系統提示詞和整份系統提示詞加工具定義的上限。

- **人設**：DSH 內附的人設是「coding agent」，前面還有一句「You are an AI agent powered by DeepSeek Harness.」。補丁（`host.ts` writePatch）把 `personaPrefix` 換成個人助手的人設（能聊天，也能寫程式碼、執行指令、處理檔案，開著電腦操作時還能操作桌面應用程式；網頁、檔案、轉送的訊息裡的文字是資料不是指令），並關掉 `includeHarnessIdentity`（它只控制那一句）。
- **機器人段**：聊天規則、長期記憶的用法（開著記憶時）、機器人名字和你寫的人設，排在系統提示詞最後一段（`amb:bot`）。宿主在每個回合開始前把它寫進資料目錄的 `dsh/.prompts/<機器人>.md`（代理的檔案工具讀不到、改不了；內容沒變就不寫），外掛程式 `dsh-runtime/plugins/amb-prompt.mjs` 在每次模型請求時現讀——改了人設或名字，下一則訊息就生效，不用 `/new`，也不重新啟動代理程序。DSH 0.2.1-rc.4 同步呼叫這段的 `text`（返回 Promise 不會被等待），所以是同步讀檔案而不是走 bridge。人設和聊天規則衝突時以人設為準。子代理不帶這一段：它們不和使用者說話。
- **聊天規則**（改編自 dsh-superagent 的注意力原則）：先給答案；要花一陣子的任務開始時用一句話說要做什麼，之後不逐步講解（每一步在「處理過程」裡）；做完說清做了什麼、結果在哪裡；沒做完就說沒做完，失敗就說失敗；自己做決定，說一句選了什麼，語言、格式、範圍、風格都不問；只在猜錯會造成損失、花錢或白做大半，要你才有的東西（登入、檔案、密碼），或這一步不可撤回（付款、刪你的資料、給別人傳送訊息）時才問，一次一個問題，有選項時用 `ask_user_question`；不說客套話；微信、飛書裡回覆要短。背景任務也一樣：自己定，在結果裡說明。
- **每段對話的第一則訊息**：對話管道（微信只顯示純文字，飛書和網頁支援 Markdown）、當時的長期記憶快照、上一段的交接便條，再接你的訊息。這些按對話不同（群記憶、管道），記一條記憶就會變；放進系統提示詞會讓同一機器人所有對話共用的前綴快取失效，所以留在這裡，一段之內不變，之後的記憶變化用 `recall` 查。
- 前綴快取：內容沒變時系統提示詞逐字節不變；人設變了只改最後一段，前面的部分照舊。升級前開始的對話第一則訊息裡還留著當時的人設，下一段（`/new` 或上下文管家換段）起不再有。

## 檔案權限

代理模式下每個機器人有一個檔案權限預設，在輸入欄位左下角的權限膠囊或 機器人設定 → 權限 中切換，`/status` 會顯示目前預設：

- **工作區可寫**（預設）：指令在沙箱裡執行，只能改這個機器人的工作區；越界操作先在聊天裡問你。
- **唯讀**：不能改檔案，指令在唯讀沙箱裡執行。
- **完全權限**：給熟悉風險、嫌核准太多的使用者。指令**不經沙箱**，以你的使用者身分直接執行，越界操作不再請求核准——它可以讀取和修改你電腦上的任何檔案，包括 AnyModelBot 自己的資料目錄（資料庫、管道權杖、金鑰）。只有**遞迴刪除**仍會先問你（同一套核准：微信回覆編號、飛書 / 網頁卡片）：`rm -r` / `-rf` / `--recursive`（含 `sudo`、`xargs`、`sh -c` 裡的）、`find -delete`、`git clean`、`rsync --delete`，PowerShell 的 `Remove-Item` / `rm` / `del` / `rd` / `rmdir` 加 `-Recurse`（及其縮寫），cmd 的 `rd /s`、`del /s`，`robocopy /MIR`，以及 Python `shutil.rmtree`、Node `fs.rm(…, { recursive })` 等常見寫法；指令裡點名的指令碼檔案也會檢查。選它時介面會先顯示確認，權限膠囊和設定頁面用紅色標出。
  - 這是防誤刪的保險，不是安全邊界：檢查的是指令文字，執行階段才拼出來的指令（`eval "$(…)"`、`curl … | sh`）和 `make clean`、`npm run clean` 這類建置指令碼看不到；不確定時寧可多問。只在你信任目前模型和任務時開啟。
- **工作資料夾**（桌面版，輸入欄位上方）：每則訊息綁定傳送時選的資料夾，這一輪裡它是代理的工作目錄和唯一的可寫位置（`amb-workfolder` 外掛程式改寫沙箱策略的工作區根，檔案工具和 Linux bubblewrap、macOS Seatbelt、Windows ACL 的指令沙箱都按它），預設工作區在這一輪唯讀；不選時回到預設工作區。資料目錄及其上層、磁碟根、主目錄本身不能選。ZIP 附件只經 `zip_list` / `zip_extract` 由宿主查看和安全解壓縮（`src/attachments/unzip.ts`：只認 Stored / Deflate，拒絕加密、分卷、越界路徑、連結和超限），預設解到工作區的 `extracted/`，隨附件到期回收。Windows 上 DSH 的指令沙箱會給用作可寫根的資料夾加一條常駐的寫權限 ACE。

## 誰能使用機器人

代理執行於你自己的電腦上（甚至可能是完全權限），所以預設**只有主人和你允許的人**能和機器人對話。按管道帳號分開算，能用這個帳號的人可以和任何機器人聊（`src/core/access.ts`）：

- **主人**：微信是掃碼登入的那個微信；飛書不管是掃碼建立應用程式還是填 App ID / App Secret，連上之後**第一個給機器人發單聊訊息的人**就是主人（先到先得）——連上後用你自己的飛書給機器人發一句話就完成綁定，這則訊息照常回覆。掃碼時沒拿到掃碼者的微信也一樣。機器人設定 → 誰能使用 裡顯示飛書主人，點「更換」（要確認）清掉主人，下一個傳送訊息的人成為主人；換一個飛書應用程式或斷開飛書時也會清掉。拒絕過的人不會成為主人。本機的網頁對話不受限制。
- **其他人**傳送訊息：只收到一句「你還沒有被允許使用這個機器人，已通知主人」（同一個人每小時最多一次），不進佇列、不呼叫模型、不花錢。請求出現在 設定 › 聊天管道 裡這個帳號的「管理」（允許 / 拒絕），也會帶 4 位配對碼發給主人（每個帳號每小時最多 3 條；主人 24 小時內在那個管道說過話才發得出去），主人在聊天裡回覆「同意 1234」/「拒絕 1234」即可。配對碼不會和工具核准的編號撞。被拒絕的人之後發什麼都不回。
- 允許名單在 設定 › 聊天管道 裡這個帳號的「管理」，可以移除（移除後他再傳送訊息會重新申請）；`/status` 也會顯示。
- 升級時，已經和機器人有單聊對話的人自動加入允許名單（標為「升級前已在使用」），不會被攔在外面；換一個微信重新掃碼時，原來的主人也留在名單裡。
- 群聊：目前沒有管道連接群聊（飛書只處理單聊，微信 iLink 沒有群），群訊息不受名單限制、保持原樣；連接群聊時要在 `access.ts` 裡補規則。

## 訊息不會丟

最終回覆、交付的檔案、核准提示和通知先寫進本機資料庫的出站佇列再傳送（`src/core/outbox.ts`；串流卡片的中間內容和「正在輸入」除外）：

- 同一對話按順序一條一條發；網路或平台臨時出錯時自動重試（5 秒起，逐步拉長到 5 分鐘），管道沒連上時等它連上。
- 應用程式結束或崩潰後，重新啟動時接著發，已經發出去的不會再發（長回覆分段發，從沒發的那段接著發）。每則訊息的 id 由收到的那則訊息推出來，同一則訊息被平台重複投遞也只有一個最終回覆；只有恰好在傳送途中崩潰的那一段可能再發一次——它帶著固定的飛書 `uuid`（飛書 1 小時內去重）和微信 `client_id`。
- 微信只能在對方 24 小時內發過訊息時回覆，每則訊息之後最多回 10 條。這時發不了的訊息不丟，先留著（held），等對方下次傳送訊息時先發出去：幾條文字合成一條「你不在時：…」（一條微信放得下就合，檔案照原樣），排在這次的回覆前面，順序不變、只發一次。留著的最多 7 天；「收到」、核准提示這類過一會兒就沒意義的照舊按自己的期限。
- 再也發不出去的（平台多次拒絕、等待太久）標記出來並寫明原因，記在記錄和診斷資訊裡。

## 背景任務和規則

要跑一陣子的事在背景做，不佔聊天（設計見 `docs/design/background-tasks-and-proactive.md`，程式碼在 `src/tasks/`）：

- **背景任務**：聊天代理用 `task_start` 開一個任務（自己的 DSH 對話 `task-<id>` 和工作區裡的資料夾 `tasks/<名字>-<id6>/`），一句話說清在背景做什麼；做完把結果發回原對話（微信引用、飛書回覆那則訊息可以接著問）。中途要問你的，一個對話一次只推一個問題。應用程式重新啟動後接著做，已經做過的外部動作先查再做。`/tasks` 列出任務和規則，`/stop 編號` 停一個。
- **規則**：`rule_create` 或 機器人設定 › 主動訊息 › 規則 建好，直接執行：你的原話就是授權，到點去查，有值得說的才發一句；改了原話也照樣執行。觀察要自己選（跟機器人說「先觀察」，或在規則編輯器裡選觀察）：唯讀，不傳送訊息，只記「本會傳送」，好好觀察 3 次後在「需要你」裡問要不要改為執行。每次執行一個新對話，執行記錄可以匯出成 Markdown。
- **任務庫**：「排程」頁的「任務庫」裡有 20 條現成的排程任務（行業早報、出門天氣、繳費提醒……），挑一條、填一兩項、選好機器人和發到哪裡就能開啟；檢查類可以先試一次（唯讀，結果只在快顯視窗和執行記錄裡，不發出去，花費計入本月）。開啟後就是一條普通規則，多記下來源（任務 id、版本、參數），任務庫來的檢查可以發多行的簡報（最多 1500 字，管道裡超長時截斷）。也可以直接對機器人說「用任務庫裡的出門天氣提醒，城市上海」（工具 `routine_library`）。任務資料在 `ui/data/routine-library.json`，各語言文案在 `ui/locales/<語言>/routineLibrary.json`，原話的拼法和時間表在 `src/tasks/library.ts`，介面在 `src/web/routes/routines.ts`。
- **看得到、不打擾**：資訊面板的「任務」組列著這個機器人的任務和規則（結束了的收在「已結束」裡），點開看來自哪、最新進展、預算、資料夾和每次執行的處理過程；所有在等你的事在側欄的「需要你」裡。只推結果、要你決定的事和失敗；免打擾（預設 22:00–08:00）、每天上限（微信 3 條、飛書 5 條）、合併成摘要都在 機器人設定 › 主動訊息。
- **預算**：任務預設 $1，規則每次 $0.10、每月 $3（估算，按 Modelflare 的參考價）。用完時停下問你；任務詳情裡能改任務的預算，規則編輯器裡能改規則的。機器人的預算 Key 剩不到 20% 時停背景工作，留給聊天。
- **暫停**：機器人設定 › 主動訊息 › 暫停背景工作（或跟機器人說），任務和規則先停、主動訊息排著，聊天照常。
- **保留與清理**：任務和執行記錄留 30 天，30 天沒動過的任務封存。任務資料夾 30 天沒動過就刪除，連同 DSH 裡它的對話記錄（`dsh/<機器人>/sessions/` 下；SDK 沒有刪對話的介面，由應用程式直接刪，對話還開在代理程序裡的等程序換過再刪）；不問你、不發通知：第 27 天定下刪除的日期，任務詳情裡寫著，可以保留（至少 3 天後才刪）。任務詳情裡能看到資料夾多大，也能直接刪掉任務（連同資料夾）。

## 關於我與機器人之間傳送訊息

- 關於我（`src/agent/about-me.ts`，存在 `memory/about-me.json`）：所有機器人共用、關於你本人的事，由原來的團隊記憶改名而來，升級時原樣搬進來（來源標「原團隊記憶」）。機器人在你本人的對話裡（應用程式裡的全部對話、管道裡主人的單聊）用 `remember` / `forget` 的 `scope: me` 讀寫，關著長期記憶的機器人不讀不寫；一次回覆最多記 3 句，位址、電話、電子信箱先出確認卡，證件號、銀行卡號和密碼類不存；你改過的句子帶鎖，機器人只能出建議卡；你刪掉的進「不再記回」名單（用小模型判斷換了說法的同一件事，名單不給模型看），親口說「記住……」才重新記。變更歷史保留 30 天，句子還保持那次變更後的樣子時可以撤銷。已開著的對話在下一則訊息前面帶上新內容；回合後的自動整理不再記你本人的事。介面：設定 › 關於我、對話裡的提示行和卡片（`ui/components/about-me.js`），通訊軟體裡提示行寫在回覆後面，回「撤銷」撤回。
- 機器人之間傳送訊息（`src/collab/service.ts`、`src/store/collab.ts`）：你在 A 的應用程式單聊裡說「交給 B」，A 用 `message_bot` 發出（`dsh-runtime/plugins/amb-collab.mjs`）。服務層檢查已登入 Modelflare、A 和 B 目前都是 Modelflare 模型（不是自己的 API Key）、你點了 B 的名字或對 A 的建議說了好、一條使用者訊息一件、和 B 正在做的不重複、每天上限。B 做事是 B 名下的一個背景任務（`tasks.handoff_id`），名額、預算、時長上限、核准（以 B 的名義出現在 A 的對話裡，12 小時）和重新啟動還原都走任務那一套；任務、規則對話和子代理裡沒有這兩個工具，所以只發一層。B 用 `task_report` 回訊息後，A 在 `runtime.collabTurn` 裡核對（這一輪不併入新訊息，A 調 `bot_request` 讓 B 重做時這一輪的話不存），匯總後回覆你。兩人對話是一對機器人之間往來的唯讀記錄。設定 › 機器人協作：總切換開關、每件花費、時長、每天件數、重做次數。

## 電腦操作（Computer Use）

每個機器人可在 機器人設定（資訊面板的 ⚙）→ 電腦操作 中切換開關、選擇後端和核准方式；`/status` 與設定頁面會顯示目前後端、是否可用及原因。

- **後端**
  - **Cua Driver（預設，三平台）**：隨安裝套件附帶官方預編譯的 [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) 0.37.0（MIT），建置時由 `scripts/fetch-cua-driver.mjs` 按平台/架構下載並驗證 SHA256。作為內建 MCP 伺服器 `cua-driver mcp` 執行，始終使用 `CUA_DRIVER_PERMISSION_MODE=bounded` + 能力清單，**從不**使用 `--dangerously-bypass-approvals`；子程序環境經過清理，不傳任何金鑰，關閉遙測，停用 `run_script`。只開放所需的 24 個工具（讀取視窗/螢幕截圖、啟動應用程式、點選、輸入、按鍵、組合鍵、滾動、拖曳、設值、選單等），其餘工具（指令碼、結束程序、剪貼簿、瀏覽器注入、錄製、更新等）對模型不可見且會被拒絕。清單列出本機已安裝的圖形應用程式（Linux 讀 .desktop、macOS 讀 /Applications、Windows 讀開始選單），並允許整屏輸入；清單最長 24 小時有效，到期前自動重新啟動驅動。
  - **Codex Computer Use 橋（可選，僅 macOS）**：kimi-computer-use，需要本機已安裝 OpenAI Codex Computer Use；不可用時自動回退到 Cua Driver。
- **核准**：預設所有電腦操作（讀取、螢幕截圖、點選、輸入、按鍵、滾動、拖曳、設值）**自動執行，不必核准**；可選「點選、輸入等改變介面的操作先問我」（讀取介面仍自動）。升級時已有機器人（含預設機器人）會被移轉為自動執行。權限預設為「唯讀」的機器人只開放讀取類工具。
- **平台說明**
  - macOS：需在「系統設定 → 隱私與安全性」中給本應用程式授予「輔助功能」與「螢幕錄製」權限；以 `--direct` 方式執行驅動（尚未在真機驗證）。 缺這兩項時，機器人呼叫電腦操作工具會被攔下，這一輪結束並說明「因缺少權限未能繼續」，對話裡按缺的那一項顯示授權卡片（系統原生請求、開啟對應的系統設定頁、重新偵測；螢幕錄製改完通常要重新開啟應用程式，卡片上可以直接重新開啟，輸入欄位裡的草稿會帶回來）。首次啟動不索要任何權限。
  - Linux：X11 下通過 AT-SPI 讀取介面（需要 at-spi2-core，應用程式需開啟無障礙）；Wayland 會降級——只能操作 XWayland 應用程式的前景視窗，介面會提供提示。沒有圖形對話（DISPLAY/WAYLAND_DISPLAY）時不可用。
  - Windows：必須在已登入使用者的互動式桌面對話中執行（服務/排程任務的非互動對話不可用）。
- 螢幕截圖只發給（支援視覺的）模型使用，不會被轉送到微信/飛書聊天中；只有使用者要求時才會作為檔案傳送。
- 未封裝：cua-perception、OmniParser（AGPL）以及任何 Cua Spaces（FSL）元件。

## 飛書應用程式設定

最省事的辦法：設定 › 聊天管道 → 飛書 →「連線」，用飛書掃碼，自動建立機器人應用程式，然後在飛書裡給它發則訊息。

想用已有的企業自建應用程式，點「用已有應用程式」，按下面的步驟設定：

1. 開啟 [飛書開放平台](https://open.feishu.cn/app) → 建立企業自建應用程式，新增「機器人」能力。
2. 權限管理開通：
   - `im:message.p2p_msg:readonly`（讀取使用者發給機器人的單聊訊息）
   - `im:message:send_as_bot`（以應用程式身分傳送訊息）
   - `cardkit:card:write`（建立與更新卡片，用於串流回覆）
   - `im:message.history:readonly`（讀取對話歷史訊息：飛書持續連線不補推離線時發來的訊息，程式啟動、斷線重連時從歷史裡補上 7 天內有過來往的單聊裡、24 小時內的訊息，每個對話最多 20 條；沒開也能用，只是補不上，會提示一次）
3. 先在本程式 設定 › 聊天管道 → 飛書 →「連線」→「改用已有應用程式」裡填入 App ID / App Secret 並儲存（持續連線需要程式線上才能儲存下一步）。
4. 事件與回呼 → 訂閱方式選「**使用持續連線接收事件**」，新增事件 `im.message.receive_v1`。
5. 發布版本並在可用範圍內新增自己，然後用你自己的飛書私聊機器人發一句話：連上後第一個傳送訊息的人就是飛書主人（見「誰能使用機器人」）。

說明：目前只處理單聊（p2p），群聊訊息會被忽略。

## 微信（iLink）

- 設定 › 聊天管道 → 微信 →「連線」，用微信掃描QR Code並確認；或命令列 `npm run weixin:login`（終端機顯示QR Code，同時儲存 PNG 到資料目錄）。
- 登入狀態、同步游標、context_token 儲存在資料目錄，重新啟動後自動續用。
- 平台限制：使用者每發來一則訊息後 24 小時內最多可回覆 10 條；回覆在產生結束後一次發出，超過 4000 字自動分段；產生期間顯示「正在輸入」。
- 圖片、檔案、影片：使用者發來（或引用）的會從微信 CDN 下載解密（單個最大 50 MB）。代理模式下存進機器人工作區的 `inbox/`，訊息裡寫明路徑，代理可以讀取、處理或當生圖的參考圖；能看圖的模型（Claude、GPT-5/6、Gemini、Grok 4、Kimi K3、Muse Spark 等）同時直接收到圖片本身，其餘模型只拿到路徑。Linux 版代理暫不直接收圖（sharp 在 Electron 下會崩潰），只給路徑。機器人交付的檔案（present）按圖片或檔案發回微信。
- 登入過期（錯誤碼 -14）時自動暫停並在介面提示，重新掃碼即可。

## 開發與測試

```bash
npm run typecheck
npm test            # 單元測試 + 離線端到端（模擬飛書/iLink/Modelflare，含串流對話與停止）+ 內建閘道整合測試（需已編譯 magpie）
npm run docs:check  # README 自檢：素材是否存在與體積、中英文結構一致、相對連結與錨點、停用詞、alt
```

README 的素材清單與錄製規範見 [docs/assets/README.md](./assets/README.md)。

目錄 Bot（帶專屬介面的預製 Bot）的開發見 [docs/bot-framework.md](./bot-framework_zh-TW.md)。

## 許可

MIT，見 `LICENSE`；第三方元件（magpie MIT——含介面樣式改編、Tencent openclaw-weixin MIT 等）見 `THIRD_PARTY_NOTICES.md`，也可在 設定 → 關於 中查看。

## 使用者技能與聊天記錄搜尋

使用者入口與 ZIP 格式見[技能使用說明](./skills_zh-TW.md)。`src/skills/archive.ts` 驗證 ZIP 路徑、解壓縮上限和 `SKILL.md`，`service.ts` 按機器人儲存包、啟用狀態和版本指紋；`src/web/skills.ts` 提供預覽與管理介面。DSH 空閒後部署啟用項，變更不會中斷執行中的回合、子代理或背景指令。`src/botkit/installer.ts` 在目錄 Bot 升級時檢查使用者技能重名。

「我的技能庫」：`src/skills/library.ts` 儲存從本機匯入和登記進庫的項目（`skill-library/`，按內容摘要存包，機器人只記切換開關）；`UserSkills.libraryView` 把各機器人裝的舊技能、「我存的」合進同一份索引，舊技能加到別的機器人或所在機器人被刪時才登記進庫。`src/skills/local-import.ts` 負責本機發現（六個自動根、手選資料夾、連結邊界）、預覽驗證（呼叫限制、私人檔案、平台變數、同內容判定）和逐項匯入（請求號冪等、預覽後變化不寫）；介面在 `src/web/routes/skill-library.ts`，只在本機回環存取的桌面版裡開放尋找。

`src/store/chat-search.ts` 在 SQLite 中維護訊息搜尋索引，提供過濾、分頁與原訊息上下文；`ui/screens/message-search.js` 是全域搜尋，`ui/components/chat-search.js` 負責目前聊天尋找。搜尋直接讀取本機資料庫，不經過模型。

相關測試：`test/skills*.test.ts`、`test/chat-search*.test.ts`。瀏覽器驗收可使用 `AMB_TEST_CHROME` 指定 Chromium 路徑；有 DSH 執行階段時還會驗證技能發現、載入、資源讀取及執行中停用。
