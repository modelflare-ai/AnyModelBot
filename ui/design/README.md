# AnyModelBot 设计库

界面样式的唯一来源。无构建步骤：原生 CSS（`@layer` + 自定义属性）+ Preact/htm 组件。

- 样例页：本机服务的 `/amb/static/design/index.html`。token 表直接从 `tokens/*.css` 解析，不会和代码脱节；支持浅色/深色和双主题对照，也能模拟"减少动态效果"；设置 › 外观里的偏好（字体大小、字体、动画、毛玻璃）在样例页里同样生效。
- 守卫测试：`test/design-system.unit.test.ts`。`npm test` 时检查规范有没有被破坏（规则见文末）。

## 目录

```
ui/design/
  index.css              入口：声明层顺序并按层引入下面所有文件
  tokens/
    primitives.css       L1 原始值：品牌/状态色板，间距、字号、圆角、控件高度、层级等尺度
    semantic.css         L2 语义 token：按用途命名、按主题取值（浅色 + 深色）；另有与主题无关的间距角色、字体与用户偏好
    motion.css           动效 token：时长、缓动、位移量、--motion 开关
  base/
    reset.css            重置、焦点环、可选中规则
    motion.css           关键帧库 + .anim-* 工具类 + 减少动态效果
    typography.css       文字角色 .t-*（在 utilities 层）
    utilities.css        .stack .cluster .grow .truncate .tone-* .sr-only
  components/            一个组件一个文件：icon glass button field badge list seg switch popover model-family sheet splitter toast notice feedback avatar
  motion.js              ms("--dur-base")、usePresence()、reducedMotion()
  index.html / gallery.* 样例页
ui/css/                  页面样式（shell / chat / settings / guide），放在 app 层
ui/components/ui.js      组件的 JS 写法：Icon Button IconButton Notice Skeleton Seg Switch Menu MenuButton Sheet …
```

## 层叠顺序

```css
@layer tokens, base, components, app, utilities;
```

后面的层总是赢，和选择器权重无关：

- 页面样式（`ui/css/*.css`，整个文件包在 `@layer app { … }` 里）可以直接覆盖组件，不用拼权重。
- 工具类和文字角色在最后，加上就生效。
- 新的页面样式文件也要包进 `@layer app`，否则它会是"无层"样式，压过所有层。

## Token

**分两层。** 原始值（`--lime-500`、`--space-3`、`--r-md`）描述"有什么"；语义 token（`--accent-solid`、`--line`、`--muted`）描述"用在哪"。

| 类别 | 规则 |
|---|---|
| 颜色 | 页面和组件**只用语义色**。原始色板只在 `semantic.css` 里引用。新颜色先加语义 token（两个主题都要给值），再用。 |
| 字号 | 9 级 `--fs-2xs … --fs-4xl`（11 / 11.5 / 12.5 / 13 / 14 / 15 / 17 / 20 / 22），都乘以 `--fs-scale`（设置 › 外观 › 字体大小）。新界面优先用文字角色 `.t-*`；跟着文字走的长度（比如输入框行高 `--composer-line`）也乘 `--fs-scale`。 |
| 字重与字距 | `--fw-semibold` 只给标题：页面、分组、对话框、顶栏与面板标题、提问卡的问题、正文里的标题、11px 小标签。名称一类（机器人名、文件名、模板名、账户名、信息面板的行）用 `--fw-medium`；设置页的行名称用常规字重，层次交给分组标题和 `--muted` 的说明。大标题用 `--tracking-tighter`（-.015em）、二级标题 `--tracking-tight`（-.01em）——中文字形本来就满，不要收得更紧；行高用 `--lh-*`，不写 1.45 这类散值。 |
| 字体 | 只用 `--font` / `--code`。它们默认是各平台的系统字体 `--font-system` / `--code-system`，用户可以换成衬线 `--font-serif` 或自定义字体（见「用户偏好」）。 |
| 圆角 | `--r-xs … --r-3xl`、`--r-full`。同一种面用同一个圆角角色：`--r-well`（内容里的一组）、`--r-pane`（面板与浮层）、`--r-bubble`（消息气泡），见「容器与层次」。嵌套时内层 = 外层 − 内边距（`.seg`、`.pop` 里的列表项就是这样算的）。圆形用 `50%`。 |
| 间距 | 4 的倍数 `--space-1 … --space-16`，另有 `-0-5 / -1-5 / -2-5 / -3-5` 半步。页面和组件先用按用途命名的间距角色（见下文「间距」）。写死的像素只允许 0、≤1px 的细线，以及同一行带 `/* 微调：… */` 注释的光学微调。 |
| 控件高度 | `--ctl-xs … --ctl-2xl`（22 / 24 / 28 / 32 / 36 / 44）。 |
| 细线 | `--hairline`：一个物理像素（普通屏 1px，高分屏 .5px）。面板、玻璃浮层、黄绿填充面的细边都用它——写死 `.5px` 在 1x 屏上会被抗锯齿成一道若有若无的虚影。 |
| 层次 | `--well` / `--well-hover` / `--well-press`（内容里的一组，只有这一层）；`--line-2`（行间细线）；`--ctl-edge` / `--ctl-edge-hover`（输入框的边，≥ 3:1）；`--red-wash` / `--amber-wash`（提示行的淡底）。规则见「容器与层次」。 |
| 投影 | `--shadow-xs / sm / md / lg`；`--shadow-pane`（浮在环境光上的面板）、`--shadow-tile`（侧栏选中项，只有投影）、`--shadow-float` / `--shadow-pop`（玻璃的边 + 投影）、`--primary-edge`、`--seg-edge`（分段 thumb、开关圆钮，只有投影）。深色下更重，都是主题 token。内容里的组不加投影。 |
| 层级 | 只用 `--z-*`；同一窗格内的浮动件用 `calc(var(--z-float) ± 1)`。 |
| 焦点 | 输入框：accent 描边（浅色墨、深色黄绿）+ `box-shadow: var(--ring)` 黄绿光晕（错误时 `--ring-danger`）；其他控件：全局 `:focus-visible` 2px 描边、外移 2px，装在会裁切的容器里时用 `--focus-offset` 往里收。 |

