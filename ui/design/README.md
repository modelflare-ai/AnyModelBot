# AnyModelBot 设计库

界面样式的唯一来源。无构建步骤：原生 CSS（`@layer` + 自定义属性）+ Preact/htm 组件。

- 样例页：本机服务的 `/amb/static/design/index.html`。token 表直接从 `tokens/*.css` 解析，不会和代码脱节；支持浅色/深色和双主题对照，也能模拟"减少动态效果"。
- 守卫测试：`test/design-system.unit.test.ts`。`npm test` 时检查规范有没有被破坏（规则见文末）。

## 目录

```
ui/design/
  index.css              入口：声明层顺序并按层引入下面所有文件
  tokens/
    primitives.css       L1 原始值：品牌/状态色板，间距、字号、圆角、控件高度、层级等尺度
    semantic.css         L2 语义 token：按用途命名、按主题取值（浅色 + 深色）
    motion.css           动效 token：时长、缓动、位移量、--motion 开关
  base/
    reset.css            重置、焦点环、可选中规则
    motion.css           关键帧库 + .anim-* 工具类 + 减少动态效果
    typography.css       文字角色 .t-*（在 utilities 层）
    utilities.css        .stack .cluster .grow .truncate .tone-* .sr-only
  components/            一个组件一个文件：glass button field badge list seg switch popover sheet toast notice feedback avatar
  motion.js              ms("--dur-base")、usePresence()、reducedMotion()
  index.html / gallery.* 样例页
ui/css/                  页面样式（shell / chat / settings），放在 app 层
ui/components/ui.js      组件的 JS 写法：Button IconButton Notice Skeleton Seg Switch Menu MenuButton Sheet …
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
| 字号 | 9 级 `--fs-2xs … --fs-4xl`（11 / 11.5 / 12.5 / 13 / 14 / 15 / 17 / 20 / 24）。新界面优先用文字角色 `.t-*`。 |
| 圆角 | `--r-xs … --r-3xl`、`--r-full`。嵌套时内层 = 外层 − 内边距（`.seg`、`.pop` 里的列表项就是这样算的）。圆形用 `50%`。 |
| 间距 | 4 的倍数 `--space-1 … --space-16`，另有 `-0-5 / -1-5 / -2-5 / -3-5` 半步。组件内部的精调像素可以保留。 |
| 控件高度 | `--ctl-xs … --ctl-2xl`（22 / 24 / 28 / 32 / 36 / 44）。 |
| 投影 | `--shadow-xs / sm / md / lg`；`--shadow-pane`（浮在环境光上的面板）、`--shadow-tile`（侧栏选中项）、`--shadow-float` / `--shadow-pop`（玻璃的边 + 投影）、`--primary-edge`、`--seg-edge`。深色下更重，都是主题 token。 |
| 层级 | 只用 `--z-*`；同一窗格内的浮动件用 `calc(var(--z-float) ± 1)`。 |
| 焦点 | 输入框：accent 描边（浅色墨、深色黄绿）+ `box-shadow: var(--ring)` 黄绿光晕（错误时 `--ring-danger`）；其他控件：全局 `:focus-visible` 2px 描边、外移 2px，装在会裁切的容器里时用 `--focus-offset` 往里收。 |

现有语义色名（`--bg --card --pill --line --fg --muted --accent …`）沿用 magpie 的叫法，分组见 `semantic.css` 里的 `/* —— 组 —— */` 注释。

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
- 系统开了"降低透明度"（`prefers-reduced-transparency`），材质自动换成接近实色，层次靠描边和投影。

## 状态

每个可交互组件都要把下面这些状态想到；样例页的「状态矩阵」把它们按浅色 / 深色并排画出来（伪类规则被复制成 `.is-hover / .is-active / .is-focus`，和真实交互是同一份样式）。

| 状态 | 怎么表现 | 用什么 |
|---|---|---|
| 悬停 | 叠一层半透明，静默控件的字从 `--ctl-fg` 变 `--fg`；卡片类（模板、胶囊、提示里的按钮）是描边加深 + 投影变大 | `--pill` → `--pill-hover`；侧栏里是更亮的一层玻璃 `--side-hover` |
| 按下 | 再深一级，并轻微缩小（`--press` / `--press-strong`）；列表行只变色不缩放 | `--pill-press`、`--sel-press`、`--side-press` |
| 键盘焦点 | `:focus-visible` 2px `--accent` 描边；输入框是描边 + 光晕 | `--focus-offset`、`--ring` |
| 打开 | 菜单展开时触发它的按钮保持"按住"的样子，箭头翻转，加号转成叉 | `[aria-expanded="true"]`，`.icon-btn.on` |
| 选中 / 当前 | 侧栏行和设置导航是浮起的玻璃片；菜单当前项打勾；模板卡 accent 描边 + `--accent-wash`，图标亮成黄绿 | `--side-active` + `--shadow-tile`，`--accent-wash` |
| 禁用 | `--o-disabled`，不响应悬停和按下；主按钮和发送钮退成中性灰（半透明的墨色或黄绿会发浑） | `:disabled` |
| 加载 | 转圈，颜色不变，只是不可点（`aria-busy`） | `Button loading` |
| 错误 | 红描边，聚焦时红光晕 | `.err` / `aria-invalid`，`--ring-danger` |
| 只读 | 次级底，聚焦不发光 | `[readonly]` |
| 滚动边缘 | 内容滚到顶栏底下时，顶栏才出现细线和投影 | `.chat.scrolled` |

## 主题

- `<html data-theme>` 总是解析后的 `light` / `dark`（`index.html` 首帧前设置，`lib/theme.js` 同步）。
- **主题可以局部生效**：任何元素加 `data-theme="dark"`，它的子树就换一套语义 token（样例页的双主题对照就是这样做的）。
- 因此**不要写** `:root[data-theme="dark"] .xxx { … }` 这类按主题的覆盖。需要两个主题不同的值，就加一个语义 token。
- 由其他语义 token 推导的值（`--ring`、`--code-bg`）写在 `:root, [data-theme] { … }` 里，每个作用域都会重新计算。

## 组件

每个组件把可调的地方开放成自己的变量。**变体、尺寸和上下文覆盖都只改变量，不改属性**：

```css
.btn.primary { --btn-bg: var(--accent-solid); --btn-fg: var(--on-accent); … }   /* 变体 */
.notice .btn { --btn-h: var(--ctl-sm); --btn-bg: var(--card); }                  /* 上下文 */
```

| 组件 | 类名 API | 变量 |
|---|---|---|
| 按钮 | `.btn [primary\|ghost\|danger] [sm\|lg] [block]` | `--btn-h --btn-px --btn-r --btn-fs --btn-bg --btn-bg-hover --btn-bg-press --btn-fg --btn-fg-hover --btn-edge` |
| 毛玻璃 | `.glass`（组件自己是玻璃时直接写三行，见「材质」） | `--glass-bg --glass-blur --glass-shadow` |
| 图标按钮 | `.icon-btn [xs] [on]` | `--ib-size --ib-r --ib-fg --ib-fg-hover --ib-bg-hover --ib-bg-on --ib-bg-press` |
| 文字按钮 | `.text [danger\|accent]` | — |
| 输入框 | `.field [mono] [err]`，`.field-wrap > .field + .tail` | `--field-h --field-px --field-r --field-bg --field-edge --field-edge-hover --field-edge-focus --field-ring` |
| 徽标 / 点 | `.badge [ok\|err\|warn\|off] [count]`，`.dot [ok\|err\|warn]` | `--badge-bg --badge-fg`，`--dot-bg` |
| 列表行 | `.list > .row [compact] [clickable] [off] [flash]`，`.row-edit`，`.list-head` | `--row-h --row-py --row-pl --row-pr --row-gap` |
| 分段 | `Seg` 组件（`.seg > .thumb + button`），两个以上的选项 | `--seg-r --seg-pad --seg-thumb --seg-on` |
| 开关 | `Switch` 组件（`button.switch[role=switch] [sm]`），只有开 / 关 | `--switch-w --switch-h --switch-pad --switch-track --switch-track-hover --switch-dot --switch-stretch` |
| 菜单 | `.pick`，`.pop [up]`，`.palette`，`Menu` / `MenuButton` / `Popover` | `--pop-r --pop-pad` |
| 对话框 | `Sheet` / `confirmSheet()`（`.scrim > .sheet [wide]`） | `--sheet-w --sheet-r` |
| 提示胶囊 | `toast()` / `saved()` / `failed()`（`.toast [ok\|err\|warn]`） | `--toast-bg --toast-fg --toast-edge` |
| 行内提示 | `Notice` / `.notice [amber\|red]` | `--notice-bg --notice-fg --notice-edge` |
| 加载 | `Spinner`、`Skeleton`（`.skel [circle]`）、`.empty-state` | — |
| 头像 | `BotAvatar [bot\|char] [state] [cue] [lively] [pokeable] [greet] [neutral]`、`AvatarPicker`、`AppMark`；6 个内置角色，见下文「头像」 | `--avatar-aura --avatar-shadow`（主题），角色颜色 `--bot-*`（原画色，两个主题相同） |

JS 组件（`ui/components/ui.js`）只是给常用组合一个带逻辑的写法（loading、图标、无障碍属性）；直接写类名同样合法。

## 动效

| 用途 | 时长 | 缓动 |
|---|---|---|
| 悬停、按下、颜色变化 | `--dur-fast` 120ms（`--t-fast`） | `--ease-out` |
| 出现 / 消失、提示胶囊、遮罩 | `--dur-base` 180ms | 入场 `--ease-out`，退场 `--ease-in` |
| 视图切换、面板、分段 thumb | `--dur-moderate` 240ms | `--ease-out` |
| 对话框 / 弹出层的弹性入场 | `--dur-slow` 360ms / `--dur-slower` 420ms | `--ease-spring` |
| 循环（转圈、骨架、呼吸、光标） | `--dur-spin --dur-shimmer --dur-pulse --dur-blink` | `linear` / `--ease-in-out` |

- **关键帧库**（`base/motion.css`）：`fade-in/out`、`rise-in`、`sink-out`、`slide-in`、`pop-in/out`、`bump`、`flash`、`spin`、`shimmer`、`breathe`、`blink`。关键帧只描述起止，时长缓动由使用处给 token。
- **位移量是 token**：`--rise`、`--slide`、`--pop-dy`、`--pop-scale`，组件可以局部覆盖（`.toast { --rise: 6px }`）。
- **减少动态效果**：关键帧里的位移都乘以 `--motion`；系统开启"减少动态效果"时 `--motion: 0`，所有入场自动退化成纯淡入，按下不缩放，过渡几乎瞬时。新写的关键帧也要乘 `--motion`。
- **退场动画**：用 `usePresence(open)`（`design/motion.js`）让组件在退场时长内保持挂载，并给元素加 `.leaving` / `.anim-*-out`。`DialogHost` 是参考实现。
- **JS 里不写死毫秒数**：`ms("--dur-base")` 读 token（toast 的移除时机就是这样同步的）。
- 只给 `transform` 和 `opacity` 做动画；空闲列表保持安静（头像空闲时只在指针靠近时看过去、悬停时抖一下天线，不自己动）。

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

## 新增或修改

1. 先在样例页里找现成的 token、组件、文字角色。
2. 缺颜色 → `semantic.css` 加语义 token（浅色、深色各一个值）；缺尺度 → `primitives.css`。
3. 新组件 → `components/<name>.css`，开放 `--<name>-*` 变量，在 `index.css` 按层引入；需要逻辑时在 `ui/components/ui.js` 加 JS 写法；在 `gallery.js` 加样例。
4. 页面专属样式写在 `ui/css/*.css` 的 `@layer app` 里，只引用 token。
5. 跑 `npm test`。

## 守卫测试会拦下

- `ui/design/tokens/` 之外出现原始颜色（`#hex`、不含 `var()` 的 `rgb()/hsl()`）
- `font-size` / `font` 里写死 px
- `border-radius` 写死 ≥ 3px（1–2px 的细节、`50%` 不算）
- `transition` / `animation` 里写死时长或缓动（`linear`、`steps()` 可以）
- `z-index` 写死数字
- JS 内联样式里写死颜色或字号
- 引用了没定义的 `var(--x)`（带回退值的除外）
- 有组件或基础样式文件没在 `index.css` 里引入

组件文件里确实需要的"魔法数"（比如头像的眨眼周期），先起名再用：`--bf-blink: 4.2s`。自定义属性的定义不受时长规则限制，但要写清楚用途。
