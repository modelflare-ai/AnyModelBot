<p align="center">
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">
    <img src="docs/assets/brand/logo-eyes.webp" width="120" height="120" alt="AnyModelBot の目のマーク：左右を見渡す、縦長のカプセル形をした二つの目">
  </a>
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/wordmark-dark.svg">
    <img src="docs/assets/brand/wordmark-light.svg" height="40" alt="AnyModelBot">
  </picture>
</h1>

<p align="center"><b>自分のパソコンで動く AI ボットのチーム。好きなモデルを、使った分だけ。</b></p>

<p align="center">
  <a href="https://anymodel.bot/ja/">公式サイト</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">ダウンロード</a> |
  <a href="./README.md">简体中文</a> |
  <a href="./README_en.md">English</a> |
  日本語 |
  <a href="./README_ko.md">한국어</a> |
  <a href="./README_ru.md">Русский</a> |
  <a href="./README_es.md">Español</a> |
  <a href="./README_pt.md">Português (Brasil)</a> |
  <a href="https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme">Modelflare</a> |
  <a href="https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme">料金</a> |
  <a href="./docs/development_ja.md">開発ガイド</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/issues">フィードバック</a>
</p>

<div align="center">

[![リリース][release-shield]][releases-link]
[![ダウンロード][downloads-shield]][releases-link]
[![スター][stars-shield]][stars-link]
[![ライセンス][license-shield]][license-link]
[![CI][ci-shield]][ci-link]

[![対応環境][platform-shield]][releases-link]
[![料金][pricing-shield]][pricing-link]
[![Modelflare][modelflare-shield]][modelflare-link]
[![X][x-shield]][x-link]

</div>

<p align="center">
  <img src="docs/assets/hero/hero-demo.gif" alt="AnyModelBot の操作例：Modelflare にログインし、モデルを選び、フォルダーの整理を依頼してファイルの移動を承認する" width="100%">
</p>

# 🤖 AnyModelBot

AnyModelBot は、Windows、macOS、Linux のパソコンで動く AI ボットのチームです。ボットごとに役割、既定のモデル、ワークスペース、記憶を持ちます。アプリ内で会話できるほか、WeChat、Feishu、Telegram、Slack、Discord にも接続できます。ファイルの読み書きやコマンド実行に加え、許可すればデスクトップも操作します。ワークスペースの外に書き込むときは、先に確認します。

会話、記憶、ファイル、API キーは自分の端末に残ります。モデルは [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)（ログインして従量課金で利用）経由で使うか、自分の公式 API キーで提供元に直接接続できます。AnyModelBot 自体にサブスクリプション料金はありません。

インストールすればすぐに使えます。バックグラウンドタスク、定期ルール、あなたの確認を待つ項目は標準で備えています。

**0.1.34：** 単一インスタンスのロック前に起動ログを記録し、`--diagnose-startup` 診断オプションと二重起動時のウィンドウ表示を改善しました。#71 の調査を支援します。Win11 Build 26300 の原因は未確認です。 [更新履歴](./CHANGELOG_ja.md#0134---2026-11-14)