现有语义色名（`--bg --card --pill --line --fg --muted --accent …`）沿用 magpie 的叫法，分组见 `semantic.css` 里的 `/* —— 组 —— */` 注释。

## 间距

页面和组件先用**间距角色**（`semantic.css` 里与主题无关的 `:root` 块，样例页「间距与尺寸」里有表），没有合适的角色时才直接用 `--space-*`。**一个角色只用一个值**：同一种用途不要这里 10、那里 12、别处 14。

| 角色 | token | 值 | 用在哪 |
|---|---|---|---|
| 面板间隙 | `--pane-gap` | 8 | 主区、信息面板离窗口边缘；弹出层离窗口边缘 |
| 面板内容边距 | `--pane-px` | 16 | 信息面板的标题与行文字、对话顶栏的头像 |
| 顶栏边距 | `--head-px` | 10 | 对话、信息面板、新建页的顶栏到首尾按钮 |
| 工具栏间隙 | `--bar-gap` | 4 | 一排图标按钮：顶栏、输入框工具栏、消息操作 |
| 侧栏边距 | `--side-inset` | 8 | 侧栏的行、搜索框、顶部按钮、账户离侧栏边缘 |
| 侧栏行内边距 | `--side-row-px` | 10 | 机器人行、设置导航、账户、返回、搜索框 |
| 侧栏行间隙 | `--side-row-gap` | 2 | 相邻两行 |
| 内容列边距 | `--page-gutter` | 24（窗口窄于 1000px 时 16） | 对话列、输入框、设置页、新建页、引导页两侧至少留这么多 |
| 页面上 / 下边距 | `--page-top` / `--page-bottom` | 48 / 64 | 设置页、新建页、引导页 |
| 分组间距 | `--section-gap` / `--section-gap-sm` | 32 / 20 | 页面里 / 窄面板里分组标题的上方 |
| 标题到内容 | `--heading-gap` | 10 | 页面分组标题的下方 |
| 卡片内边距 | `--card-pad` | 16 | 提问 / 审批卡、引导页卡片、侧栏空状态、模板卡 |
| 对话框内边距 | `--sheet-pad` | 20 | `.sheet` |
| 按钮组间隙 | `--ctl-gap` | 8 | 对话框、卡片、展开编辑区里的一组操作 |
| 浮层离窗口 | `--float-inset` | 16 | 提示胶囊、命令面板、对话框 |
| 弹出层离锚点 | `--pop-offset` | 6 | `usePopPosition`（JS 读 token 的像素值，不写死） |

**对齐的线**，改间距时守住：

- **顶部中线**：侧栏顶部先让出 `--pane-gap` 再放 `--head-h`，新建按钮和主区、信息面板的顶栏按钮在同一条水平线上；搜索框的上沿就是顶栏的下沿。顶栏里的图标按钮一律 28（`--ctl-md`）：16 的图标四周各 6，算对齐时按图标的外沿算。
- **窗口标题栏**：桌面版没有系统标题栏，侧栏顶部这一行就是标题栏。左上角看平台：macOS 让给红绿灯（`--titlebar-inset`），不放 Logo（应用名在菜单栏里）；Windows（`:root.win-app`）放应用图标（`--brand-mark` 20）+「AnyModelBot」，图标的左沿落在侧栏竖线上，整块是拖动区。Windows 的右上角是系统画的最小化 / 最大化 / 关闭，和这一行一样高、贴住窗口右上角；最右边的顶栏（信息面板开着时是面板的顶栏，关着时是主区的顶栏）右边多让出 `--caption-reserve`，这时两种顶栏不再左右对称。信息面板自己的关闭钮在 Windows 上不放，免得和窗口的关闭钮挨成两个 ×。浏览器里和 Linux 桌面版用的是系统 / 浏览器的标题栏，这些都不出现。
- **底边**：侧栏的账户行离窗口下沿 `--pane-gap`，和主区、信息面板的下沿对齐；"已保存"浮在账户行上方一个 `--side-inset`，左边和侧栏的行对齐。
- **侧栏竖线**：行、搜索框、账户的边离侧栏边缘 `--side-inset`；头像、导航图标、搜索图标、返回箭头都在 `--side-inset + --side-row-px`（18）；搜索框的文字、"返回应用"和设置导航的文字在同一条竖线上（搜索图标 14 + 间隙 12 = 导航图标 16 + 间隙 10）。新建按钮的图标右沿落在行文字的右边线上（同样离侧栏右边 18），和机器人行的时间右对齐。机器人列表的右边距用外边距：滚动条贴着行的右边，不落进侧栏和主区之间的空隙（那里是分隔条）。
- **空隙**：侧栏与主区、主区与信息面板之间都是 `--pane-gap`；分隔条就放在空隙正中（见「分隔条」）。
- **面板竖线**：信息面板的标题、分组标题、行文字、展开编辑区、待审批说明都在 `--pane-px`（16）；对话顶栏是 `--head-px` + 按钮自带的 6，头像也落在 16。两种顶栏都左右对称：最右边那个图标的外沿同样离面板右边 16。
- **输入框**：加号钮和发送钮都是 32 的圆、离输入框的边 `--composer-pad`（8），加号的图标框正好落在文字的起点（16）上；模型、权限胶囊矮一档（28），不和两端的圆钮抢。
- **居中列**：对话列和输入框同宽 `min(--col-w, 100% − 2 × --page-gutter)`，设置页、新建页、引导页两侧也至少 `--page-gutter`。对话列的下边距和"回到底部"的位置由输入框高度 `--composer-h` 算出来。
- **弹出层**：列表离边缘 `--pop-pad`（4），项再缩进 8，于是项的文字、分组名、分隔线、搜索图标、空状态都在离边缘 12 的线上。
- **行**：默认行上下 6，"标题 + 说明"两行的行和一行的行一样高（48）；`.row.compact` 只是矮一些，左右和默认行一样；`.row-edit` 的左右也和行一样，输入框和上面那行的文字对齐。

