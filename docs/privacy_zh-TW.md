# 資料與隱私

[简体中文](./privacy.md) | 繁體中文（台灣） | [English](./privacy_en.md) | [日本語](./privacy_ja.md) | [한국어](./privacy_ko.md) | [Русский](./privacy_ru.md) | [Español](./privacy_es.md) | [Português (Brasil)](./privacy_pt.md) | [Türkçe](./privacy_tr.md)

**一句話結論：** 對話、記憶、檔案和金鑰存在你的裝置上；發給模型的內容會發到你選定的模型供應商：用官方 API Key 時直連，否則經過 Modelflare 轉送。我們不聲稱能做到萬無一失——凡是發給模型的內容，都會離開你的裝置。

這份文件說明 AnyModelBot 把什麼存在哪裡、什麼會離開你的裝置、怎麼刪除。有問題可以發郵件到 [support@anymodel.bot](mailto:support@anymodel.bot)。

## 資料目錄

| 執行方式 | 資料目錄 |
| :--- | :--- |
| 桌面版 · Windows | `%APPDATA%\anymodel bot\data` |
| 桌面版 · macOS | `~/Library/Application Support/anymodel bot/data` |
| 桌面版 · Linux | `~/.config/anymodel bot/data` |
| 命令列 `npm start` | `./data`（環境變數 `AMB_DATA_DIR` 可改） |
| Docker | 容器內 `/data`（README 範例裡掛載為卷 `amb-data`） |

## 資料清單