📥 [ダウンロード](#-ダウンロードと実行) · 🌠 [画面紹介](#-画面紹介) · 🌟 [主な機能](#-主な機能) · 🆚 [比較](#-anymodelbot-と-grok-botopenai-dotsclaude-duet-の比較) · 🔐 [プライバシー](#-仕組みとプライバシー)

⭐ AnyModelBot が気に入ったら、リポジトリにスターを付けて新しいリリースをチェックしてください。

---

<a href="https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme">
  <img src="docs/assets/modelflare/modelflare-banner-en.webp" width="100%" alt="Modelflare のバナー：Modelflare に登録">
</a>

いちばん手軽なのは **[Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)** です。ログインすればモデルを使え、提供元ごとにキーを申請する必要はありません（提供元に直接接続する場合は[好きなモデルを](#-modelflare-または公式-api-で好きなモデルを)を参照）。利用できるモデル、料金、実施中のキャンペーンは [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) と[料金表](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme)でご確認ください。

**Bot クレジット**：新規登録で Bot クレジットをプレゼントし、Modelflare のサブスクリプションではプランのクレジットの 10% を Bot クレジットとして追加します。最新の条件は Modelflare のサイトで確認してください。Bot クレジットは AnyModelBot でのみ使え、アプリからのリクエストで優先して使われます。残りは左下で確認できます。

**[Modelflare に登録 →](https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme)** ·
[料金表](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[API ドキュメント](https://docs.modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[トラストセンター](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[X](https://x.com/modelflare_dev)

**AnyModelBot と Modelflare の連携**

- **ログインは一度だけ。** 初回起動時にブラウザーで Modelflare にログインまたは登録します。アプリが端末を接続するので、キーをコピーする必要はありません。承認が済むと自動でアプリに戻り、既定のモデルがまだなければツール対応の低コストなモデルを選んでおきます。Docker やサーバーでは、任意の端末のブラウザーでログインし、ログイン後のリンクをアプリに貼り付けます。
- **すべてのモデルを一つの一覧で。** Modelflare のモデルが自動表示され、コンテキスト長、機能、参考価格を確認できます。
- **使った分だけ支払う。** 残高とチャージの入口は左下に常に表示され（Bot クレジットがあれば残りの割合も表示）、残高不足の通知や日別使用量もアプリ内で確認できます。モデルを選ぶ前に公開料金表と公式価格を比較してください。
- **データの境界を明示。** モデルへのリクエストは Modelflare を経由して選択した提供元へ送信され、Modelflare はリクエストログを保持します。項目と期間は [トラストセンター](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) を確認してください。それ以外のデータは端末に残ります（[詳細](#-仕組みとプライバシー)）。

---

# 📥 ダウンロードと実行

利用する環境を選んでください。各リリースページに全インストーラーと `SHA256SUMS` ファイルを掲載しています。

| 環境 | アーキテクチャ | インストーラー | |
| :--- | :--- | :--- | :--- |
| ![Windows][win-badge] | x64 | `anymodel-bot-<version>-win-x64.exe` | [ダウンロード][releases-link] |
| ![Windows][win-badge] | arm64 | `anymodel-bot-<version>-win-arm64.exe` | [ダウンロード][releases-link] |
| ![macOS][mac-badge] | Apple silicon | `anymodel-bot-<version>-mac-arm64.dmg` | [ダウンロード][releases-link] |
| ![macOS][mac-badge] | Intel | `anymodel-bot-<version>-mac-x64.dmg` | [ダウンロード][releases-link] |
| ![Linux][linux-badge] | x64 | `anymodel-bot-<version>-linux-x86_64.AppImage` | [ダウンロード][releases-link] |
| ![Linux][linux-badge] | arm64 | `anymodel-bot-<version>-linux-arm64.AppImage` | [ダウンロード][releases-link] |

<p align="center">
  <img src="docs/assets/download/install-windows.gif" alt="Windows への AnyModelBot のインストール：インストーラーを実行してアプリを開き、Modelflare のログイン画面へ進む" width="100%">
</p>

**初回起動。** Windows の警告が出る場合は *詳細情報 → 実行* を選びます。macOS 版は Developer ID 署名と Apple の公証を完了しています。「アプリケーション」に移して起動し、ダウンロードの確認が出たら「開く」を選びます。Linux では AppImage に実行権限を付けて（`chmod +x`）起動します。ウィンドウを閉じるとトレイに格納されます。終了するにはトレイメニューまたは設定を使ってください。

**ダウンロードの検証。**

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

macOS では `shasum -a 256 <file>`、Windows PowerShell では `Get-FileHash <file>` を実行し、`SHA256SUMS` の該当行と比較します。

**NAS やサーバーで Docker を使う**（x64・arm64 対応イメージ）

```bash
docker run -d --name amb -p 3600:3600 -v amb-data:/data ghcr.io/modelflare-ai/anymodel-bot
docker exec amb cat /data/ui-token   # http://<host>:3600/?token=<token> を開く
```

ポート 3600 をインターネットに直接公開しないでください。

**ソースから実行する**

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup      # 内蔵ゲートウェイを取得してビルド
npm start          # http://127.0.0.1:3600/ でローカルコンソールを起動
```

ソースからのビルドには Node.js 22.13 以降と Go 1.26.8 以降が必要です。Docker イメージを自分でビルドする場合は [開発ガイド](./docs/development_ja.md) を参照してください。

# 🌠 画面紹介

掲載画像は中国語簡体字の画面です。アプリは英語、日本語、韓国語、ロシア語、スペイン語、ポルトガル語（ブラジル）にも対応しており、設定から切り替えられます。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/chat-dark.webp">
  <img src="docs/assets/screenshots/chat-light.webp" alt="会話画面：Markdown のリストとコードブロックを含む返信、入力欄のモデルボタン、左側のボット一覧" width="100%">
</picture>

<p align="center"><i>ボットとの会話。返信は Markdown とコードを表示し、入力欄で使用中のモデルを確認できます。</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/agent-dark.webp">
  <img src="docs/assets/screenshots/agent-light.webp" alt="ボット画面：ファイル操作の手順一覧と、ワークスペース外への書き込みを求める承認カード" width="100%">
</picture>

<p align="center"><i>ボットの作業を一つずつ確認できます。ワークスペース外の操作は承認を待ちます。</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/models-dark.webp">
  <img src="docs/assets/screenshots/models-light.webp" alt="モデル選択：コンテキスト長、機能タグ、参考価格を確認できる検索可能な Modelflare モデル一覧" width="100%">
</picture>

<p align="center"><i>会話ごとに Modelflare のモデルを選択。コンテキスト長、機能、参考価格を並べて確認できます。</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/memory-dark.webp">
  <img src="docs/assets/screenshots/memory-light.webp" alt="ボットの記憶、接続済みチャネル、最近のセッションを表示する情報パネル" width="100%">
</picture>

<p align="center"><i>ボットごとの記憶、チャネル、セッションを一つのパネルに。</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/modelflare-dark.webp">
  <img src="docs/assets/screenshots/modelflare-light.webp" alt="設定の Modelflare タブ：過去 7 日の日別使用量、既定モデルの項目、アカウントボタンの残高を表示" width="100%">
</picture>

<p align="center"><i>残高、使用量、既定の設定をアプリ内の Modelflare アカウントで確認。</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/bots-dark.webp">
  <img src="docs/assets/screenshots/bots-light.webp" alt="それぞれ色の異なる 6 体の AnyModelBot キャラクター" width="100%">
</picture>

<p align="center"><i>6 体のキャラクターでボットを見分けられます。目はポインターを追いかけます。</i></p>

# 🌟 主な機能

## 🤖 実際に作業するボット

ボットは単なるチャット画面ではありません。役割、既定のモデル、専用のワークスペースと記憶を持ちます。

- **必要な数だけ作成。** ボットごとに役割、モデル、ワークスペース、アバターを設定できます。
- **ボットの一つひとつを、あなたが決める。** 役割は文章で指定し、テンプレートは出発点として使えます。6 種類のアバターは見た目だけを変え、機能には影響しません。
- **ファイルを扱う実作業。** ファイルの読み書きやサンドボックス内でのコマンド実行を行い、成果物をファイルとして会話に返します。
- **ボットごとに 3 段階の権限。** *読み取り専用*、*ワークスペースへの書き込み*（既定：自分のフォルダー内だけ変更し、ワークスペースの外に書き込むときは先に確認）、*フルアクセス*（サンドボックスなし。フォルダーを丸ごと削除する前には確認）を選べます。
- **スキルのインポート。** 「ボット設定 → スキル」で `SKILL.md` を含む ZIP（1 パッケージにつき 1 スキル、最大 20 MB）を選び、確認して追加します。表示、有効化、無効化、削除に対応し、同名のスキルを再インポートすると確認後に置き換えられます。変更は実行中の作業終了後に反映されます。 [スキルの使い方](./docs/skills_ja.md).
- **承認カードで確認。** ワークスペースの外に書き込む操作は止まり、回答を待ちます。
- **再起動後も状況が分かる。** 終了やクラッシュの際に処理中だったメッセージは、次の起動時に会話内で通知します。必要なら再送でき、自動でやり直すことはありません。
- **グループチャット。** グループに複数のボットを追加できます。@ で指定したボットが答え、指定しなければ最後に回答したボットが続けます。ボットが別のメンバーを @ して引き継ぐこともできます。モデル、ワークスペース、記憶、費用はボットごとに分けて管理します。
- **チャット履歴の検索。** サイドバーから端末に保存された全メッセージを検索し、Bot・会話・チャネル・期間で絞り込んで元のメッセージへ移動できます。`Ctrl/Cmd+Shift+F` で全体検索、`Ctrl/Cmd+F` で現在のチャットを検索。モデル呼び出しは不要です。入力前の検索ダイアログには、最近のチャットを日付ごとに表示します。
- **スラッシュコマンド。** `/model` や `/reset` はアプリでも各チャネルでも使えます。チャネルでは `/bot` で別のボットに切り替えられます。

<p align="center">
  <img src="docs/assets/features/agent-files.gif" alt="散らかったフォルダーを整理するボット：ファイルを一覧し、計画を示し、ワークスペース外への移動前に承認を求める" width="100%">
</p>

## 🧩 既製の Bot

役割を自分で書かなくても、「見つける」にある既製の Bot をすぐに使えます。Bot にはそれぞれ専用の画面があり、開いたときはサンプルを表示し、最初のメッセージを送ったときにインストールします。

公式 Bot の画面、サンプル、ペルソナ、スキルはインストーラーに同梱されています。初回表示やインストール時に Bot パッケージをダウンロードする必要はありません。更新はアプリとともに配信され、既存のプロジェクトデータは保持されます。モデル呼び出しやオンライン調査にはネット接続が必要です。どのボットもデスクトップのワークスペースで、左に作品の一覧、右に内容を表示します。「新規」はガイド付きフォームで始められ、上部のバーで会話全体に切り替えられます。入力欄ではモデルも選べます。

- **企業リサーチ：** 手元のパソコンで企業を調査し、出典付きの要約と PDF レポートを作成します。
- **PPT マスター：** 文書やテーマから編集可能なスライドを作成。既存のプレゼン資料も編集できます。
- **映像スタジオ：** 短編動画と連続ドラマを、脚本・絵コンテから音声・編集・完成まで制作します。
- **米国株リサーチ：** 米国上場企業の決算と SEC 提出書類を調べ、数字の出典をたどれるレポートを作成します。

映像スタジオには AnyModelBot 0.1.23 以降と、端末上の Python 3.10+、FFmpeg（ffprobe を含む）が必要です。AI 画像・動画は Modelflare の従量課金で生成し、プロジェクトと素材は端末に保存します。

詳しくは[公式サイトの Bot ページ](https://anymodel.bot/ja/bots)をご覧ください。

## ⏳ 裏で働き、必要なときだけ声をかける

- **バックグラウンドタスク。** 調査、レポート、ファイル整理など時間のかかる依頼や「バックグラウンドで進めて」という指示では、タスクを裏で実行します。その間も会話でき、結果は依頼元の会話に戻ります。
- **追加の依頼。** WeChat では結果を引用し、Feishu では結果に返信すると、そのタスクに続けて依頼できます。
- **ルール。** 「毎朝 8 時に X の価格を調べ、200 を下回ったら教えて」で、定期的に確認して重要な変化だけを知らせるルールを作れます。まず動きを見たいときは「最初は観察だけ」と伝えてください。送信予定の内容を記録し、実際の送信やファイル変更は行いません。確認できたら実行モードへ切り替えます。
- **あなたの対応待ち。** 回答、承認、再試行など、全ボットの待ち項目がサイドバーの一か所に集まります。対応事項があるときだけ表示されます。情報パネルのタスク欄では、ボットのタスクやルールを手順ごとに確認できます。
- **静かに動くのが基本。** 通知するのは結果、判断の依頼、失敗だけで、進捗は送りません。通知しない時間は 22:00〜08:00。自発的なメッセージは 1 日に WeChat で 3 件、その他のチャネルで 5 件までとし、残りを一つにまとめます。
- **予算管理。** タスクとルールには予算があります（タスクごとに 1 米ドル、ルールの実行ごとに 0.10 米ドル、月に 3 米ドル）。使い切ると停止して確認します。タスク詳細やルール編集画面で変更できます。
- **いつでも一時停止。** ボット設定 › ボットからのメッセージのスイッチで、会話を続けたままバックグラウンド作業を止められます。
- **自動整理。** タスクと実行履歴は 30 日間保持します。30 日間使われていないタスクフォルダーは確認なしで削除します。詳細に予定日を表示し、「保持」で残せます。履歴は Markdown で書き出せます。

ランタイムは [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) を基盤とし、設計は DeepSeek の [super-agent プロトタイプ](https://github.com/deepseek-ai/dsh-superagent-prototype) を参考にしています。詳しい紹介（中国語）：[AnyModelBot スーパーエージェント](./docs/blog/superagent.md)。

## 🖥️ パソコンを操作し、画像や動画を作る

- **コンピューター操作**には同梱の [Cua Driver](https://github.com/trycua/cua) を使います。既定では自動実行し、*画面を変更する前に確認*へ切り替えるとクリックやキー入力のたびに待ちます。画面の読み取りに承認は不要です。macOS ではベータ機能で、「アクセシビリティ」と「画面収録」の権限は初めて必要になったときに確認し、足りない権限はチャットで案内します。
- **画像・動画の生成**は、曖昧な依頼も妥当に解釈してすぐに始めます。見積もりが 0.50 米ドルを超えるときだけ先に確認するため、モデルやプロンプトを見てその場でモデルを変更できます。毎回確認したい場合はボット設定で有効にしてください。

<p align="center">
  <img src="docs/assets/features/computer-use.gif" alt="ボットがメモ帳を開いて短いメモを入力・保存し、クリックやキー入力の前に承認カードを表示する" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/media-generation.gif" alt="画像生成に使うモデルをボットが確認し、承認後に完成画像をファイルとして届け、ビューアーで開く" width="100%">
</p>

## 🌐 Modelflare または公式 API で好きなモデルを

- **一度ログインすれば** Modelflare のモデルが自動で表示されます。
- **自分の公式 API キーも使えます。** OpenAI、Anthropic、Google Gemini、xAI、DeepSeek、Kimi、GLM、Qwen、MiniMax、Mistral に対応します。キーは端末にのみ保存され、モデルへのリクエストは Modelflare を経由せず提供元へ直接送られ、料金は提供元から請求されます。画像・動画の生成は現在 Modelflare 経由でのみ利用できます。
- **選択画面は一つ。** GPT、Claude、Gemini、Grok、DeepSeek、Kimi、GLM などを、コンテキスト長、機能タグ、参考価格とともに表示します。
- **会話ごとに切り替え、ボットごとに既定値を設定。** 記憶の整理やコンテキストの引き継ぎには別のモデルも使えます。
- **3 つの API ドメイン。** `modelflare.dev`、`origin.modelflare.dev`、`cf.modelflare.dev` から選び、設定で応答時間を比較できます。AnyModelBot が自動で切り替えることはありません。
- **従量料金。** ウォレット残高、残高不足の通知、日別使用量、ボット別の予算キーを備えています。AnyModelBot 自体にサブスクリプション料金はありません。

<p align="center">
  <img src="docs/assets/features/first-run.gif" alt="初回起動：Modelflare にログインしてブラウザーで承認し、アプリに戻ってモデル一覧から最初のメッセージを送る" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/model-switch.gif" alt="モデル選択画面で検索し、コンテキスト長と参考価格を確認して会話のモデルを切り替える" width="100%">
</p>

## 🧠 記憶を引き継ぎ、どこからでもつながる

- **会話をまたぐ記憶。** ボット、グループ、チームがそれぞれ自分の記憶を Markdown で持ち、混ざることはありません。パスワードやキーらしい内容は記憶しません。
- **長い会話も続けやすく。** コンテキスト管理が上限に近づく前に圧縮するか、引き継ぎ要約を作って新しい区間を始めます。
- **すべてのボットでアカウントを共有。** WeChat、Feishu、Telegram、Slack、Discord のチャットアカウントは「設定 › チャットチャネル」で一度追加すれば、すべてのボットで共有できます。チャネルごとに別名付きで複数登録でき、チャットで `/bot name` を一度送るだけでボットが切り替わります。
- **アプリを接続。** アバターメニューの「アプリを接続」には、Feishu、Tencent Docs、DingTalk、Amap、Yuque、Notion、GitHub、Linear、Atlassian、Canva のコネクタが内蔵されており、カスタム MCP（リモートサービスまたはローカルコマンド）も追加できます。一度接続すれば既定ですべてのボットが使え、ボットごと・ツールごとに絞り込めます。読み取りはそのまま実行し、書き込みは先に確認、削除と外部への送信は毎回確認します。
- **WeChat と Feishu。** WeChat は QR コードで接続します。Feishu は返信が逐次表示されるカードに対応し、WeChat でも画像とファイルを扱えます。
- **Telegram、Slack、Discord。** 設定 › チャットチャネルにトークンを貼り付けるだけで、公開アドレスは不要です。返信は逐次表示され、画像とファイルを双方向で送れます。現在はダイレクトメッセージのみで、承認や質問には文章で回答します。
- **4 つの使い方。** デスクトップ、コマンドライン、Docker、`127.0.0.1:3600` のローカル Web コンソールから使えます。

<p align="center">
  <img src="docs/assets/features/memory.gif" alt="好みを覚えるよう依頼し、情報パネルの新しい記憶を確認して、新しい会話でもその記憶が使われる様子" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/channels-wechat.gif" alt="QR コードで WeChat を接続し、スマートフォンで質問と回答をやり取りすると、デスクトップの最近のセッションにも会話が表示される" width="100%">
</p>

## 🔒 ローカル中心で、見やすい画面

- **データは手元に。** 会話、記憶、ファイル、API キーは端末に保存します。コンソールは `127.0.0.1` のみで待ち受け、デスクトップは起動ごとに新しいアクセストークンを作ります。
- **あなたが許可した相手だけに回答。** 既定では所有者と許可リストの相手に限ります。WeChat は QR コードを読み取ったアカウント、Feishu、Telegram、Slack、Discord は接続後最初に話しかけた本人が所有者です。それ以外には短い案内だけを返し、モデルは呼びません。情報パネルまたは `yes <code>` の返信で許可できます。
- **返信を失わないために。** 送信前にローカルへ保存し、通信エラー時は再試行、再起動後も送信を再開します。WeChat の 24 時間制限を過ぎた返信は、次にメッセージを受け取ってから届けます。
- **テレメトリーを無効化。** 同梱の操作ドライバーのテレメトリーと、内蔵ゲートウェイの自動更新を無効にしています。
- **アプリ内更新。** 0.1.29 以降のデスクトップインストール版では「設定 → 一般 → 更新を自動ダウンロード」が標準で有効です。バックグラウンドでダウンロードし、完了すると「再起動して更新」を表示します。インストールはユーザーのクリック後、実行中のタスクがない場合に行います。設定をオフにすると手動ダウンロードになります。0.1.28 以前からは、一度だけ 0.1.29 以降を手動インストールしてください。Docker とソースからの実行は手動更新です。0.1.30 以降は、更新後に初めて開いたときに変更点を表示します。新しいバージョンの通知から更新前に内容を確認でき、「設定 → このアプリについて」でいつでも更新履歴を見られます。
- **ライト、ダーク、システムに合わせる。** 6 体のボットの目がポインターを追います。
- **トレイと自動起動。** 閉じるとトレイに格納します。macOS と Windows ではログイン時の自動起動も使えます。

<p align="center">
  <img src="docs/assets/features/characters-eyes.gif" alt="並んだ 6 体の AnyModelBot キャラクターの目が、動くポインターを追いかける" width="100%">
</p>

> [!NOTE]
> 機能はモデル、OS、付与した権限によって異なります。コンピューター操作にはデスクトップセッションが必要で、macOS ではベータです。モデルへのリクエストは選択した提供元へ送信されます（公式 API キーの場合は直接、それ以外は Modelflare 経由）。[仕組みとプライバシー](#-仕組みとプライバシー)を参照してください。

# 🆚 AnyModelBot と Grok Bot、OpenAI dots、Claude Duet の比較

2026 年後半、xAI の [Grok Bot](https://x.ai/bot)、OpenAI の [dots](https://openai.com/index/introducing-dots/)、Anthropic の Claude Duet が相次いで登場しました。どれも、バックグラウンドであなたの代わりに仕事を進め、判断が必要なときに確認してくれる AI です。AnyModelBot も同じ種類の仕事を、別のやり方で行います。オープンソースで、自分の端末で動き、幅広いモデルを使えます。

| | AnyModelBot | Grok Bot | OpenAI dots | Claude Duet |
| :--- | :--- | :--- | :--- | :--- |
| オープンソース | ✅ MIT | — | — | — |
| 実行場所 | 自分のパソコンまたはサーバー | xAI のクラウドコンピューター | OpenAI のクラウドコンピューター | Anthropic のクラウド |
| モデル | GPT、Claude、Gemini、Grok など（Modelflare または公式 API 経由） | 主に xAI の Grok | OpenAI のモデル | Claude（Opus 5.5） |
| 費用 | アプリ無料、モデルはトークン単位 | 定額契約 | ChatGPT Pro / Business Premium 契約 | Claude Pro / Max 契約 |
| 利用手段 | デスクトップ（Windows、macOS、Linux）、Docker、WeChat、Feishu、Telegram、Slack、Discord | デスクトップ、iPhone | ChatGPT、Slack、Teams | iOS、Android、claude.ai |
| 提供状況 | 今すぐダウンロード可能 | ベータ | 一部地域 | 研究プレビュー、米国の待機リスト |

AnyModelBot もバックグラウンドで働きます。依頼したタスクを終えたらチャットアプリに結果を届け、承認や回答が必要な項目はサイドバーの「あなたの対応待ち」に表示します。すべての作業手順を確認でき、ワークスペース外の操作は先に尋ねます。

> [!NOTE]
> 他製品の情報は 2026 年 10 月時点の公開情報に基づいており、変更されている可能性があります。各社の公式情報をご確認ください。Grok Bot、dots、Claude Duet はそれぞれ xAI、OpenAI、Anthropic の製品・商標です。AnyModelBot はこれらの企業と提携していません。

# 🔐 仕組みとプライバシー

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/data-flow-dark.svg">
  <img src="docs/assets/diagrams/data-flow-light.svg" alt="データの流れ：会話・記憶・ファイル・キーは端末に保存し、モデルのリクエストは Modelflare 経由、チャットは各社サーバー経由。許可した Notion と Feishu アカウントをボットが読み書きする" width="100%">
</picture>

| 端末に保存するもの | 端末の外に送るもの |
| :--- | :--- |
| 会話とセッション（ローカル SQLite） | 回答に必要なプロンプト、ファイル、ツール結果を 選んだ提供元へ（公式 API キーの場合は直接、それ以外は Modelflare 経由） |
| 記憶（Markdown） | 画面を見るよう依頼したときのスクリーンショット |
| ボットごとの作業ファイル | 各プラットフォームを通るチャネルのメッセージ |
| API キーとログイントークン | modelflare.dev 上で行うログイン |
| アプリを接続 | アプリ（Feishu、Notion、GitHub など）を接続するか、カスタム MCP を追加した場合の読み書き。読み取った内容はモデルのリクエストにも含まれる |

Modelflare はリクエストログを保持します。項目と期間は [トラストセンター](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) に記載されています。データに一切のリスクがないとは主張しません。モデルに送った内容は端末の外に出ます。全項目は [プライバシー文書](./docs/privacy_ja.md) をご確認ください。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <img src="docs/assets/diagrams/architecture-light.svg" alt="構成：Electron・CLI・Docker から Node.js と TypeScript のバックエンドを起動し、Preact、SQLite、DSH、チャネルアダプターを利用。内蔵 magpie ゲートウェイが Modelflare を呼び出す" width="100%">
</picture>

| レイヤー | 技術 |
| :--- | :--- |
| 画面 | Preact + htm、ビルド不要 |
| バックエンド | Node.js 22.13 以降、TypeScript、`node:sqlite` |
| デスクトップ | Electron、トレイ対応 |
| モデルゲートウェイ | [magpie](https://github.com/yetone/magpie)（Go、MIT）、同梱してアプリから起動 |
| エージェントランタイム | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）、別プロセスで実行 |
| コンピューター操作 | 同梱の [Cua Driver](https://github.com/trycua/cua) |
| チャネル | Feishu（持続接続と逐次更新カード）、WeChat（iLink）、Telegram（ロングポーリング）、Slack（Socket Mode）、Discord（Gateway） |
| アプリを接続 | 内蔵コネクタ：Feishu、Tencent Docs、DingTalk、Amap、Yuque、Notion、GitHub、Linear、Atlassian、Canva。カスタム MCP：Streamable HTTP（SSE 互換）、ローカルコマンド |
| テストと CI | Vitest、GitHub Actions |

# 📝 ロードマップ

検討中の方向性です。実装の約束やスケジュールではありません。各版の変更は [変更履歴](./CHANGELOG_ja.md) をご覧ください。

- [x] **定期タスク**：タイマーに従って実行（上記のルールとして提供済み）。
- [x] **アプリ内グループチャット**：複数のボットと一つのグループで会話。
- [ ] **チャネルのグループチャット**：現在のチャネルは一対一のみ。
- [x] **多言語画面**：中国語簡体字、英語、日本語、韓国語、ロシア語、スペイン語、ポルトガル語（ブラジル）。設定で切り替え可能。
- [ ] **macOS のコンピューター操作**：より多くの実機で直接モードを検証し、ベータを終了。
- [ ] **メール・カレンダー・イベント起動**：アカウントを接続し、特定の人からのメッセージや会議開始前などの出来事でもルールを実行。外部コンテンツをきっかけにした実行は権限を下げ、他人が書いた文章からボットに指示できないようにする。
- [ ] **常時稼働・バックアップ・移行**：パソコンがオフだとルールは動かないため、自分のサーバーへの簡単な配備、会話・記憶・アカウントの移行、バックアップ・復元を整備。
- [ ] **独自 MCP サーバーの追加**：現在は内蔵ツールとアカウントのみ。GitHub や Linear などを自分で接続できるようにする。
- [ ] **ボット同士の協力**：別のモデルで下書きとレビューを分担するなど、費用を分けて作業を引き継ぐ。
- [ ] **音声メッセージの文字起こし**：現在 Telegram の音声は聞けず、WeChat はプラットフォーム側の文字起こしに依存。
- [ ] **独立したモバイルアプリ**：現在は WeChat、Feishu、Telegram、Slack、Discord から利用。

ほかのアイデアは [Issue](https://github.com/modelflare-ai/AnyModelBot/issues) や [Discussion](https://github.com/modelflare-ai/AnyModelBot/discussions) へ。取り組む項目には [`roadmap`](https://github.com/modelflare-ai/AnyModelBot/labels/roadmap) ラベルを付けます。

# 🤝 コントリビューション

不具合報告、修正、文書、アイデアのいずれも歓迎します。

1. まず既存の [Issue](https://github.com/modelflare-ai/AnyModelBot/issues) と [Discussion](https://github.com/modelflare-ai/AnyModelBot/discussions) を確認してください。[`good first issue`](https://github.com/modelflare-ai/AnyModelBot/labels/good%20first%20issue) が初めての参加に向いています。
2. フォークして `master` からブランチを作成します。
3. ローカルで動かし、変更します。

   ```bash
   npm install
   npm run setup          # 内蔵ゲートウェイを取得してビルド
   npm run electron:dev   # 開発モードでデスクトップを起動
   npm run typecheck && npm test
   ```

4. `master` 向けのプルリクエストで変更内容と理由を説明します。小さな修正を超えるものは、先に Issue で方針を相談してください。

詳しくは [貢献ガイド](./CONTRIBUTING_ja.md) をお読みください。セキュリティ上の問題は公開 Issue ではなく [セキュリティポリシー](./SECURITY_ja.md) に従って報告してください。

# 🔗 関連プロジェクト

- [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)：モデルを提供する AI API ゲートウェイ。
- [magpie](https://github.com/yetone/magpie)：同梱の Go ゲートウェイ（MIT）。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：エージェントランタイム（MIT）。
- [Cua](https://github.com/trycua/cua)：コンピューター操作ドライバー。
- [kimi-computer-use](https://github.com/songkeys/kimi-computer-use)：macOS 操作ブリッジ。
- [openclaw-weixin](https://github.com/Tencent/openclaw-weixin)：WeChat チャネルの移植元（MIT）。
- [DS Bot](https://github.com/Fei2411/DS-Bot)：記憶とコンテキスト管理の設計元（Apache-2.0）。

ライセンスと告知の全文：[第三者に関する告知](./THIRD_PARTY_NOTICES_ja.md)。

# 💬 コミュニティ

- **質問・アイデア：** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **不具合・機能要望：** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues)
- **メール：** [support@anymodel.bot](mailto:support@anymodel.bot)
- **Modelflare のニュース：** [X の @modelflare_dev](https://x.com/modelflare_dev)

# 🚀 貢献者

<a href="https://github.com/modelflare-ai/AnyModelBot/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=modelflare-ai/AnyModelBot" alt="AnyModelBot の貢献者" />
</a>

# ⭐️ スターの推移

<a href="https://www.star-history.com/#modelflare-ai/AnyModelBot&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" />
    <img alt="AnyModelBot のスター数の推移" src="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" width="100%" />
  </picture>
</a>

# 📜 ライセンス

AnyModelBot は [MIT ライセンス](./LICENSE) で公開しています。同梱の第三者ソフトウェアはそれぞれのライセンスに従います。[第三者に関する告知](./THIRD_PARTY_NOTICES_ja.md) と [`LICENSES/`](./LICENSES) をご確認ください。

<!-- link & badge references -->
[release-shield]: https://img.shields.io/github/v/release/modelflare-ai/AnyModelBot?include_prereleases&label=release&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIzIiB5PSI5IiB3aWR0aD0iOTQiIGhlaWdodD0iODIiIHJ4PSIzNiIgZmlsbD0iI2Q3ZmYwMCIvPjxyZWN0IHg9IjI5IiB5PSIzNiIgd2lkdGg9IjEzIiBoZWlnaHQ9IjI4IiByeD0iNi41IiBmaWxsPSIjMTYxYTAwIi8+PHJlY3QgeD0iNTgiIHk9IjM2IiB3aWR0aD0iMTMiIGhlaWdodD0iMjgiIHJ4PSI2LjUiIGZpbGw9IiMxNjFhMDAiLz48L3N2Zz4=&style=flat-square&labelColor=161a00&color=d7ff00
[downloads-shield]: https://img.shields.io/github/downloads/modelflare-ai/AnyModelBot/total?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[stars-shield]: https://img.shields.io/github/stars/modelflare-ai/AnyModelBot?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[license-shield]: https://img.shields.io/github/license/modelflare-ai/AnyModelBot?logo=opensourceinitiative&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[ci-shield]: https://img.shields.io/github/actions/workflow/status/modelflare-ai/AnyModelBot/ci.yml?branch=master&label=CI&logo=githubactions&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[platform-shield]: https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Docker-d7ff00?style=flat-square&labelColor=161a00
[pricing-shield]: https://img.shields.io/badge/pricing-pay--as--you--go-d7ff00?style=flat-square&labelColor=161a00
[modelflare-shield]: https://img.shields.io/badge/Modelflare-modelflare.dev-d7ff00?style=flat-square&labelColor=161a00
[x-shield]: https://img.shields.io/badge/X-@modelflare__dev-d7ff00?style=flat-square&labelColor=161a00&logo=x&logoColor=d7ff00
[win-badge]: https://img.shields.io/badge/Windows-161a00?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2Q3ZmYwMCI+PHJlY3QgeD0iMiIgeT0iMyIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48cmVjdCB4PSIxMi41IiB5PSIzIiB3aWR0aD0iOS41IiBoZWlnaHQ9IjguNSIvPjxyZWN0IHg9IjIiIHk9IjEyLjUiIHdpZHRoPSI5LjUiIGhlaWdodD0iOC41Ii8+PHJlY3QgeD0iMTIuNSIgeT0iMTIuNSIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48L3N2Zz4=
[mac-badge]: https://img.shields.io/badge/macOS-161a00?style=for-the-badge&logo=apple&logoColor=d7ff00
[linux-badge]: https://img.shields.io/badge/Linux-161a00?style=for-the-badge&logo=linux&logoColor=d7ff00

[releases-link]: https://github.com/modelflare-ai/AnyModelBot/releases
[stars-link]: https://github.com/modelflare-ai/AnyModelBot/stargazers
[license-link]: https://github.com/modelflare-ai/AnyModelBot/blob/master/LICENSE
[ci-link]: https://github.com/modelflare-ai/AnyModelBot/actions/workflows/ci.yml
[pricing-link]: https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme
[modelflare-link]: https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme
[x-link]: https://x.com/modelflare_dev