**写死的像素**只允许三种：`0`；≤1px 的细线（比如 `right: -1px` 压住描边）；同一行带 `/* 微调：理由 */` 注释的光学微调，守卫测试认这个注释。尺寸（宽、高、控件大小）不算间距，但 `calc()` 里加减的像素算（`calc(100% - 48px)` 其实是两侧的边距）。

## 品牌色

品牌色是 Modelflare 的**信号黄绿 `#d7ff00` + 墨色 `#161a00`**。界面骨架是纯灰阶（布局参考 Grok Bot / Codex），颜色留给两样东西：品牌信号和机器人头像。

**一句话：墨色负责操作，黄绿是"亮起的信号"。** 黄绿在白底上只有 1.15:1，所以它永远是**填充面**或**墨色上的光**，不当浅色背景上的文字和细线用。

| 角色 | token | 浅色 | 深色 |
|---|---|---|---|
| 主操作：主按钮、打开的开关 | `--primary` / `--on-primary` | 墨底白字 | 黄绿底墨字 |
| 发送 / 停止 | `--send-bg` / `--send-fg` | 墨色圆钮 + **黄绿箭头** | 黄绿圆钮 + 墨色箭头 |
| 焦点、勾选、指示点、链接 | `--accent` | 墨色 | 黄绿 |
| 输入框聚焦光晕 | `--ring`（`--accent-soft`） | 黄绿光晕 | 弱黄绿光晕 |
| 荧光笔：选中文字、定位闪烁 | `--mark` / `--on-mark` | 浅黄绿底墨字 | 暗黄绿底 |
| 品牌填充：应用标志、"已保存" | `--accent-solid` / `--on-accent` | 黄绿底墨字 | 同左 |

不要用品牌色的地方：分段控件的 thumb、菜单当前项、选中的侧栏行、用户气泡（都是中性灰）；状态（成功、工作中）用 `--green`，不要用黄绿冒充。

## 材质

窗口是分层的，越往上越"实"：

| 层 | 是什么 | token |
|---|---|---|
| 环境光 | 窗口最底层：`--bg` + 左上的品牌黄绿光 + 跟着当前机器人角色变色的色相光（切换机器人时 `--dur-ambient` 慢慢过渡）。`.app`、引导页、样例页的 `.aura-bg` 共用 | `--bg --aura-brand --aura-l --aura-c --aura-a`，色相 `--aura-hue` 由 `main.js` 设 |
| 侧栏 | 直接盖在环境光上的毛玻璃（底下是平滑的光，不需要模糊） | `--glass-side` |
| 主区、信息面板 | 浮在环境光上的圆角面板，四周留 `--pane-gap` | `--surface`、`--glass-panel`，`--shadow-pane` |
| 顶栏、输入框、回到底部 | 盖在滚动内容上的玻璃，内容从底下滚过是模糊的 | `--glass-chrome`、`--glass-float` + `--glass-filter` |
| 菜单、命令面板、提示、对话框 | 最上层的玻璃，模糊最重 | `--glass-pop`、`--glass-sheet` + `--glass-filter-lg`，`--shadow-pop` |

一块玻璃 = 半透明底 + 背景模糊 + 磨砂颗粒 `--grain` + 顶边高光 `--glass-hi` 与细描边 `--glass-edge`。写法：

```css
.pop { background: var(--grain), var(--glass-pop); backdrop-filter: var(--glass-filter-lg); box-shadow: var(--shadow-pop); }
<div class="glass" style="--glass-bg: var(--glass-chrome)">…</div>   /* 临时用：.glass + --glass-bg / --glass-blur / --glass-shadow */
```

- **填充、悬停、描边都是半透明的一层**（`--pill*`、`--side-*`、`--line*`、`--sel*`），放在玻璃和实色上都对。不要在玻璃上用实色灰。
- **`backdrop-filter` 会让元素变成 `position: fixed` 子元素的包含块**。里面会渲染菜单、对话框的容器（侧栏、主区、`.chat`）不要加，模糊只加在叶子级的浮层上。
- 关掉毛玻璃（`<html data-glass="off">`：设置 › 外观 › 毛玻璃效果；跟随系统时看"降低透明度" `prefers-reduced-transparency`），材质换成接近实色、`--glass-filter*` 变成 `none`，层次靠浮层的细边和投影。
- **模糊只给浮层**：对话框、命令面板后面的遮罩只压暗、不模糊——对话框自己的玻璃已经模糊了一层，两层叠在一起既糊又费 GPU。

## 容器与层次

一句话：**成组靠底色和间距，不靠描边；一组里面不再套一组。**

| 层 | 是什么 | 怎么画 |
|---|---|---|
| 面板 | 主区、信息面板（浮在环境光上） | `--surface` / `--glass-panel` + `--shadow-pane`（带 .5px 的边：浅色下面板和环境光只差 1.1:1）、`--r-pane` |
| 一组（只有这一层） | 设置分组 `.list`、对话里的提问 / 审批卡 `.card`、代码块、文件、模板卡、行内提示、信息面板里展开的编辑区和待审批 | `--well` 底色 + `--r-well`，**不描边、不加投影**；可点的组悬停 `--well-hover`、按下 `--well-press` |
| 组里的东西 | 行、命令、选项、按钮、输入框 | 直接排在组里：行与行之间一条 `--line-2` 细线（真需要分开时才加）；命令就是一行等宽字；选项是可悬停的行 |
| 浮层 | 对话输入框、回到底部、菜单、命令面板、对话框、提示胶囊、引导页卡片 | 玻璃材质（见「材质」）：`--glass-edge` 细边 + 投影是浮层自己的边，不另加描边 |

