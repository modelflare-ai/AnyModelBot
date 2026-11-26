import type { Lang } from "../i18n/locales";
import { COMMUNITY } from "./community";
// 顶部公告条（components/SiteBanner.astro）的内容：发版下载提示 + 宣传 / 公告。改这一个文件就行，页面里不写死。
//
// - 同时有效的条目轮播：6 秒一条，鼠标悬停 / 键盘聚焦 / 标签页在后台时暂停，系统开了"减少动态效果"就不自动轮播；
//   访客可以左右翻（手机上左右滑）。点 × 关掉后，这些条目按 id 记在访客本机，不再出现——想让关过的人重新看到，换个 id。
// - start / end：显示时间窗。只写日期时按北京时间算整天（start 当天 0 点起，end 当天 24 点止），
//   也可以写完整时间，如 "2026-11-11T20:00+08:00"。构建时已经过期的条目不输出；还没开始的照常输出但隐藏，
//   到点由浏览器自己显示（站点每天重建一次，过期的条目在浏览器里也会按时隐藏）。
// - countdown：在文案后显示"截至 11 月 30 日"，最后 7 天变成"还剩 N 天"（需要 end）。
// - 链接以 / 开头是站内路径，自动加语言前缀（/pricing → /en/pricing）；http(s) 开头的在新标签页打开。
// - 文案里可以用构建变量 {modelCount}、{version} 等（i18n 的 buildVars）。
// - 预览：任意页面地址后加 ?banner=preview，忽略关闭记录和时间窗，显示全部条目和语言提示。

/** 标签配色：accent 品牌色实底（发版用）、promo 品牌色浅底、neutral 中性描边、warn 琥珀色（维护、故障） */
export type Tone = "accent" | "promo" | "neutral" | "warn";
export interface BannerLink { label: string; href: string }
export interface BannerCopy {
  /** 左侧小标签，2–6 个字 */
  tag: string;
  /** 一句话，越短越好（中文 ≤ 20 字左右） */
  text: string;
  /** 主操作，带箭头 */
  cta?: BannerLink;
  /** 次要链接，手机上隐藏 */
  link?: BannerLink;
}
export interface Announcement {
  id: string;
  /** promo = 宣传 / 活动，notice = 公告 */
  kind: "promo" | "notice";
  /** 默认 promo → "promo"，notice → "neutral" */
  tone?: Tone;
  start?: string;
  end?: string;
  countdown?: boolean;
  zh: BannerCopy;
  "zh-TW": BannerCopy;
  en: BannerCopy;
  ja: BannerCopy;
  ko: BannerCopy;
  ru: BannerCopy;
  es: BannerCopy;
  pt: BannerCopy;
  tr: BannerCopy;
}

