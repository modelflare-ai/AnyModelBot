# 安全性政策

[简体中文](./SECURITY.md#简体中文) | 繁體中文（台灣） | [English](./SECURITY.md#english) | [日本語](./SECURITY_ja.md) | [한국어](./SECURITY_ko.md) | [Русский](./SECURITY_ru.md) | [Español](./SECURITY_es.md) | [Português (Brasil)](./SECURITY_pt.md) | [Türkçe](./SECURITY_tr.md)

## 報告漏洞

安全問題請**不要**公開提 issue、討論或 Pull Request。

請透過以下任一方式私下報告：

1. **GitHub 私密漏洞報告（推薦）：** 在儲存庫的 **Security** 頁 → **Report a vulnerability** 提交。
2. **郵件：** [support@anymodel.bot](mailto:support@anymodel.bot)，標題裡寫上「Security」。

請提供：

- AnyModelBot 版本（設定 → 關於）、作業系統與架構、執行方式（桌面版 / 命令列 / Docker）
- 問題是什麼，攻擊者能借此做什麼
- 復現步驟或概念驗證
- 有幫助的記錄或診斷資訊（設定 → 疑難排解 →「複製診斷資訊」會去掉金鑰和權杖）

## 之後的流程

1. 我們確認收到你的報告。
2. 我們調查並告訴你評估結果和進展。
3. 和你商定修復方案與披露時間，然後發布修復版本。
4. 經你同意，在版本說明裡致謝。

## 支援的版本

安全修復進入最新版本。報告前請先確認問題在[最新版本](https://github.com/modelflare-ai/AnyModelBot/releases)裡仍然存在。

## 範圍

範圍內：本儲存庫的 AnyModelBot 應用程式（桌面版、命令列、用本儲存庫建置的 Docker 映像檔）及其本機控制台。

不在這裡處理：Modelflare 自身的服務（請透過 [Modelflare 信任中心](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)報告）、微信與飛書平台，以及 magpie、DeepSeek Harness、Cua 等上游專案——請報告給它們的維護者。不確定的話，發郵件給我們，我們幫你轉。