- **不嵌套**：`--well` 里不再放 `--well`、卡片或描边框。审批卡里的 `write_file …` 就是一行等宽字；选项字母平时只是一列字，选中才填成一块（这是状态，不是容器）；图标不套底片（模板卡选中时图标亮成黄绿片，也是状态）。对话框里不再套卡片："更换密钥"的表单直接排在对话框的内边距里。信息面板上的行直接排在面板上，只有展开的编辑区和待审批是一层 `--well`。
- **描边只给两种东西**：
  1. 文字输入框 `.field`：`--ctl-edge`，对它可能落在的每一种表面（主区、信息面板、对话框、`--well`）都 ≥ 3:1（两个主题都约 3.2:1），底色透明；悬停 `--ctl-edge-hover`，聚焦换 accent + `--ring`。这是界面里唯一常驻的边——看到边就知道"这里能打字"。
  2. 浮层玻璃的细边 `--glass-edge`，以及黄绿填充面的墨色细边 `--accent-line`（黄绿在白底上只有 1.15:1：应用标志、"已保存"、选中模板的图标）。
- **分隔线**只用在行与行之间（列表行、表格行、菜单分隔、正文 `hr`、"用时"下面），≤ 1px 的 `--line-2`（表头下沿用 `--line`）。表格不画格子：没有外框、竖线和表头底色，第一列贴着正文左边。
- **不加侧边色条**：提示 `.notice` 是一行淡底（`--red-wash` / `--amber-wash` / `--well`）+ 左边一个图标 + `--fg` 的字（在淡底上 ≥ 14:1）；语气靠图标颜色，不要"淡红底 + 红边 + 左侧粗红条"，也不要淡红底上的红字（对比度不够）。引文 `blockquote` 的灰色竖线是排版记号，可以留。
- **描边和投影不叠在同一个元素上**：内容里的组两样都不要；浮层只有"玻璃细边 + 投影"这一种写法；侧栏选中项、分段 thumb、开关圆钮只有投影。
- **状态用点，不用彩色胶囊**：`.badge` 是"状态点 + 文字"（和设置页的「● 已连接」同一种写法）；只有计数 `.badge.count` 保留一小块底。
- **小标签**：分组名、菜单分组一律 `.t-label`（11px semibold、`--muted`），不全大写、不加字距、不用 `--faint`（读不清）。
- **同一种面同一个圆角**：`--r-well`（12）、`--r-pane`（14）、`--r-bubble`（20）。
- **不用装饰性 emoji**：服务端用 `⚠️` 标记出错的消息（微信、飞书里只能这样），界面里显示前去掉，语气交给 `Notice` 的图标。

**可交互的东西要认得出来**（非文字对比度 ≥ 3:1，或者有等效的提示）：

- 输入框：`--ctl-edge` 本身 ≥ 3:1。
- 对话输入框是浮层，认得出它靠浮起的投影、常显的占位文字（`--placeholder`，3:1）、工具栏和发送钮、固定在底部的位置，输入时投影变大；侧栏搜索框靠放大镜图标 + 占位文字 + 底色，聚焦时 accent 描边 + 光晕。
- 按钮、分段、开关、下拉靠文字和填充；键盘焦点一律 2px accent 描边（`:focus-visible`），输入框是 accent 描边 + `--ring`。

真的需要一道边时，在**同一行**写 `/* 描边：理由 */`，守卫测试认这个注释（`ui/` 下除 token 文件外的所有 CSS）。

## 状态

每个可交互组件都要把下面这些状态想到；样例页的「状态矩阵」把它们按浅色 / 深色并排画出来（伪类规则被复制成 `.is-hover / .is-active / .is-focus`，和真实交互是同一份样式）。

| 状态 | 怎么表现 | 用什么 |
|---|---|---|
| 悬停 | 叠一层半透明，静默控件的字从 `--ctl-fg` 变 `--fg`；可点的组（模板卡）底色深一级，不浮起、不加描边 | `--pill` → `--pill-hover`，`--well` → `--well-hover`；侧栏里也是一层淡灰 `--side-hover`（侧栏本来就接近白色，再亮一层看不出来），和选中的白色玻璃片一暗一亮 |
| 按下 | 再深一级，并轻微缩小（`--press` / `--press-strong`）；列表行只变色不缩放 | `--pill-press`、`--sel-press`、`--side-press` |
| 键盘焦点 | `:focus-visible` 2px `--accent` 描边；输入框是描边 + 光晕 | `--focus-offset`、`--ring` |
| 打开 | 菜单展开时触发它的按钮保持"按住"的样子，箭头翻转，加号转成叉 | `[aria-expanded="true"]`，`.icon-btn.on` |
| 选中 / 当前 | 侧栏行和设置导航是浮起的玻璃片；菜单当前项打勾；模板卡铺一层 `--accent-wash`、图标亮成黄绿片；头像选择是底色深一级 + 名字变实（头像在"听"）。都不描边 | `--side-active` + `--shadow-tile`，`--accent-wash`，`--pill-press` |
| 禁用 | `--o-disabled`，不响应悬停和按下；主按钮和发送钮退成中性灰（半透明的墨色或黄绿会发浑） | `:disabled` |
| 加载 | 转圈，颜色不变，只是不可点（`aria-busy`） | `Button loading` |
| 错误 | 红描边，聚焦时红光晕 | `.err` / `aria-invalid`，`--ring-danger` |
| 只读 | 次级底，聚焦不发光 | `[readonly]` |
| 滚动边缘 | 内容滚到顶栏底下时，顶栏才出现细线和投影 | `.chat.scrolled` |

## 分隔条

两块面板之间的空隙可以拖：侧栏 | 主区、主区 | 信息面板。组件是 `Splitter`（`ui/components/ui.js`），样式在 `components/splitter.css`。

