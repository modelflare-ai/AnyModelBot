# 貢獻指南

[简体中文](./CONTRIBUTING.md) | 繁體中文（台灣） | [English](./CONTRIBUTING_en.md) | [日本語](./CONTRIBUTING_ja.md) | [한국어](./CONTRIBUTING_ko.md) | [Русский](./CONTRIBUTING_ru.md) | [Español](./CONTRIBUTING_es.md) | [Português (Brasil)](./CONTRIBUTING_pt.md) | [Türkçe](./CONTRIBUTING_tr.md)

謝謝你願意幫 AnyModelBot 變得更好。bug 報告、修復、文件和想法都歡迎。

## 提問與意見回饋

- **提問、想法、使用交流：** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Bug 與功能建議：** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues)，按範本填寫
- **即時交流：** [Discord](https://discord.gg/umBN6wX3zJ) · [Telegram](https://t.me/+Tx6Payfzxqk2ZGVl)
- **安全問題：** 不要公開提 issue，按 [SECURITY.md](./SECURITY_zh-TW.md) 私下報告
- **其他事情：** 發郵件到 [support@anymodel.bot](mailto:support@anymodel.bot)

提 bug 時請帶上：

- 版本號碼（設定 → 關於）、作業系統與架構（例如 Windows 11 x64、macOS 15 Apple 芯片）、執行方式（桌面版 / 命令列 / Docker）
- 復現步驟、期望結果和實際結果
- 診斷資訊：設定 → 疑難排解 →「複製診斷資訊」（API Key、權杖已替換成 `***`）。記錄在資料目錄的 `logs/app.log`，資料目錄的位置見 [docs/privacy.md](./docs/privacy_zh-TW.md#資料目錄)
- 涉及某個模型的問題，寫上模型 ID

## 開發環境

需要 Node.js 22.13+ 和 Go 1.26.8+（編譯內建閘道 magpie）。

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup          # 拉取 vendor/magpie 子模組並編譯到 build/bin/
```

| 指令 | 作用 |
| :--- | :--- |
| `npm start` | 命令列執行：內建閘道 + 機器人 + 管理介面 `http://127.0.0.1:3600/` |
| `npm run dev` | 同上，改程式碼自動重新啟動 |
| `npm run electron:dev` | 開發模式執行桌面版 |
| `npm run electron:smoke` | 桌面版冒煙測試（Linux 無顯示器時自動用 xvfb-run） |
| `npm run typecheck` | TypeScript 類型檢查 |
| `npm test` | 單元測試 + 離線端到端 + 內建閘道整合測試 |
| `npm run test:dsh-bundle` | 用 Electron 跑真實 DSH 整合測試（需先 `prepare:dsh` + `bundle:dsh`） |
| `npm run docs:check` | README 自檢 |

目錄結構、封裝、各管道的設定方法見[開發文件](./docs/development_zh-TW.md)。

## 分支與 Pull Request

1. Fork 儲存庫，從 `master` 新增分支。
2. 提交前跑一遍：

   ```bash
   npm run typecheck && npm test
   ```

   改了 README 或 `docs/` 的話，再跑 `npm run docs:check`。
3. 向 `master` 提交 Pull Request，寫清楚改了什麼、為什麼改、怎麼驗證的。介面改動請附螢幕截圖。
4. 比小修復大的改動（新功能、改架構、加依賴），請先開 issue 對齊方案，免得白做。
5. 一個 PR 只做一件事；提交資訊沿用儲存庫現有的風格（`feat(scope): …`、`fix(scope): …`）。

## 介面改動

- 沿用 `ui/design` 裡的 tokens 和元件（說明見 `ui/design/README.md`），不寫一次性的顏色、字級。
- 品牌強調色是螢光黃綠 `#d7ff00`，介面裡不引入藍色。
- 管理介面是 Preact + htm，沒有建置步驟，請不要引入封裝工具或需要編譯的前端依賴。
- 淺色和深色主題都要看一遍。
- 介面文案放在 `ui/locales/<語言>/`，程式碼以 `t()` 取得文字。請為語言清單中的每個語言補上譯文，台灣繁體中文使用 `zh-TW`。提交前請執行 `npm run i18n:check`。

## 第三方程式碼與依賴

- 新增依賴、移植或改編外部程式碼時，同步更新 `THIRD_PARTY_NOTICES.md`，寫清來源、版本和授權條款。
- 不引入 AGPL、SSPL、FSL 等與 MIT 分發不相容的元件。

## 行為準則

友善、就事論事。尊重每一位參與者，對事不對人；不接受騷擾、人身攻擊或歧視性言論。維護者可以刪除不符合這些要求的內容。遇到問題可以發郵件到 [support@anymodel.bot](mailto:support@anymodel.bot)。

## 許可

你提交的貢獻將按本儲存庫的 [MIT 授權條款](./LICENSE)發布。