| 資料 | 存放位置（資料目錄內） | 會離開裝置嗎 | 去向 |
| :--- | :--- | :--- | :--- |
| 對話與對話 | `anymodel.db`（SQLite） | 回答需要的那部分會 | 作為模型請求的上下文，經 Modelflare 發給你選定的供應商 |
| 匯入的技能 | `skills/<機器人 ID>/`；啟用項複製到 `dsh/<機器人 ID>/skills/` | 名稱和說明、使用時讀取的正文與資料會 | 作為上下文發給所選模型；匯入僅上傳到你使用的 AnyModelBot 執行個體，不存取 GitHub |
| 聊天搜尋索引 | `anymodel.db` 的 `message_search` 及其全文索引 | 不會 | 在執行個體內搜尋已儲存的訊息，不呼叫模型 |
| 記憶 | `memory/`（Markdown：`bots/`、`groups/`；關於我：`about-me.json`，含 30 天變更歷史；`team/` 是升級前的團隊記憶，已搬進關於我、不再讀取） | 被用到時會 | 作為上下文進入模型請求；寫入前會過濾看起來像金鑰的內容，證件號、銀行卡號不存，位址、電話、電子信箱要你確認才存進關於我 |
| 機器人工作區檔案 | `workspaces/<機器人>/`（含收到的檔案 `inbox/`、產生的圖片和影片 `media/`） | 機器人讀取併發給模型時會 | 同上 |
| 訊息附件 | `attachments/`（在對話裡貼上的圖片、拖入的圖片和文字檔的副本，隨機檔名；圖片是去掉 EXIF 等元資訊後的版本）。沒發出的最長留 24 小時，隨訊息發出的留 30 天，之後刪除 | 傳送那則訊息時會 | 圖片和檔案的完整文字隨那則訊息作為模型請求發給你選定的供應商；刪除本機副本收不回已經發出的內容 |
| Modelflare 登入認證資料 | `modelflare-account.json`（權限 600） | 只在重新整理權杖時發給 modelflare.dev | Modelflare |
| API Key | 內建閘道的隔離設定 `magpie/config/` | 每次模型請求作為鑒權發給 Modelflare | Modelflare |
| 官方 API Key（如果你填了） | 內建閘道的隔離設定 `magpie/config/` | 每次模型請求作為鑒權發給對應的廠商 | 對應的模型廠商 |
| 微信登入狀態與同步游標 | 資料目錄內（`weixin/` 等） | 與微信 iLink 介面通信時會 | 騰訊微信 |
| 飛書聊天帳號的 App ID / Secret | `anymodel.db` | 與飛書開放平台建立持續連線時會 | 飛書 |
| Telegram、Slack、Discord 的 token | `anymodel.db` | 與對應平台通信時會 | 你連接的平台 |
| 允許名單與使用請求 | `anymodel.db`：誰能用哪個管道帳號、陌生人發來的第一則訊息（截斷，幫你認出是誰） | 不會 | — |
| 待傳送的回覆 | `anymodel.db` 的出站佇列：還沒發出去的訊息內容和原因，包括等對方下次傳送訊息再發的微信訊息（最多留 7 天；發出去的留 7 天、發不出去的留 30 天後刪除） | 傳送時會 | 微信 / 飛書 |
| 背景任務和規則 | `anymodel.db`（任務、規則、執行記錄，留 30 天）；任務資料夾在 `workspaces/<機器人>/tasks/`，30 天沒動過會刪除（先在「需要你」裡告訴你）；它們的對話記錄在 `dsh/<機器人>/sessions/`，隨任務一起刪除 | 執行階段會 | 同對話：作為模型請求的上下文，經 Modelflare 發給你選定的供應商 |
| 設定 | `config.json` | 不會 | — |
| 記錄 | `logs/app.log`（按大小輪轉） | 預設不會；「複製診斷資訊」由你手動複製，金鑰已替換成 `***`；在「需求與意見回饋」的「遇到問題」裡勾選附帶執行狀態和最近記錄並傳送時，最近 120 行（金鑰已替換）會隨這次提交發出 | 你的 Modelflare 私有工單（只在你傳送時） |
| 連線應用程式的憑證（你連線了才有）：授權登入的權杖、貼上的權杖和 Key、專屬連結、自訂 MCP 的請求標頭 / 查詢參數 / 環境變數 | `app-secrets.json`（權限 600，不在資料庫裡）；記錄、診斷包和介面裡都打碼 | 每次讀寫時作為鑒權發給對應的服務；本機指令的環境變數只交給你新增的那個本機程式 | 你連線的應用程式（飛書、騰訊文件、釘釘、高德地圖、語雀、Notion、GitHub、Linear、Atlassian、Canva），或你新增的自訂 MCP 服務 |
| 連線的名稱、位址、狀態和工具清單 | `anymodel.db`（專屬連結、帶 Key 的位址只存打碼後的樣子） | 不會 | — |
| 機器人從已連線的應用程式裡讀到的內容（文件、訊息、工單…） | 不單獨儲存，進入對話後和對話存在一起 | 會 | 作為模型請求的上下文，經 Modelflare 發給你選定的供應商 |
| 螢幕螢幕截圖（電腦操作） | 不長期儲存 | 會 | 作為模型請求的一部分，經 Modelflare 發給支援視覺的模型；不會轉送到微信或飛書聊天，除非你要求作為檔案傳送 |

## 本機控制台的存取控制

- 管理介面預設只監聽 `127.0.0.1:3600`，區域網路和公用網路存取不到。
- 桌面版每次啟動都會產生一個隨機存取權杖，其他本機程式無法直接呼叫管理介面。
- 管理介面一律要存取權杖，本機回環位址也一樣。桌面版的權杖只在記憶體裡；命令列版和 Docker 沒設定權杖時自動產生，存在資料目錄的 `ui-token`（Docker：`docker exec amb cat /data/ui-token`），命令列版在終端機裡啟動時會列印一次帶權杖的位址。
- 不要把 3600 連接埠直接暴露到公用網路；需要遠端存取時，請放在你自己控制的 VPN 或帶鑒權的反向代理後面。

## 登入 Modelflare