| 方面 | 规范 |
|---|---|
| 位置 | 就是面板之间那道 `--pane-gap` 空隙，分隔条的中线落在空隙正中；能抓住的宽度 `--split-hit`（12）比空隙宽一点，两边各探进面板 2px。Electron 里是 `no-drag`，盖在顶栏的拖动区上也抓得住 |
| 平时 | 看不见，指针移上去只变成 ↔（`col-resize`） |
| 悬停 | 停住 `--dur-intent` 后空隙中间从中点长出一道 2px 的细线 `--split-line`；只是划过去不闪，移开立刻消失。细线只画在面板直边那一段（上下让出 `--pane-gap + --r-pane`） |
| 拖动 | 细线换成 `--split-line-on`（`--accent`：浅色墨、深色黄绿）；整个窗口都是 ↔、不会选中文字（`<html data-resizing>`）；宽度跟手（直接写 CSS 变量，不经过渲染，列宽不过渡）；离默认宽度 6px 以内吸附回默认；到了最窄 / 最宽，指针换成单向箭头 |
| 范围 | `--side-w-min … min(--side-w-max, --side-w-cap)`（220 … 400，且不超过窗口的 36%），信息面板 `--panel-w-min … min(--panel-w-max, --panel-w-cap)`（280 … 440，34%）；拖动时还要给主区留至少 `--main-w-min` |
| 恢复 | 双击分隔条恢复默认宽度，列宽用 `--dur-slow` + `--ease-spring` 滑回去 |
| 键盘 | `role="separator"`，可以 Tab 到；焦点就是那道 accent 细线（不画外描边）。← → 一次 8px、Shift 一次 32px，Home / End 最窄 / 最宽，Enter 恢复默认 |
| 保存 | 松手、键盘、双击时提交一次：`lib/prefs.js` 的 `sideW` / `panelW`（px，0 = 默认），每个窗口各一份；首帧前 `index.html` 先写到 `<html>` 上的 `--side-w-user` / `--panel-w-user`，不闪 |
| 不出现 | 窗口窄于 1180px 时信息面板是浮在对话上的抽屉，它的分隔条隐藏 |

页面怎么接：列宽在 `.app` 上用 `clamp(-min, var(-user, 默认), min(-max, -cap))` 算出来（`--side-col`、`--panel-col`），分隔条用 `--split-x` 定位到空隙中线：

```css
.app > .split-side { --split-x: calc(var(--side-col) - var(--pane-gap) / 2); }
<${Splitter} class="split-side" size="--side-w" label="调整侧栏宽度" value=${sideW} room=${…} onCommit=${(px) => setPrefs({ sideW: px })} />
```

`--side-col`、`--panel-track`（信息面板那一列此刻的宽度：关着是 0）注册成 `<length>`（`@property`，不继承），所以信息面板开合、恢复默认时列宽能平滑过渡：面板本身定宽，列变窄时它往右滑出窗口，里面的内容不会被挤扁重排。

## 主题

- `<html data-theme>` 总是解析后的 `light` / `dark`（`index.html` 首帧前设置，`lib/theme.js` 同步）。
- **主题可以局部生效**：任何元素加 `data-theme="dark"`，它的子树就换一套语义 token（样例页的双主题对照就是这样做的）。
- 因此**不要写** `:root[data-theme="dark"] .xxx { … }` 这类按主题的覆盖。需要两个主题不同的值，就加一个语义 token。
- 由其他语义 token 推导的值（`--ring`、`--code-bg`）写在 `:root, [data-theme] { … }` 里，每个作用域都会重新计算。

## 用户偏好

设置 › 外观（和常规里的发送键、通知）是**本机界面偏好**，和主题一样存在 localStorage（`amb-prefs`，`lib/prefs.js`），每个浏览器 / 桌面窗口各一份。外观类的偏好解析成 `<html>` 上的属性，`semantic.css` 的「用户偏好」块和 `motion.css` 把属性翻译成 token——**页面和组件只用 token，不认这些属性**：

| 属性 | 取值 | 翻译成 |
|---|---|---|
| `data-text` | `sm / md / lg / xl` | `--fs-scale`（.92 / 1 / 1.1 / 1.2）：只放大文字，控件高度、图标、间距不变；整体放大是桌面版的「界面缩放」（Electron zoom） |
| `data-font` | `system / serif / custom` | `--font`；`custom` 时 `prefs.js` 在 `<html>` 上内联 `--font: "自定义", var(--font-system)`。自定义代码字体同样内联 `--code` |
| `data-width` | `normal / wide / full` | `--col-w`、`--bubble-w`（对话列和输入框） |
| `data-code-wrap` | `on / off` | `--code-wrap`（代码块的 `white-space`） |
| `data-glass` | `on / off` | 材质（见「材质」） |
| `data-motion` | `full / reduce / off` | `--motion`、`--press*`、`--dur-*`（见「动效」） |

- 首帧前 `index.html` 的内联脚本按同样的规则先套一遍，避免闪；改解析规则时它和 `prefs.js` 的 `apply()` 一起改。
- "跟随系统"在 JS 里解析：属性永远是解析后的值，CSS 里不写 `@media (prefers-reduced-*)`。

## 组件

每个组件把可调的地方开放成自己的变量。**变体、尺寸和上下文覆盖都只改变量，不改属性**：

```css
.btn.primary { --btn-bg: var(--accent-solid); --btn-fg: var(--on-accent); … }   /* 变体 */
.notice .btn { --btn-h: var(--ctl-sm); --btn-px: var(--space-2-5); }            /* 上下文 */
```

