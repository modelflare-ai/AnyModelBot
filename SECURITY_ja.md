# セキュリティポリシー

[简体中文](./SECURITY.md#简体中文) | [繁體中文（台灣）](./SECURITY_zh-TW.md) | [English](./SECURITY.md#english) | 日本語 | [한국어](./SECURITY_ko.md) | [Русский](./SECURITY_ru.md) | [Español](./SECURITY_es.md) | [Português (Brasil)](./SECURITY_pt.md) | [Türkçe](./SECURITY_tr.md)

## 脆弱性の報告

セキュリティ上の問題について、公開の Issue、Discussion、プルリクエストを**作成しないでください**。

次のいずれかの方法で非公開でご報告ください。

1. **GitHub の非公開脆弱性報告（推奨）：** リポジトリの **Security** タブ → **Report a vulnerability**。
2. **メール：** 件名に「Security」を入れ、[support@anymodel.bot](mailto:support@anymodel.bot) へ送信。

以下の情報を添えてください。

- AnyModelBot のバージョン（設定 → このアプリについて）、OS とアーキテクチャ、実行方法（デスクトップ / CLI / Docker）
- 問題の内容と、攻撃者が何をできるか
- 再現手順または実証コード
- 参考になるログや診断情報（設定 → トラブルシューティング → 診断情報をコピーでキーとトークンを除去できます）

## 報告後の流れ

1. 報告を受け取ったことをお知らせします。
2. 調査し、評価と進捗をご連絡します。
3. 修正方針と公開時期を相談のうえ、修正版をリリースします。
4. ご本人の了承を得て、リリースノートに謝辞を掲載します。

## 対応バージョン

セキュリティ修正は最新リリースに反映します。報告前に [最新リリース](https://github.com/modelflare-ai/AnyModelBot/releases) でも問題が発生するか確認してください。

## 対象範囲

このリポジトリの AnyModelBot アプリ（デスクトップ、CLI、このリポジトリからビルドした Docker イメージ）とローカルコンソールが対象です。

Modelflare 自体のサービス（[Modelflare トラストセンター](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) へ報告）、WeChat・Feishu のプラットフォーム、magpie・DeepSeek Harness・Cua などの上流プロジェクトは対象外です。それぞれの管理者へ報告してください。判断に迷う場合はメールをいただければ適切な窓口へ案内します。