- 使用 OIDC 授權碼 + PKCE（RFC 7636），按 RFC 8252 作為原生應用程式：AnyModelBot 是公共用戶端，沒有用戶端金鑰，授權結果回呼到本機回環位址的臨時連接埠。
- 登入過程在 modelflare.dev 完成，AnyModelBot 看不到你的 Modelflare 密碼。
- 在 Modelflare 個人資料頁的「已授權的應用程式」裡可以隨時撤銷這台裝置的授權；應用程式裡「登出」也會撤銷授權，並刪除為這台裝置和各個機器人簽發的 Key。

## 模型請求與 Modelflare

- 模型請求由內建的 magpie 閘道發往 Modelflare，再由 Modelflare 轉給你選定的模型供應商。
- 請求裡包含模型回答所需的內容：提示詞、對話上下文、被用到的記憶、檔案內容、工具結果，以及電腦操作時的螢幕截圖。
- 請求帶有 `X-Modelflare-Skill: anymodel-bot/<版本>` 頭，用於在 Modelflare 側識別來源；應用程式裡開啟的 Modelflare 連結帶 `utm_source=anymodelbot`。 從應用程式開啟充值頁時，網址 `#` 後面帶著登入時 ID Token 裡的帳號識別（`#amb_account=…`，不是金鑰），Modelflare 網頁據此核對瀏覽器中登入的是不是同一個帳號；`#` 後面的內容不會發給伺服器、CDN 或統計指令碼。「已切換 Key 設定」的提示只在本機用隨機鹽對 Key 算 HMAC 做比較，不儲存、也不上傳 Key 或它的摘要。
- Modelflare 會保留請求記錄；保留什麼、保留多久，見 [Modelflare 信任中心](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)。各模型供應商對資料的處理，以它們各自的條款為準。

## 用自己的官方 API Key

- 在引導頁或 設定 → 模型 填入 OpenAI、Anthropic 等廠商的官方 Key 後，這些廠商的模型請求由內建閘道直接發給廠商，不經過 Modelflare，也不帶 `X-Modelflare-Skill` 頭。這些內容的保留方式以對應廠商的條款為準。
- 廠商位址寫死在應用程式裡，介面和介面都不能改，Key 不會被發到別處。Key 只存在內建閘道的隔離設定裡（權限 600），不寫記錄、不進命令列參數，介面只顯示末 4 位。
- 只填官方 Key、沒有登入時，應用程式不會讀取 Modelflare 的帳號資料和價格目錄。填寫 Key 時，應用程式會用它向廠商讀取一次模型清單來驗證，之後每小時讀一次來更新清單。
- 內建閘道從 `models.dev` 讀取公開的模型目錄（上下文長度、參考價）。這個請求只下載，不帶 Key 和對話內容。
- 生圖和生影片只能通過 Modelflare 使用。

## 遙測

- 內建電腦操作驅動（Cua Driver）的遙測通過環境變數 `CUA_TELEMETRY_ENABLED=0`、`CUA_DRIVER_RS_TELEMETRY_ENABLED=0` 關閉。
- 內建閘道 magpie 以關閉自動更新、關閉帳號發現的方式執行，不讀取你電腦上已有的其他 AI 工具認證資料。
- AnyModelBot 自有程式碼（`src`、`electron`、`ui`、`scripts`、`dsh-runtime/plugins`）裡沒有分析或遙測上報：搜尋 telemetry、analytics、sentry、posthog、mixpanel，只命中上面 Cua 的兩個環境變數。
- 隨附的第三方元件各自的行為以它們的文件為準，這裡不作保證。

## 應用程式自己會發起的其他網路請求

除模型請求外，應用程式還會在以下情況連線上網：