/** 发版提示：版本号和下载地址取自 releases.json；按钮按访客的系统直接下载对应安装包（识别不出时去 /download）。 */
export const RELEASE = {
  enabled: true,
  /** 发布后显示多少天；releases.json 里没有有效发布日期时一直显示 */
  days: 30,
  /** 各版本的一句话亮点（可选），没有就显示"AnyModelBot {version} 已发布" */
  highlights: {
    "0.1.49": {
      "zh": "繁体中文（台湾）",
      "zh-TW": "新增台灣繁體中文",
      "en": "Traditional Chinese (Taiwan)",
      "ja": "繁体字中国語（台湾）に対応",
      "ko": "중국어 번체(대만) 지원",
      "ru": "Традиционный китайский (Тайвань)",
      "es": "Chino tradicional (Taiwán)",
      "pt": "Chinês tradicional (Taiwan)",
      "tr": "Geleneksel Çince (Tayvan) desteği",
    },
    "0.1.41": {
      "zh": "新增土耳其语",
      "zh-TW": "新增土耳其語",
      "en": "Now in Turkish",
      "ja": "トルコ語に対応",
      "ko": "튀르키예어 지원",
      "ru": "Теперь на турецком",
      "es": "Ahora en turco",
      "pt": "Agora em turco",
      "tr": "Artık Türkçe"
    },
    "0.1.39": {
      "zh": "新建对话立刻切换，设置里能点的一眼看得出",
      "zh-TW": "新建對話立刻切換，設定中能點的一眼看得出",
      "en": "Instant new conversations and clearer buttons in settings",
      "ja": "新しい会話がすぐ始まり、設定のボタンも見やすく",
      "ko": "새 대화가 바로 시작되고 설정 버튼이 더 잘 보여요",
      "ru": "Новый разговор начинается сразу, кнопки в настройках заметнее",
      "es": "Conversaciones nuevas al instante y botones más claros en la configuración",
      "pt": "Conversas novas na hora e botões mais claros nas configurações",
      "tr": "Yeni sohbet anında açılır, ayarlardaki düğmeler daha net"
    },
    "0.1.38": {
      "zh": "修复模型列表里的「auto/…」模型",
      "zh-TW": "修復模型清單裡的「auto/…」模型",
      "en": "Fixes \"auto/…\" models in the model list",
      "ja": "モデル一覧の「auto/…」を修正",
      "ko": "모델 목록의 \"auto/…\" 모델 수정",
      "ru": "Исправлены модели «auto/…» в списке",
      "es": "Corrige los modelos «auto/…» de la lista",
      "pt": "Corrige os modelos «auto/…» da lista",
      "tr": "Model listesindeki \"auto/…\" modellerini düzeltir"
    },
    "0.1.37": {
      "zh": "关于我，和机器人之间发消息",
      "zh-TW": "關於我，和機器人之間傳送訊息",
      "en": "About me and bots that message each other",
      "ja": "「わたしについて」とボット同士のメッセージ",
      "ko": "내 정보와 봇끼리 메시지 보내기",
      "ru": "«Обо мне» и переписка ботов",
      "es": "Sobre mí y bots que se envían mensajes",
      "pt": "Sobre mim e bots que trocam mensagens",
      "tr": "Hakkımda ve birbirine mesaj atan botlar"
    },
    "0.1.36": {
      "zh": "技能库，把做成的事存成技能",
      "zh-TW": "技能庫，把做成的事存成技能",
      "en": "Skill library and saving work as skills",
      "ja": "スキルライブラリと作業のスキル保存",
      "ko": "스킬 라이브러리와 한 일을 스킬로 저장",
      "ru": "Библиотека навыков и свои навыки",
      "es": "Biblioteca de habilidades y tus propias habilidades",
      "pt": "Biblioteca de habilidades e suas próprias habilidades",
      "tr": "Beceri kitaplığı ve işi beceri olarak kaydetme"
    },
    "0.1.35": {
      "zh": "更简洁的界面、余额展示与规则修复",
      "zh-TW": "更簡潔的介面、餘額展示與規則修復",
      "en": "Cleaner UI, visible balances and rule fixes",
      "ja": "すっきりした画面、残高表示とルール修正",
      "ko": "간결한 화면, 잔액 표시와 규칙 수정",
      "ru": "Лаконичный интерфейс, баланс и исправления правил",
      "es": "Interfaz más sencilla, saldo visible y reglas corregidas",
      "pt": "Interface mais simples, saldo visível e regras corrigidas",
      "tr": "Daha sade arayüz, görünen bakiye ve kural düzeltmeleri"
    },
    "0.1.34": {
      zh: "启动诊断与重复启动处理改进",
      "zh-TW": "啟動診斷與重復啟動處理改進",
      en: "Startup diagnostics and second-launch handling",
      ja: "起動診断と二重起動時の表示を改善",
      ko: "시작 진단과 재실행 처리 개선",
      ru: "Диагностика и обработка повторного запуска",
      es: "Diagnóstico y gestión del segundo inicio",
      pt: "Diagnóstico e tratamento da segunda inicialização",
      tr: "Başlangıç tanısı ve ikinci açılışın işlenmesi",
    },
    "0.1.33": {
      zh: "定时规则、机器人模板和右侧预览",
      "zh-TW": "排程規則、機器人範本和右側預覽",
      en: "Scheduled rules, bot templates and resource previews",
      ja: "スケジュール、テンプレート、プレビュー",
      ko: "예약 규칙, 봇 템플릿, 리소스 미리보기",
      ru: "Расписание, шаблоны и просмотр ресурсов",
      es: "Reglas programadas, plantillas y vistas previas",
      pt: "Regras agendadas, modelos e prévias",
      tr: "Zamanlanmış kurallar, bot şablonları ve önizlemeler",
    },
    "0.1.32": {
      zh: "新增西班牙语和葡萄牙语（巴西）界面",
      "zh-TW": "新增西班牙語和葡萄牙語（巴西）介面",
      en: "Now in Spanish and Portuguese (Brazil)",
      ja: "スペイン語とポルトガル語（ブラジル）に対応",
      ko: "스페인어와 포르투갈어(브라질) 지원",
      ru: "Теперь на испанском и португальском (Бразилия)",
      es: "Ahora en español y portugués (Brasil)",
      pt: "Agora em espanhol e português (Brasil)",
      tr: "Artık İspanyolca ve Portekizce (Brezilya)",
    },
    "0.1.31": {
      zh: "连接应用：内置 10 个应用连接器，支持自定义 MCP",
      "zh-TW": "連線應用程式：內建 10 個應用程式連接器，支援自訂 MCP",
      en: "Connect apps: built-in connectors and custom MCP",
      ja: "アプリを接続：内蔵コネクタとカスタム MCP",
      ko: "앱 연결: 기본 제공 커넥터와 커스텀 MCP",
      ru: "Подключение приложений: встроенные коннекторы и собственные MCP",
      es: "Conectar apps: conectores integrados y MCP personalizados",
      pt: "Conectar apps: conectores integrados e MCP personalizados",
      tr: "Uygulama bağla: yerleşik bağlayıcılar ve özel MCP",
    },
    "0.1.30": {
      zh: "Bot 额度、更新说明和官方 Bot 工作台",
      "zh-TW": "Bot 額度、更新說明和官方 Bot 工作台",
      en: "Bot credits, What's new and official bot workspaces",
      ja: "Bot クレジット、更新内容、公式ボットのワークスペース",
      ko: "Bot 크레딧, 업데이트 내용, 공식 봇 작업 공간",
      ru: "Кредиты Bot, «Что нового» и рабочие пространства ботов",
      es: "Créditos de Bot, Novedades y espacios de trabajo de los bots oficiales",
      pt: "Créditos de Bot, Novidades e espaços de trabalho dos bots oficiais",
      tr: "Bot kredisi, Yenilikler ve resmi bot çalışma alanları",
    },
    "0.1.24": {
      zh: "ZIP 技能导入和聊天记录搜索",
      "zh-TW": "ZIP 技能匯入和聊天記錄搜尋",
      en: "Import ZIP skills and search chat history",
      ja: "ZIP スキルのインポートとチャット履歴検索",
      ko: "ZIP 스킬 가져오기와 대화 기록 검색",
      ru: "Импорт навыков из ZIP и поиск по переписке",
      es: "Importa habilidades en ZIP y busca en el historial de chats",
      pt: "Importe habilidades em ZIP e pesquise no histórico de conversas",
      tr: "ZIP becerilerini içe aktar ve sohbet geçmişinde ara",
    },
    "0.1.10": {
      zh: "机器人能收微信里的图片和文件了",
      "zh-TW": "機器人能收微信裡的圖片和檔案了",
      en: "Bots can now see the images and files you send",
      ja: "送信した画像やファイルをボットが読み取れるようになりました",
      ko: "이제 보낸 이미지와 파일을 봇이 읽을 수 있습니다",
      ru: "Теперь боты могут просматривать отправленные изображения и файлы",
      es: "Los bots ya pueden ver las imágenes y los archivos que envías",
      pt: "Agora os bots conseguem ver as imagens e os arquivos que você envia",
      tr: "Botlar artık gönderdiğin görselleri ve dosyaları görebiliyor",
    },
  } satisfies Record<string, Record<Lang, string>>,
};