| 组件 | 类名 API | 变量 |
|---|---|---|
| 按钮 | `.btn [primary\|ghost\|danger] [sm\|lg] [block]` | `--btn-h --btn-px --btn-r --btn-fs --btn-bg --btn-bg-hover --btn-bg-press --btn-fg --btn-fg-hover --btn-edge` |
| 毛玻璃 | `.glass`（组件自己是玻璃时直接写三行，见「材质」） | `--glass-bg --glass-blur --glass-shadow` |
| 图标 | `Icon`（`svg.ic [ic-xs\|ic-sm\|ic-md\|ic-lg\|ic-xl] [ic-strong]`），见下文「图标」 | `--ic-size --ic-w` |
| 图标按钮 | `.icon-btn [xs] [on]`；`IconButton` 的 `iconSize` 缺省 `sm` | `--ib-size --ib-r --ib-fg --ib-fg-hover --ib-bg-hover --ib-bg-on --ib-bg-press` |
| 文字按钮 | `.text [danger\|accent]` | — |
| 输入框 | `.field [mono] [err]`，`.field-wrap > .field + .tail`；边是 `--ctl-edge`（≥ 3:1），底透明 | `--field-h --field-px --field-r --field-bg --field-edge --field-edge-hover --field-edge-focus --field-ring` |
| 状态 / 计数 / 点 | `.badge [ok\|err\|warn\|off]`（状态点 + 文字），`.badge.count [warn]`（计数，唯一带底的徽标），`.dot [ok\|err\|warn]` | `--badge-fg`（点的颜色；计数的字色）`--badge-bg`（只对计数），`--dot-bg` |
| 列表行 | `.list > .row [compact] [clickable] [off] [flash]`，`.row-edit`，`.list-head`；`.list` 是一块 `--well`，行间 `--line-2` | `--row-h --row-py --row-pl --row-pr --row-gap` |
| 分段 | `Seg` 组件（`.seg > .thumb + button`），两个以上的选项 | `--seg-r --seg-pad --seg-thumb --seg-on` |
| 开关 | `Switch` 组件（`button.switch[role=switch] [sm]`），只有开 / 关 | `--switch-w --switch-h --switch-pad --switch-track --switch-track-hover --switch-dot --switch-stretch` |
| 菜单 | `.pick`，`.pop [up]`，`.palette`，`Menu` / `MenuButton` / `Popover` | `--pop-r --pop-pad` |
| 对话框 | `Sheet` / `confirmSheet()`（`.scrim > .sheet [wide]`） | `--sheet-w --sheet-r` |
| 分隔条 | `Splitter`（`.splitter [dragging]`），见下文「分隔条」 | `--split-x --split-hit --split-line-w --split-inset --split-line-on`；悬停色是语义 token `--split-line` |
| 提示胶囊 | `toast()` / `saved()` / `failed()`（`.toast [ok\|err\|warn]`） | `--toast-bg --toast-fg --toast-edge` |
| 行内提示 | `Notice`（自带图标）/ `.notice [amber\|red]`：淡底 + 图标 + `--fg` 字，不描边 | `--notice-bg --notice-ic` |
| 加载 | `Spinner`、`Skeleton`（`.skel [circle]`）、`.empty-state` | — |
| 头像 | `BotAvatar [bot\|char] [state] [cue] [lively] [pokeable] [greet] [neutral]`、`AvatarPicker`、`AppMark`；6 个内置角色，见下文「头像」 | `--avatar-aura --avatar-shadow`（主题），角色颜色 `--bot-*`（原画色，两个主题相同） |

JS 组件（`ui/components/ui.js`）只是给常用组合一个带逻辑的写法（loading、图标、无障碍属性）；直接写类名同样合法。

## 图标

线性图标，16 格画布、`currentColor`、圆头圆角（`ui.js` 的 `P`，样式 `components/icon.css`）。**细、轻、少**：图标是文字旁边的记号，不和文字抢分量。

| 档 | `size` | 像素 | 用在 |
|---|---|---|---|
| xs | `"xs"` | 12 | 下拉箭头（`.pick`、模型胶囊，上下文自动给）、`.icon-btn.xs` 里的关闭、实心圆点里的勾、列表行尾的 › |
| sm | `"sm"` | 14 | **默认**：`Button` / `IconButton` / `Notice` / 菜单的图标和勾、输入框尾部、行内操作（刷新、删除、复制）、侧栏和弹出层的搜索 |
| md | `"md"` | 16 | 顶栏与工具栏按钮（新对话、信息面板、关闭）、侧栏的新建 / 导航 / 账户 / 返回、对话输入框（加号、发送、停止、回到底部）、命令面板搜索 |
| lg | `"lg"` | 20 | 模板卡 |
| xl | `"xl"` | 24 | 文件卡片 |

- **线宽按显示像素算**：`--ic-stroke`（1.25px）对所有尺寸都一样，12px 的箭头和 24px 的文件图标一样细；`icon.css` 把它换算回画布单位（× 16 / 尺寸）。只有实心面上的图标加 `strong`（`--ic-stroke-strong` 1.6px）：发送钮的箭头、完成圆点里的勾——细线压在墨色 / 黄绿上会发虚。不要再传任意的 `stroke`。
- **只用这五档**，不写 13、15、17 这类中间值。图标和旁边的文字差不多高或略高一点：12.5–13px 的控件文字配 14，侧栏和顶栏配 16。
- **上下文改尺寸只改 `--ic-size`**（`.pick .ic { --ic-size: var(--ic-xs) }`），不要直接写 `width / height`——那样线宽会跟着缩放。`icon.css` 全部包在 `:where()` 里，任何上下文选择器都能盖过 `size` 属性。
- **实心的小部件**（信息 / 警告的点、省略号、停止方块、调色盘的色点）在 `P` 里写成 `{ s: 描边, f: 实心 }`，用 `dot(x, y, r)` 画圆点，不靠加粗线头冒充圆点。
- 新图标：留 1.75 格左右的边距（主体落在 2–14 之间），拐角 .75 的圆角，能用一条线就不用两条；画好在样例页「图标」一节里和现有图标并排看一遍粗细和大小。

## 动效