- 讀取 Modelflare 的模型目錄、餘額、用量和通知（你的帳號資料，發往 modelflare.dev）。
- 你在「需求與意見回饋」裡傳送時（使用場景與建議、遇到問題、企業與合作三選一），把你寫的內容、補充的場景或企業背景、選擇的角色、入口、版本和系統資訊，以及你選擇附帶的錯誤和記錄（金鑰已替換成 `***`）發到 modelflare.dev，作為你 Modelflare 帳號下的私有工單；客服回覆會發郵件，也能在 Modelflare 的工單頁查看。傳送前可以查看完整的傳送內容，不附帶對話內容和螢幕截圖。聯繫方式預設不帶：只有你展開「願意進一步聊聊」、勾選「同意就本次意見回饋聯繫我」並選擇帳號電子信箱或填寫電子信箱 / 微信號時才隨這次提交發出，只用於這次意見回饋的溝通；關閉視窗、登入、換帳號後要重新確認。草稿只存在本機資料目錄裡（按帳號分開、只有你能讀、機器人讀不到，閒置 7 天清理），不同步到雲端。沒登入 Modelflare 或使用外部閘道時不能在應用程式內建工單，可以改用郵件或 GitHub（公開）自行提交，副本裡不帶聯繫方式和企業背景；「聯繫 Modelflare」開啟商務聯繫頁，不帶任何你填寫的內容。
- 產生圖片或影片時，從 docs.modelflare.dev 讀取該模型的請求格式。
- 微信管道：與 `ilinkai.weixin.qq.com` 通信，並從微信 CDN 下載你發來的圖片和檔案。
- 飛書管道：與飛書開放平台保持持續連線。
- Telegram、Slack、Discord 管道：連接後與 `api.telegram.org`、`slack.com`、`discord.com` 及其檔案位址通信，用來收發訊息和你發來的檔案。
- Windows 上開啟代理模式且系統裡沒有可用的 PowerShell 7 時，從微軟官方下載網址下載 PowerShell 7（可用 `AMB_PWSH_AUTO_INSTALL=0` 關閉，詳見[開發文件](./development_zh-TW.md)）。
- 桌面安裝版啟動後及每 6 小時向 GitHub 檢查應用程式更新，預設背景下載更新檔案；可在「設定 → 一般」關閉自動下載。請求不帶帳號認證資料或聊天內容，安裝需要你點選「重新啟動並更新」，且沒有正在執行的任務。
- 查看還沒安裝的新版本「更新了什麼」時，從 GitHub（`raw.githubusercontent.com`）讀取那個版本的更新紀錄。只在你點開時請求，不帶帳號認證資料或聊天內容；已安裝版本的更新紀錄隨應用程式封裝，不連線上網。
- 僅當你明確設定 `AMB_CATALOG_URL` 使用遠端 Bot 目錄時，才會讀取遠端清單並按需下載經過簽名和哈希驗證的包，不上傳你的資料。預設的官方 Bot 目錄、介面、範例資料和技能均隨應用程式內建，開啟和安裝不發起這些網路請求。

## 電腦操作與螢幕截圖

- 讀取螢幕會螢幕截圖，螢幕截圖作為模型請求的一部分發給支援視覺的模型。
- 預設所有電腦操作自動執行；可以在 機器人設定 → 電腦操作 改為「改變介面的操作先問我」，讀取螢幕仍然自動。
- 權限預設為「唯讀」的機器人只開放讀取類工具。

## 管道

- 你在微信、飛書、Telegram、Slack、Discord 裡和機器人收發的訊息，會經過這些平台的伺服器，受它們各自的隱私政策約束。
- 預設只有主人和你允許的人能和機器人對話；其他人發來的訊息不會交給模型，只登記成使用請求（見 [開發文件](./development_zh-TW.md#誰能使用機器人)）。

## 如何刪除資料

1. 結束 AnyModelBot（系統匣選單 → 結束）。
2. 刪除上面表格裡的資料目錄。Docker：`docker rm -f amb && docker volume rm amb-data`。
3. 在 Modelflare 個人資料頁的「已授權的應用程式」裡撤銷 AnyModelBot 的授權。
4. 如有需要，在飛書開放平台停用你建立的應用程式（包括掃碼時自動建立的），在微信裡解除與機器人的綁定；在 Telegram（@BotFather）、Slack、Discord 上刪除你建立的機器人；在各個應用程式自己的設定中（Notion、飛書、GitHub 等）斷開 AnyModelBot 的授權，刪除你建立的權杖和 Key。