/** 轮播间隔（毫秒） */
export const ROTATE_MS = 6000;

/** 宣传 / 公告，按顺序排在发版提示后面 */
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "promo-free-app",
    kind: "promo",
    zh: { tag: "免费开源", text: "一个 Key 用上 {modelCount} 个模型", cta: { label: "看价格", href: "/pricing" } },
    "zh-TW": { tag: "免費開放原始碼", text: "一個 Key 用上 {modelCount} 個模型", cta: { label: "看價格", href: "/pricing" } },
    en: { tag: "Free app", text: "One key for {modelCount} models", cta: { label: "Pricing", href: "/pricing" } },
    ja: { tag: "無料・オープンソース", text: "1つのキーで{modelCount}のモデルを利用", cta: { label: "料金", href: "/pricing" } },
    ko: { tag: "무료 오픈 소스", text: "키 하나로 모델 {modelCount}개 이용", cta: { label: "요금", href: "/pricing" } },
    ru: { tag: "Бесплатное приложение", text: "Моделей с одним ключом: {modelCount}", cta: { label: "Цены", href: "/pricing" } },
    es: { tag: "App gratis", text: "Una sola clave para {modelCount} modelos", cta: { label: "Precios", href: "/pricing" } },
    pt: { tag: "App grátis", text: "Uma só chave para {modelCount} modelos", cta: { label: "Preços", href: "/pricing" } },
    tr: { tag: "Ücretsiz uygulama", text: "{modelCount} model için tek anahtar", cta: { label: "Fiyatlar", href: "/pricing" } },
  },
  // 社群开通（链接在 data/community.ts）：中文站主按钮去 QQ 群，其他语言去 Discord；次要链接都是 Telegram。只挂一个月
  {
    id: "promo-community-2026-11",
    kind: "promo",
    start: "2026-11-15",
    end: "2026-12-15",
    zh: { tag: "社群", text: "官方 QQ 群开通了，用法和想法都能来聊", cta: { label: "加入 QQ 群", href: COMMUNITY.qq.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
    "zh-TW": { tag: "社群", text: "到 Discord 或 Telegram 和我們聊聊", cta: { label: "加入 Discord", href: COMMUNITY.discord.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
    en: { tag: "Community", text: "Come chat with us on Discord or Telegram", cta: { label: "Join Discord", href: COMMUNITY.discord.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
    ja: { tag: "コミュニティ", text: "Discord と Telegram で気軽に話しましょう", cta: { label: "Discord に参加", href: COMMUNITY.discord.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
    ko: { tag: "커뮤니티", text: "Discord와 Telegram에서 함께 이야기해요", cta: { label: "Discord 참여", href: COMMUNITY.discord.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
    ru: { tag: "Сообщество", text: "Общайтесь с нами в Discord и Telegram", cta: { label: "Открыть Discord", href: COMMUNITY.discord.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
    es: { tag: "Comunidad", text: "Charla con nosotros en Discord o Telegram", cta: { label: "Unirme a Discord", href: COMMUNITY.discord.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
    pt: { tag: "Comunidade", text: "Converse com a gente no Discord ou no Telegram", cta: { label: "Entrar no Discord", href: COMMUNITY.discord.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
    tr: { tag: "Topluluk", text: "Discord veya Telegram'da bizimle sohbet et", cta: { label: "Discord'a katıl", href: COMMUNITY.discord.url }, link: { label: "Telegram", href: COMMUNITY.telegram.url } },
  },
  // 公告示例（维护通知）：到点自动出现、过期自动消失，复制后改 id、时间和文案即可
  // {
  //   id: "notice-2026-11-maintenance",
  //   kind: "notice",
  //   tone: "warn",
  //   start: "2026-11-07",
  //   end: "2026-11-08",
  //   countdown: true,
  //   zh: { tag: "维护", text: "11 月 8 日 02:00–04:00（北京时间）下载服务维护", link: { label: "更新日志", href: "/changelog" } },
  //   en: { tag: "Maintenance", text: "Downloads are under maintenance on Nov 8, 02:00–04:00 (UTC+8)", link: { label: "Changelog", href: "/changelog" } },
  // },
];
