export default {
  "tabs": {
    "general": "一般",
    "appearance": "外観",
    "modelflare": "モデル",
    "computer": "コンピューター操作",
    "connections": "チャットチャネル",
    "privacy": "プライバシーとセキュリティ",
    "network": "ネットワークとアクセス",
    "data": "データ",
    "troubleshoot": "トラブルシューティング",
    "about": "このアプリについて"
  },
  "connections": {
    "feishu": "Feishu メッセージ",
    "channelSub": "これらのアプリからボットにメッセージを送れます。アカウントはすべてのボットで共有され、チャットで /bot と名前を送ると別のボットに切り替わります。",
    "channelKeys": "{channel} チャネル チャット 接続 アカウント ボット /bot",
    "manage": "管理",
    "defaultIs": "既定では {bot} が返信します",
    "requests": "アクセス申請 {count} 件",
    "defaultBot": "既定のボット",
    "defaultBotHint": "新しいチャットに返信するボットです。/bot で一覧を表示し、/bot と名前を一度送ると切り替わります。そのチャットでは以後、選んだボットが返信します。",
    "removeAccount": "このアカウントを削除",
    "removeChannelBody": "どのボットもこのアカウントで送受信できなくなり、許可リストも消去されます。チャット履歴は保持されます。",
    "notionSub": "ページとデータベース。読み取り専用のボットは読むだけで、どのボットもページを削除できません",
    "feishuSub": "あなたの権限でチャットとメッセージを読み取ります（読み取り専用）",
    "notionKeys": "Notion ノート 文書 データベース 接続 アカウント 認可",
    "feishuKeys": "Feishu Lark メッセージ チャット 接続 アカウント 認可",
    "viaToken": "トークン",
    "viaOAuth": "認可済み",
    "needsReauth": "認可の有効期限が切れました。再認可してください",
    "dataMoved": "Notion や Feishu などのデータアカウントは「アプリを接続」に移動しました。",
    "dataMovedKeys": "データアカウント notion feishu アプリを接続 アプリ mcp",
    "openApps": "「アプリを接続」を開く",
    "reauthorize": "再認可",
    "rename": "名前を変更",
    "remove": "削除",
    "removeTitle": "{name} を削除しますか？",
    "removeBody": "どのボットもこのアカウントを利用できなくなります。後から再追加できます。",
    "notionOAuthTitle": "Notion へのアクセスを許可",
    "oauthFailed": "認可ページを開けませんでした。時間をおいて再試行してください",
    "openAgain": "開かない場合はこちら",
    "waiting": "許可を待っています…",
    "notionTokenTitle": "トークンで Notion に接続",
    "notionTokenHint": "個人用アクセストークンは、あなたが閲覧できるすべての情報にアクセスできます。内部接続は共有されたページにだけアクセスできます。",
    "createToken": "トークンを作成 ↗",
    "tokenLabel": "トークン",
    "add": "追加",
    "feishuTitle": "Feishu アカウントを追加",
    "feishuAppHint": "アプリにはメッセージを読み取るユーザー権限が必要です。次にコードを読み取って認可します。",
    "next": "次へ",
    "qrAlt": "Feishu 認可用 QR コード",
    "openInBrowser": "ブラウザーで開く ↗",
    "retry": "再試行",
    "renameHint": "「仕事用の Feishu を確認して」のように、ボットに話しかける際にこの名前を使えます。",
    "nameLabel": "名前",
    "save": "保存",
    "dataSub": "ボットがあなたに代わってこれらのアカウントを読み取れます。すべてのボットで共有され、複数追加できます。「仕事の Feishu のメッセージを見て」のように頼めます。",
    "connect": "接続",
    "addOne": "もう1つ追加",
    "addAnother": "アカウントをもう1つ追加",
    "addAnotherSub": "同じアプリに複数のアカウントを接続できます",
    "how": {
      "weixin": "スマートフォンの WeChat で QR コードをスキャン",
      "feishu": "スマートフォンの Feishu でスキャン（アプリは自動で作成）",
      "telegram": "@BotFather でボットを作成し、トークンを入力",
      "slack": "Slack アプリを作成し、トークンを2つ入力",
      "discord": "Discord アプリを作成し、ボットトークンを入力"
    },
    "connectTitle": "{channel} に接続",
    "connectedTitle": "{channel} に接続しました",
    "connectingTitle": "{channel} に接続中…",
    "failedTitle": "{channel} に接続できませんでした",
    "waitingScan": "スキャンを待っています…",
    "waitingOwner": "最初のメッセージを送ると紐付けが完了します",
    "useToken": "トークンを使う",
    "useOneClick": "ワンクリック認証を使う",
    "useApp": "自分のアプリを使う",
    "useScan": "スキャンで接続する",
    "feishuPortal": "Feishu オープンプラットフォーム ↗",
    "oauthTimedOut": "時間がかかりすぎたため、認証ページの期限が切れました。もう一度やり直してください。",
    "steps": {
      "weixin": [
        "スマートフォンの WeChat の「スキャン」で下の QR コードを読み取る",
        "スマートフォンで確認する"
      ],
      "feishu": [
        "スマートフォンの Feishu で下の QR コードを読み取る",
        "案内に従ってボットアプリを作成する"
      ],
      "feishuApp": [
        "{link} で「ボット」を有効にし、イベント購読で「長時間接続でイベントを受信」を選んで {event} を購読する",
        "権限を有効にする：{p1}、{p2}、{p3}、{p4}",
        "App ID と App Secret を下に入力する"
      ],
      "telegram": [
        "Telegram で {bot} を探し、{cmd} を送ってボットを作成する",
        "受け取ったトークンを下に入力する"
      ],
      "slack": [
        "{link} でアプリを作成し、Socket Mode を有効にして {conn} 付きの App-Level Token を生成する",
        "Bot Token に {s1}、{s2}、{s3}、{s4} を追加し、イベント {event} を購読する",
        "App Home でメッセージを許可し、ワークスペースにインストールする",
        "2つのトークンを下に入力する"
      ],
      "discord": [
        "{link} でアプリを作成して Bot を追加し、トークンをコピーする",
        "OAuth2 の URL Generator で bot を選び、参加しているサーバーに追加する",
        "トークンを下に入力し、Discord でボットに DM を送る"
      ],
      "notion": [
        "開いたブラウザーのページで内容を選び、同意する",
        "ここに戻ると、アカウントが自動で表示されます"
      ],
      "feishuData": [
        "スマートフォンの Feishu でスキャンして個人アプリを作成する",
        "もう一度スキャンして、チャットとメッセージの読み取りを許可する"
      ],
      "feishuDataApp": [
        "スマートフォンの Feishu でスキャンして、チャットとメッセージの読み取りを許可する"
      ]
    },
    "tryIt": "{channel} でメッセージを送ってみる",
    "switchBot": "別のボットと話すには /bot と名前を送る",
    "ownerWaiting": "最初のメッセージを待っています。最初にメッセージを送った人が所有者になり、他の人は所有者の許可が必要です。",
    "ownerBound": "「{who}」が所有者です。チャットを始められます。",
    "ownerLogin": "あなたの {channel} が所有者です。チャットを始められます。",
    "openChat": "{channel} を開く ↗",
    "done": "完了",
    "fix": "接続情報を変更",
    "limit": {
      "weixin": "WeChat の規定：メッセージ1件につき、24時間以内に最大10件まで返信できます。",
      "telegram": "現在は1対1のチャットのみ対応しています。アプリを閉じている間のメッセージは、24時間以内なら後から受信できます。",
      "slack": "現在は1対1のチャットのみ対応しています。アプリを閉じている間のメッセージは受信できません。",
      "discord": "現在は1対1のチャットのみ対応しています。アプリを閉じている間のメッセージは受信できません。"
    },
    "connection": "接続方法",
    "viaScan": "WeChat の QR コード",
    "changeApp": "アプリを変更",
    "changeToken": "トークンを変更",
    "removed": "{name} を削除しました"
  },
  "gateway": {
    "running": "稼働中",
    "starting": "起動中",
    "restarting": "再起動中",
    "failed": "失敗",
    "stopped": "停止中",
    "external": "外部エンドポイント"
  },
  "theme": {
    "light": "ライト",
    "dark": "ダーク"
  },
  "textSize": {
    "sm": "小",
    "md": "標準",
    "lg": "大",
    "xl": "特大"
  },
  "font": {
    "system": "システム",
    "serif": "セリフ体",
    "custom": "カスタム"
  },
  "width": {
    "normal": "標準",
    "wide": "広い",
    "full": "全幅"
  },
  "side": {
    "label": "設定",
    "back": "アプリに戻る",
    "backTitle": "アプリに戻る（Esc）",
    "search": "設定を検索",
    "nav": "設定カテゴリ"
  },
  "groups": {
    "theme": "テーマ",
    "text": "文字",
    "layout": "レイアウト",
    "effects": "効果",
    "desktop": "デスクトップアプリ",
    "account": "アカウント",
    "models": "モデル",
    "official": "公式 API キー",
    "line": "接続",
    "channels": "チャットチャネル",
    "data": "データアカウント",
  },
  "searchResults": "検索結果",
  "noMatch": "一致する設定がありません",
  "preview": {
    "label": "プレビュー",
    "reply": "エラー処理も読みやすくなります。{b} を有効にすると、下の行が折り返されます。"
  },
  "logout": {
    "title": "Modelflare からログアウトしますか？",
    "body": "このパソコンへのアクセス許可を取り消します。ボットと会話は保持され、再度ログインすると引き続き使えます。",
    "confirm": "ログアウト",
    "notRevoked": "サーバーでの取り消しを確認できませんでした。この端末ではログアウト済みです。Modelflare の Web サイトの「認可済みアプリ」で改めてアクセス許可を取り消せます"
  },
  "notifyDenied": "通知が許可されていません。システム設定またはブラウザーのサイト設定で、このページからの通知を許可してください",
  "rows": {
    "language": {
      "sub": "画面、トレイメニュー、ボットからのシステムメッセージに使用します",
      "keys": "言語 日本語 英語 中国語 韓国語 ロシア語"
    },
    "sendKey": {
      "name": "送信キー",
      "sub": "{key} で改行します。日本語などの文字変換中は Enter を押しても送信しません",
      "keys": "送信 Enter Return 改行 ショートカット キーボード"
    },
    "notify": {
      "name": "返信完了時に通知",
      "sub": "ウィンドウが前面にないとき、ボットの返信完了時や確認が必要なときにシステム通知を表示します",
      "keys": "通知 お知らせ アラート バックグラウンド"
    },
    "close": {
      "name": "ウィンドウを閉じたとき",
      "sub": "トレイに隠している間も、ボットはバックグラウンドでメッセージを送受信します",
      "keys": "トレイ 終了 閉じる 最小化 バックグラウンド",
      "tray": "トレイに隠す",
      "quit": "終了"
    },
    "autostart": {
      "name": "ログイン時に起動",
      "sub": "ログイン後、バックグラウンドで起動します",
      "keys": "起動 ログイン 自動起動 スタートアップ"
    },
    "browser": {
      "name": "ブラウザーで開く",
      "sub": "同じローカル画面を既定のブラウザーで開きます",
      "keys": "ブラウザー Web"
    },
    "guide": {
      "name": "使い始めのチェックリスト",
      "hidden": "非表示です。「最初から」でチャット画面とサイドバーの下部に再表示します",
      "progress": "ボットにできることを一つずつ体験しましょう · {done}/{total} 完了",
      "keys": "ガイド 初期設定 チュートリアル チェックリスト はじめに",
      "restart": "最初から",
      "restarted": "チェックリストを最初からやり直します"
    },
    "theme": {
      "name": "テーマ",
      "sub": "ライト、ダーク、またはシステム設定に合わせます",
      "keys": "テーマ 外観 ダーク ライト 夜間 モード"
    },
    "textSize": {
      "name": "文字サイズ",
      "subDesktop": "文字だけを変更します。アイコンや余白も拡大するには、下の「ズーム」を使用してください",
      "sub": "文字だけを変更します。アイコンや余白は変わりません",
      "keys": "文字 サイズ フォント 大きさ 拡大"
    },
    "font": {
      "name": "画面のフォント",
      "sub": "システム標準、セリフ体、またはパソコンにインストール済みのフォントを使用します",
      "keys": "フォント 書体 セリフ体"
    },
    "fontName": {
      "name": "カスタムフォント",
      "subSet": "複数のフォントをカンマで区切ると、先頭から順に適用を試みます。未インストールの場合はシステムフォントを使用します",
      "subEmpty": "Inter などのフォント名を入力してください。未入力の場合はシステムフォントを使用します",
      "keys": "フォント カスタム 書体",
      "placeholder": "フォント名"
    },
    "codeFont": {
      "name": "コードのフォント",
      "sub": "コードブロック、コマンド、パスに使用する等幅フォントです。空欄の場合はシステム標準の等幅フォントを使います",
      "keys": "コード フォント 等幅",
      "placeholder": "システム標準の等幅フォント"
    },
    "zoom": {
      "name": "ズーム",
      "sub": "アイコンや余白を含め、ウィンドウ内のすべてを拡大・縮小します",
      "keys": "ズーム 拡大 縮小 倍率"
    },
    "chatWidth": {
      "name": "チャットの幅",
      "sub": "大きな画面で会話の表示幅を広げ、長いコードや表の折り返しを減らします",
      "keys": "幅 広い 全幅 会話 カラム"
    },
    "codeWrap": {
      "name": "コードを折り返す",
      "sub": "コードブロックの長い行を、横スクロールせずに折り返して表示します",
      "keys": "コード 折り返し 改行"
    },
    "motion": {
      "name": "アニメーション",
      "sub": "オフにすると、画面切り替え、ポップアップ、ボットのアバターが動かなくなります。「システム」は「視差効果を減らす」設定に従います",
      "keys": "アニメーション 動き 切り替え 視差効果を減らす"
    },
    "resetAppearance": {
      "name": "外観をリセット",
      "subDesktop": "テーマ、フォント、ズーム、上記の設定をすべて既定値に戻します",
      "sub": "テーマ、フォント、上記の設定をすべて既定値に戻します",
      "keys": "リセット 復元 既定",
      "button": "リセット"
    },
    "account": {
      "name": "Modelflare アカウント",
      "signedIn": "ログイン済み",
      "enterprise": "{name} の利用料金は組織のウォレットに請求されます",
      "signedOut": "ログインすると、利用状況、お知らせ、招待リンクを確認し、ボットごとに予算を設定できます",
      "keys": "アカウント ログイン 新規登録",
      "logout": "ログアウト",
      "login": "ログイン",
    },
    "connection": {
      "name": "接続",
      "subExternal": "環境変数 AMB_MAGPIE_BASE_URL で指定されたエンドポイント（開発・テスト用）",
    },
    "balance": {
      "name": "残高",
      "error": "読み込めませんでした：{error}",
      "updated": "{time} に更新",
      "keys": "残高 チャージ ウォレット クレジット",
      "refresh": "残高を更新",
      "topUp": "チャージ ↗"
    },
    "lowBalance": {
      "name": "残高低下の通知",
      "sub": "残高がこの金額を下回ると、アプリ内で一度通知します。チャージするとリセットされます",
      "keys": "アラート 残高低下 通知",
      "none": "オフ"
    },
    "lowBalancePush": {
      "name": "チャットアプリにも通知する",
      "sub": "ボットから送信します。WeChat はログイン用 QR コードを読み取った人（最近のメッセージ送信が必要）、Feishu は直近のダイレクトチャット、Telegram・Slack・Discord は所有者に通知します",
      "keys": "プッシュ 通知 WeChat Feishu Lark Telegram Slack Discord"
    },
    "usage": {
      "name": "利用状況",
      "sub": "日別・モデル別の利用額",
      "keys": "利用状況 利用額 費用 請求"
    },
    "notifications": {
      "name": "お知らせ",
      "unread": "未読 {count} 件",
      "sub": "Modelflare からの通知やお知らせ",
      "keys": "通知 お知らせ メッセージ"
    },
    "invite": {
      "name": "友達を招待",
      "sub": "リンクから友達が登録してチャージすると、報酬を受け取れます",
      "keys": "招待 紹介 報酬",
      "copy": "招待リンクをコピー"
    },
    "line": {
      "name": "API ドメイン",
      "sub": "ドメインを選択するか、応答時間を比較できます。変更は新しいリクエストから反映されます",
      "keys": "ドメイン 速度 応答時間 Modelflare origin cf ネットワーク 経路"
    },
    "defaultModel": {
      "name": "既定のモデル",
      "sub": "ボット側でモデルを設定していない場合に使用します",
      "keys": "既定 モデル",
      "auto": "自動（一覧の先頭）"
    },
    "imageModel": {
      "name": "既定の画像モデル",
      "sub": "ボットが画像を生成するときに標準で使用します",
      "keys": "画像 生成 モデル"
    },
    "videoModel": {
      "name": "既定の動画モデル",
      "sub": "ボットが動画を生成するときに標準で使用します",
      "keys": "動画 生成 モデル"
    },
    "keyQuality": {
      "name": "費用対効果",
      "sub": "安価な経路と安定した経路のどちらを優先するかを選びます",
      "keys": "安価 バランス 品質 ルーティング 経路 グループ 費用"
    },
    "effort": {
      "sub": "高いほど深く考え、返信は遅くなります。自動ではモデルが決めます。調整に対応していないモデルには影響しません。",
      "keys": "推論 強さ 思考 effort reasoning"
    },
    "autoModel": "自動（{model}）",
    "models": {
      "name": "利用可能なモデル",
      "error": "読み込めませんでした：{error}",
      "sub": "アカウントで利用できるモデル",
      "keys": "モデル 一覧 更新",
      "count": {
        "other": "モデル {count} 個"
      }
    },
    "console": {
      "name": "Modelflare コンソール",
      "sub": "請求と請求書",
      "keys": "コンソール ダッシュボード 請求 請求書"
    },
    "cuStatus": {
      "name": "コンピューター操作のバックエンド",
      "ready": "利用可能",
      "notReady": "利用不可",
      "keys": "コンピューター操作 CUA アクセシビリティ 画面収録"
    },
    "cuNotice": {
      "name": "システム権限",
      "keys": "権限 許可"
    },
    "cuPerBot": {
      "name": "ボットごとに有効化",
      "sub": "ボットごとにコンピューター操作を有効にし、承認モードを設定できます",
      "keys": "ボット",
      "open": "ボット設定を開く"
    },
    "keyStorage": {
      "name": "キーの保存",
      "sub": "API キーはこの端末の内蔵ゲートウェイの隔離された設定にのみ保存され、ログやコマンドライン引数には出ません",
      "keys": "セキュリティ キー 保存"
    },
    "accountStorage": {
      "name": "アカウント認証情報",
      "sub": "Modelflare のログイン認証情報はデータフォルダーだけに保存され、現在のユーザーだけが読み取れます。画面にはアカウント名だけを渡します",
      "keys": "セキュリティ ログイン 認証情報"
    },
    "token": {
      "name": "アクセストークン",
      "required": "必須：ローカル以外のアドレスで待ち受ける場合に必要です。デスクトップ版では起動のたびにランダムなトークンを生成します",
      "local": "このパソコンでのみ待ち受けているため、トークンは不要です",
      "keys": "トークン アクセス"
    },
    "sandbox": {
      "name": "ボットのサンドボックス",
      "sub": "ローカル画面はボットのサンドボックスからのリクエストを拒否します。ボットが自分の操作を承認したり、設定を読み取ったりすることはできません",
      "keys": "セキュリティ DSH サンドボックス"
    },
    "screens": {
      "name": "スクリーンショット",
      "sub": "コンピューター操作のスクリーンショットはモデルにだけ送信し、チャットには保存しません",
      "keys": "プライバシー スクリーンショット"
    },
    "webSearch": {
      "name": "Web 検索",
      "sub": "標準では無料の検索を使います。キーを追加すると、そのサービスを優先します",
      "keys": "検索 Web インターネット Tavily Exa Bocha Zhipu Keenable SearXNG",
      "auto": "自動",
      "bocha": "Bocha",
      "zhipu": "Zhipu"
    },
    "webSearchKey": {
      "name": "{provider} のキー",
      "placeholder": "キーを貼り付け",
      "rejected": "キーが拒否されました。現在は無料の検索を使用しています",
      "remove": "削除",
      "keys": "検索 キー API"
    },
    "webSearchUrl": {
      "name": "SearXNG のアドレス",
      "keys": "検索 SearXNG URL アドレス"
    },
    "listen": {
      "name": "待ち受けアドレス",
      "sub": "変更するには AMB_UI_HOST / AMB_UI_PORT を設定して再起動してください",
      "keys": "ポート ホスト アドレス 待ち受け",
      "copy": "アドレスをコピー"
    },
    "dataDir": {
      "name": "データフォルダー",
      "sub": "SQLite、ボットのワークスペース、WeChat のログイン状態、内蔵ゲートウェイの設定を保存します",
      "keys": "パス フォルダー ディレクトリ データ",
      "copy": "パスをコピー"
    },
    "version": {
      "name": "バージョン",
      "keys": "バージョン 更新 アップデート",
      "available": "バージョン {version} が利用可能です",
      "latest": "最新バージョンを使用しています",
      "download": "ダウンロード ↗",
      "notes": "更新内容"
    },
    "licenses": {
      "name": "ライセンスと第三者への帰属表示",
      "sub": "MIT。一部の画面スタイルは magpie（MIT）を基にしています",
      "keys": "ライセンス 帰属表示 オープンソース"
    },
    "diagnostics": {
      "name": "診断",
      "gateway": "内蔵ゲートウェイ",
      "restarts": {
        "other": "{count} 回再起動"
      },
      "keys": "ゲートウェイ magpie 診断"
    },
    "troubleshoot": {
      "sub": "ゲートウェイとエージェントプロセスの状態、モデルとエージェントのテスト、最近のログ、診断情報のコピー",
      "keys": "ログ テスト エージェント 停止 応答待ち 診断 再起動 PowerShell pwsh コマンドが遅い"
    },
    "links": {
      "sub": "Web サイトとドキュメント",
      "docs": "ドキュメント ↗"
    }
  }
};
