# 貢献ガイド

[简体中文](./CONTRIBUTING.md) | [繁體中文（台灣）](./CONTRIBUTING_zh-TW.md) | [English](./CONTRIBUTING_en.md) | 日本語 | [한국어](./CONTRIBUTING_ko.md) | [Русский](./CONTRIBUTING_ru.md) | [Español](./CONTRIBUTING_es.md) | [Português (Brasil)](./CONTRIBUTING_pt.md) | [Türkçe](./CONTRIBUTING_tr.md)

AnyModelBot の改善にご協力いただきありがとうございます。不具合報告、修正、文書、アイデアのいずれも歓迎します。

## 質問とフィードバック

- **質問、アイデア、活用事例：** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **不具合と機能要望：** テンプレートを使って [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues) へ
- **コミュニティチャット：** [Discord](https://discord.gg/umBN6wX3zJ) · [Telegram](https://t.me/+Tx6Payfzxqk2ZGVl)
- **セキュリティの問題：** 公開 Issue は作成せず、[セキュリティポリシー](./SECURITY_ja.md) に従って非公開で報告してください
- **その他：** [support@anymodel.bot](mailto:support@anymodel.bot)

不具合の報告には、次の情報を添えてください。

- バージョン（設定 → このアプリについて）、OS とアーキテクチャ（例：Windows 11 x64、macOS 15 Apple silicon）、実行方法（デスクトップ / CLI / Docker）
- 再現手順、期待した動作、実際の動作
- 診断情報：設定 → トラブルシューティング → 診断情報をコピー（API キーとトークンは `***` に置換）。ログはデータディレクトリ内の `logs/app.log` にあります。場所は [プライバシー文書](./docs/privacy_ja.md#データディレクトリ) をご覧ください。
- 特定のモデルに関する問題ならモデル ID

## 開発環境の準備

Node.js 22.13 以降と、同梱の magpie ゲートウェイをコンパイルするための Go 1.26.8 以降が必要です。

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup          # vendor/magpie サブモジュールを取得し build/bin/ にコンパイル
```

| コマンド | 内容 |
| :--- | :--- |
| `npm start` | CLI でゲートウェイ、ボット、`http://127.0.0.1:3600/` のコンソールを起動 |
| `npm run dev` | 同上。コード変更時に再起動 |
| `npm run electron:dev` | 開発モードのデスクトップアプリ |
| `npm run electron:smoke` | デスクトップのスモークテスト（画面のない Linux は xvfb-run を使用） |
| `npm run typecheck` | TypeScript の型チェック |
| `npm test` | 単体テスト、オフライン E2E、ゲートウェイ統合テスト |
| `npm run test:dsh-bundle` | Electron で実際の DSH を使う統合テスト（先に `prepare:dsh` と `bundle:dsh` を実行） |
| `npm run docs:check` | README の検証 |

リポジトリ構成、パッケージ作成、チャネル設定は [開発ガイド](./docs/development_ja.md) を参照してください。

## ブランチとプルリクエスト

1. リポジトリをフォークし、`master` からブランチを作成します。
2. プッシュする前に次を実行してください。

   ```bash
   npm run typecheck && npm test
   ```

   README や `docs/` を変更した場合は `npm run docs:check` も実行します。
3. `master` を対象にプルリクエストを作成し、変更内容、理由、検証方法を書きます。画面の変更にはスクリーンショットを添えてください。
4. 小さな修正を超える変更（新機能、構成変更、新たな依存関係）は、先に Issue で方針を相談してください。
5. 一つの PR には一つの変更をまとめ、既存のコミット形式（`feat(scope): …`、`fix(scope): …`）に従ってください。

## 画面の変更

- `ui/design` のトークンとコンポーネントを使ってください（`ui/design/README.md` 参照）。個別の色や文字サイズを追加しないでください。
- ブランドのアクセントは蛍光イエローグリーン `#d7ff00` です。画面に青を持ち込まないでください。
- コンソールはビルド不要の Preact + htm です。バンドラーやコンパイルが必要なフロントエンド依存関係は追加しないでください。
- ライトとダークの両テーマを確認してください。
- 画面の文言は `t()` で表示します。マニフェストにある全言語の訳を `ui/locales/<言語>/` に追加してください。台湾の繁体字中国語には `zh-TW` を使います。提出前に `npm run i18n:check` を実行してください。

## 第三者のコードと依存関係

- 依存関係の追加や外部コードの移植・改変を行ったら、`THIRD_PARTY_NOTICES.md` に出典、バージョン、ライセンスを記載してください。
- AGPL、SSPL、FSL など、MIT での配布と両立しないライセンスの構成要素は追加しないでください。

## 行動規範

親切に、事実に基づいてやり取りしてください。参加者を尊重し、人ではなくアイデアについて議論してください。嫌がらせ、個人攻撃、差別的な発言は認めません。管理者はこの方針に反する内容を削除することがあります。懸念があれば [support@anymodel.bot](mailto:support@anymodel.bot) へお知らせください。

## ライセンス

提出された貢献は、このリポジトリの [MIT ライセンス](./LICENSE) で公開されます。