| 用途 | 时长 | 缓动 |
|---|---|---|
| 悬停、按下、颜色变化 | `--dur-fast` 120ms（`--t-fast`） | `--ease-out` |
| 出现 / 消失、提示胶囊、遮罩 | `--dur-base` 180ms | 入场 `--ease-out`，退场 `--ease-in` |
| 视图切换、面板、分段 thumb | `--dur-moderate` 240ms | `--ease-out` |
| 布局滑动：信息面板开合、分隔条恢复默认 / 键盘调宽 | `--dur-slow` 360ms | `--ease-spring` |
| 悬停意图：停住多久才亮起提示（分隔条的细线） | `--dur-intent` 240ms | 只延迟出现，移开立刻消失 |
| 对话框 / 弹出层的弹性入场 | `--dur-slow` 360ms / `--dur-slower` 420ms | `--ease-spring` |
| 循环（转圈、骨架、文字微光、呼吸、光标） | `--dur-spin --dur-shimmer --dur-sheen --dur-pulse --dur-blink` | `linear` / `--ease-in-out` |

- **关键帧库**（`base/motion.css`）：`fade-in/out`、`rise-in`、`sink-out`、`slide-in/out`、`pop-in/out`、`scale-in`、`bump`、`flash`、`spin`、`shimmer`、`sheen`（文字微光，配 `background-clip: text`）、`breathe`、`blink`。关键帧只描述起止，时长缓动由使用处给 token。
- **位移量是 token**：`--rise`、`--slide`、`--pop-dy`、`--pop-scale`、`--scale-from`，组件可以局部覆盖（`.toast { --rise: 6px }`）。
- **减少 / 关闭动画**：看 `<html data-motion>`（`full | reduce | off`，设置 › 外观 › 动画；跟随系统时看 `prefers-reduced-motion`）。关键帧里的位移都乘以 `--motion`；`reduce` 时 `--motion: 0`，所有入场自动退化成纯淡入，按下不缩放，过渡几乎瞬时；`off` 时 `--dur-fast … --dur-slower` 也变成 `--dur-off`，出现 / 消失 / 视图切换瞬时完成，只留转圈、骨架、光标这类"正在进行"的循环和定位闪烁。新写的关键帧也要乘 `--motion`；CSS 里不要再写 `@media (prefers-reduced-motion)`，JS 用 `reducedMotion()`（`design/motion.js`）。
- **退场动画**：用 `usePresence(open)`（`design/motion.js`）让组件在退场时长内保持挂载，并给元素加 `.leaving` / `.anim-*-out`。`DialogHost` 是参考实现。
- **JS 里不写死毫秒数**：`ms("--dur-base")` 读 token（toast 的移除时机就是这样同步的）。
- **每个动画都要有明确的表意**：只用来表达状态变化（出现 / 消失、选中、成功 / 失败）、对操作的反馈、真实在进行的过程（加载、生成、传输）、机器人的状态。**严禁背景 / 装饰层的动画**——背景、光晕、边框、纹理一律静止：不做自己循环的光圈 / 光框扩散（"隧道"、涟漪、雷达波）、呼吸的光晕、沿边框巡游的扫光、漂浮的光斑 / 粒子、跟随指针的点阵 / 聚光灯。说不出"它在告诉用户什么"的动画一律不加（官网同一条，见 `site/README.md`）。
- 只给 `transform` 和 `opacity` 做动画；空闲列表保持安静（头像空闲时只在指针靠近时看过去、悬停时抖一下天线，不自己动）。唯一的例外是对话里很快答完时工作状态行的收起（`.work.gone`，grid `1fr → 0fr`，只播一次），为的是正文不跳。

**对话流的编排**（`ui/css/chat.css`）：发出 → 思考 → 输出 → 收尾，每一步只动一样东西，幅度小，循环都放慢、对比只差一档，余光里知道"在动"就够了。

| 环节 | 动什么 | 怎么动 |
|---|---|---|
| 发出 | 你的气泡 | `fade-in`（base）+ `pop-in`（slow，spring），从下方 12px、缩放 .96，原点右下角（从发送钮那边送出去） |
| 思考 | 工作状态行 | 比气泡晚 `--stagger` 淡入；"思考中"是 `sheen` 微光：`--muted` 底上一道 `--fg-2` 的光，`--dur-sheen` 扫过去再停一拍 |
| 输出 | 新段落 / 列表项 | 新挂载的块淡入（moderate），已在的不重播；最后一段末尾一个 `breathe` 小点（代码块、表格结尾不画） |
| 收尾 | 状态行、操作 | "用时"换字淡入、细线淡入；短于 3 秒的整行平滑收起；最后一条回复的复制 / 时刻晚一拍淡入 |
| 插入 | 提问 / 审批卡、文件、出错提示 | `rise-in`（6px，moderate） |
| 输入框 | 投影、发送钮 | 聚焦时投影 moderate 长大；空时箭头小一号，有字时 `--ease-back` 回弹到位；发出后停止方块 `scale-in`，结束后箭头 `rise-in` 升回（只在发过之后）；点发送 / 停止不抢输入框焦点 |
| 其他 | 首次加载、回到底部 | 历史读到后整列淡入一次；回到底部 `rise-in` 出现、`sink-out` 退场，新消息点 `scale-in` |

## 头像

6 个内置毛绒角色（原图在 `anymodelbot_design/logo avator/`），蓝色的**小蓝是主角**：默认机器人、新建页的默认选择、启动和连接页的吉祥物都是它。

| 角色 | key | 招牌动作 | 推荐配给 |
|---|---|---|---|
| 小蓝 | `blue` | 天线晃、天线球亮、一圈圈发信号 | 默认助手、会议纪要 |
| 小萌 | `yellow` | 星星一闪一闪、完成时像硬币一样转 | 客服 |
| 绿草 | `green` | 叶子被风吹、完成时长高一截、出错时蔫了 | 群聊日报 |
| 红魔 | `red` | 耳机灯带跟着节拍亮、耳机震 | 代码助手 |
| 紫钻 | `purple` | 宝石浮起来转、霓虹线一明一暗 | 写作助手 |
| 探险者 | `orange` | 眼睛大范围搜寻、护目镜反光 | 翻译官 |

- **配对**：机器人设置的 `settings.avatar`（新建页和机器人设置里选；模板自带推荐，见 `screens/new-bot.js` 的 `TEMPLATES`）；没选过时 `charOf(bot)` 由 id 稳定地挑一个，`default` 机器人是小蓝。
- **持续状态** `state`：`idle`、`listening`（你在输入）、`thinking`（还没出字）、`replying`、`working`（后台任务）、`waiting`（等你批准）、`sleep`（连不上本机服务）。
- **一次性反应** `cue={ kind, at }`：`hello`（新建 / 打招呼，`greet` 在挂载时播）、`done`（忙 → 不忙时自动播）、`error`、以及戳头像触发的 `poke` / `love`（连戳三下）/ `dizzy`（戳六下）。时长是 `tokens/motion.css` 的 `--bot-*`。
- **lively**：只给大头像（空态、新建页、启动页）：呼吸、眨眼、四处看、脚下有影子。小于 36px 不画粒子。
- **图层**：`python3 scripts/build-bot-avatars.py` 把每张原图拆成头（眼睛已抹掉）、两只耳朵、头顶配件和发光部分，输出 `design/bots/<key>.webp`（8 格精灵图）。眼睛是 `avatar.js` 画的 SVG，才能眨眼和换表情（睁眼、开心、闭眼、难过、××、晕、爱心）。换原图后重跑脚本，几何有变化时同步 `BOT_CHARS` 里的百分比。

## 文案

- 最短、能说清就行：不加解释性的括号，不写说明段落。健康、空闲时什么都不显示。
- 一行里有状态，又跟着别的状态或事实（时间、花费、次数）时，写成一句自然的短句，不用「·」把碎片串起来：

  | 写成 | 不写成 |
  |---|---|
  | 进行中，有个问题等你回答 | 进行中 · 有个问题 |
  | 已进行 12 分钟，花了约 $0.08 | 进行中 · 12 分钟 · 约 $0.08 |
  | 观察中，明天 08:00 再运行 | 观察中 · 下次 明天 08:00 |
  | 第 1 次运行，用了 12 分钟 | 第 1 次 · 开始 · 34 步 · 12 分钟 |
  | 小蓝的「GPU 价格调研」在等你回答 | 小蓝 · GPU 价格调研 · 等你回答 |
  | 后台任务「GPU 价格调研」进行中 | 后台任务 · GPU 价格调研 · 进行中 |
  | 规则「看 X 价格」已观察 3 次，需要你来决定是否执行 | 已观察 3 次 · 改为执行？ |

- 句子里不帮人做决定的细节直接去掉，不往句子里塞（上面的「开始」「34 步」就是这样去掉的）。
- 不把「·」换成逗号了事：「Marla，由企业钱包付费」「需要你的批准，编号 A7K2」这样只是标签加碎片的，要么写成一句不带逗号的完整的话（「Marla 的费用由企业钱包支付」），要么留着「·」（「需要你的批准 · A7K2」）。
- 「·」只留给没有状态词、让人扫一眼的紧凑元信息：模型的上下文 · 能力 · 价格，「微信 · 3 天前」这样的来源和时间，运行记录展开后的「第 1 版 · 只读 · 手动运行」，诊断信息。
- 英文同样写成自然的句子，不照搬中文的断句：「Observing, next run tomorrow 08:00」「Run 1 took 12m 0s」「Ping: “GPU price research” is waiting for your answer」。句中的 today、tomorrow 小写。
- 中文、英文都要有（`ui/locales/`，服务端的在 `src/i18n/messages/`）。

## 新增或修改

1. 先在样例页里找现成的 token、组件、文字角色。
2. 缺颜色 → `semantic.css` 加语义 token（浅色、深色各一个值）；缺间距 → 先找同一用途的间距角色，没有再在 `semantic.css` 的间距块里加一个（取值来自 `--space-*`）；缺尺度 → `primitives.css`。
3. 新组件 → `components/<name>.css`，开放 `--<name>-*` 变量，在 `index.css` 按层引入；需要逻辑时在 `ui/components/ui.js` 加 JS 写法；在 `gallery.js` 加样例。
4. 页面专属样式写在 `ui/css/*.css` 的 `@layer app` 里，只引用 token。
5. 跑 `npm test`。

## 守卫测试会拦下

- `ui/design/tokens/` 之外出现原始颜色（`#hex`、不含 `var()` 的 `rgb()/hsl()`）
- `font-size` / `font` 里写死 px
- `border-radius` 写死 ≥ 3px（1–2px 的细节、`50%` 不算）
- `transition` / `animation` 里写死时长或缓动（`linear`、`steps()` 可以）
- `z-index` 写死数字
- 间距写死 px：`margin` / `padding` / `gap` / `inset` / `top|right|bottom|left` / `scroll-margin|padding`，以及 `--*-gap|pad|px|py|pl|pr|pt|pb|inset|gutter` 这类间距变量；`calc()` 里加减写死的 px。0、≤1px 细线、同一行带 `/* 微调：… */` 注释的除外
- JS 内联样式里写死颜色、字号或间距
- 描边容器：`border` / `outline` 带宽度，或 `box-shadow`（包括自定义属性的值）里画一圈 `0 0 0 <宽>` 的边，而同一行没有 `/* 描边：… */`；`:focus*` 选择器里的焦点描边除外
- 侧边色条：左右两侧 ≥ 2px 的 `border`，或 `box-shadow: inset Npx 0 0`；以及上下 > 1px 的分隔线（`var(--hairline)` 算 1px）
- JS 内联样式里画边框
- `text-transform: uppercase` 和正的 `letter-spacing`（小标签不全大写、不加字距）
- 引用了没定义的 `var(--x)`（带回退值的除外）
- 有组件或基础样式文件没在 `index.css` 里引入

组件文件里确实需要的"魔法数"（比如头像的眨眼周期），先起名再用：`--bf-blink: 4.2s`。自定义属性的定义不受时长规则限制，但要写清楚用途。
