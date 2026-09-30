# UI 设计系统（shadcn/ui 风格 + Lucide 图标）

本文说明 SillyTavern 前端的界面层：设计变量（tokens）、组件样式、图标系统、禁用 Emoji 的规则，以及修改界面时需要遵守的约定。

## 设计原则

- **视觉采用 shadcn/ui，不引入 React。** 前端仍是原生 JS + jQuery。shadcn 的设计变量和组件外观以纯 CSS 实现，直接作用在现有类名上（`.menu_button`、`.text_pole`、`.popup` 等）。
- **不改 DOM 结构和类名。** 所有 `id`、`data-i18n`、事件绑定保持不变，第三方扩展依赖的注入点（`#extensions_settings`、`#extensionsMenu`、`#leftSendForm`、消息模板等）照常可用。
- **主题优先。** 所有颜色都从当前主题的 `--SmartTheme*` 变量推导，内置主题、导入的主题和用户设置里的取色器都继续生效，亮色和暗色主题都能用。
- **用户样式优先。** 新样式层加载在旧样式之后、`css/user.css` 与用户自定义 CSS 之前，用户覆盖始终有效。
- **图标统一使用 Lucide，界面中禁止出现 Emoji。**

## 文件结构与加载顺序

`public/index.html` 中的加载顺序（节选）：

```
css/lucide-icons.css      图标层（生成文件，勿手改）
style.css 及 css/*.css    旧样式
css/tokens.css            设计变量
css/ui-components.css     基础组件
css/ui-layout.css         应用外壳（顶栏、面板、聊天区、输入框）
css/ui-panels.css         面板内通用模式与个别面板修正
css/user.css              用户样式（最后加载）
```

| 文件 | 内容 |
|---|---|
| `public/css/tokens.css` | `--ui-*` 设计变量，全部由主题变量推导 |
| `public/css/ui-components.css` | 按钮、输入框、下拉框、勾选框、滑块、弹窗、下拉菜单、通知、select2、分区卡片、滚动条 |
| `public/css/ui-layout.css` | 顶部导航、侧边与下拉面板、聊天消息、输入框 |
| `public/css/ui-panels.css` | 标签页、可选列表、分页、快速回复设置、提示词管理器等 |
| `public/css/lucide-icons.css` | 由 `tools/icons/build-lucide-shim.js` 生成 |
| `public/lib/lucide/fa-icons.json` | 图标选择器使用的图标列表（生成文件） |
| `tools/icons/` | 图标生成脚本与映射表 |
| `tools/check-no-emoji.js` | Emoji 检查脚本 |

`public/login.html` 同样加载 `tokens.css` 与 `ui-components.css`。

## 设计变量（`css/tokens.css`）

命名沿用 shadcn/ui，统一加 `--ui-` 前缀，避免与第三方扩展或用户 CSS 冲突。

| 变量 | 用途 | 推导来源 |
|---|---|---|
| `--ui-background` / `--ui-foreground` | 页面背景 / 正文 | `--SmartThemeBlurTintColor` / `--SmartThemeBodyColor` |
| `--ui-popover`、`--ui-popover-foreground` | 弹窗、菜单、通知底色 | 背景色（支持时去除半透明） |
| `--ui-muted`、`--ui-secondary`、`--ui-accent`、`--ui-accent-strong` | 由浅到深的中性填充（悬停、选中） | 正文色按 6% / 8% / 13% / 20% 混入透明 |
| `--ui-muted-foreground` | 次要文字、图标 | 正文色 62% |
| `--ui-primary` / `--ui-primary-foreground` / `--ui-primary-hover` | 主操作（反色） | 正文色 / 背景色 |
| `--ui-destructive`、`--ui-success`、`--ui-warning`、`--ui-info` | 语义色 | 固定色值 |
| `--ui-border` | 边框 | 正文色 16% 与主题边框色按 75:25 混合 |
| `--ui-input`、`--ui-input-background` | 输入框边框与底色 | 正文色 20% / 4% |
| `--ui-ring`、`--ui-ring-soft` | 聚焦描边与聚焦光晕 | 正文色 55% / 22% |
| `--ui-radius`、`-sm`、`-md`、`-lg`、`-xl` | 圆角 | 基准 0.5rem |
| `--ui-shadow-sm` 至 `-xl` | 阴影 | 固定值 |
| `--ui-transition` | 过渡时长与缓动 | `--animation-duration-2x` |

### 边框与主题边框色

内置主题大多把"边框颜色"设为近黑色，在深色背景上几乎不可见。处理方式：

1. `--ui-border` 以正文色为主，混入 25% 的主题边框色，因此取色器仍会影响边框色调。
2. 在 `body` 上把 `--SmartThemeBorderColor` 指向 `--ui-border`，让约 90 处旧样式的边框与新组件保持一致。
3. 主题代码在根元素上读写原始值，保存主题时不受影响。

## 组件约定

- 新写或修改的样式**只使用 `--ui-*` 变量**，不要写死 `white`、`black`、`rgba(255,255,255,…)` 之类的颜色，否则浅色主题下会出问题。
- 优先复用现有类名：按钮用 `.menu_button`（带图标文字用 `.menu_button_icon`），输入框用 `.text_pole`，勾选框用 `label.checkbox_label`，分区用 `.inline-drawer` 与 `.standoutHeader`，菜单项用 `.list-group-item`。
- 主操作按钮：弹窗里 `popup-button-ok` 会自动使用主色；危险操作使用 `.redWarningBG`。
- 只有图标的按钮（图标类写在按钮本身，或按钮里只有一个 `<i>`）会自动使用紧凑内边距。很多旧规则给这类按钮写死了宽度，不要再给它们加较大的横向内边距。
- **注意紧凑布局。** 很多行在旧样式下恰好放得下，增加 1 到 2 像素就会换行。调整内边距或最小宽度后，请按下文"回归检查"对比布局。
- 覆盖旧样式时，选择器优先级要与旧规则持平或更高（部分旧规则使用了 ID 选择器或 `!important`，例如 `.neo-range-slider`）。

## 图标

### 使用方式

新代码使用 Lucide 类名：

```html
<i class="lucide lucide-settings"></i>
<div class="menu_button lucide lucide-trash-2" title="Delete"></div>
```

任何 [Lucide 图标](https://lucide.dev/icons) 都可以直接用。运行生成脚本时，会自动收录 `public/` 下 `.js` 与 `.html` 文件中出现的 `lucide-<名称>`。

旧的 Font Awesome 写法（`fa-solid fa-xxx`）继续有效，并自动显示为对应的 Lucide 图标，因此 JS 中切换 `fa-*` 类名、第三方扩展、用户保存的快速回复图标都不需要修改。

### 实现原理

- 图标画在 `::before` 伪元素上，使用 `mask-image` 加 `background-color: currentColor`，所以图标颜色跟随文字颜色，元素本身的背景和边框不受影响。
- SVG 以 data URI 内嵌在 CSS 中，离线可用、不产生额外请求（约 360KB，gzip 后约 55KB）。
- `.fa-fw`、`.fa-spin`、`.fa-xl` 等工具类保留原有行为（见 `tools/icons/fa-utilities.css`）。

### 在 CSS 伪元素里画图标

`<select>` 等元素无法使用上面的类名。常用图标以 CSS 变量形式提供（`--lucide-check`、`--lucide-x`、`--lucide-chevron-right`、`--lucide-circle-check`、`--lucide-grip-vertical` 等，完整列表见生成脚本中的 `CSS_VARIABLE_ICONS`）：

```css
.my-element::before {
    content: "";
    display: inline-block;
    width: 1em;
    height: 1em;
    background-color: currentColor;
    -webkit-mask: var(--lucide-check) center/contain no-repeat;
    mask: var(--lucide-check) center/contain no-repeat;
}
```

需要新的变量时，把图标名加入 `CSS_VARIABLE_ICONS` 后重新生成。

### 生成与映射

```bash
npm run build:icons
```

修改以下任一文件后都需要重新生成，并提交生成结果：

| 文件 | 作用 |
|---|---|
| `tools/icons/fa-to-lucide.manual.json` | 应用自身用到的 Font Awesome 图标的手工映射（优先级最高） |
| `tools/icons/fa-to-lucide.longtail.json` | 其余常见图标的手工映射，主要服务第三方扩展和快速回复 |
| `tools/icons/fa-icon-groups.json` | Font Awesome 图标名与别名的快照（来自原 CSS） |
| `tools/icons/fa-utilities.css` | 保留的 Font Awesome 工具类 |
| `tools/icons/build-lucide-shim.js` | 生成脚本 |

映射的优先级依次为：手工映射、同名 Lucide 图标、长尾映射、按名称改写匹配、标签匹配、占位图标 `circle-dashed`。映射目标必须是存在的 Lucide 图标，否则脚本会报错退出。

当前覆盖情况：共 1881 个 Font Awesome 图标，874 个有确定对应；另有约 500 个按名称自动匹配（大多接近，但未逐个人工核对）；21 个非品牌图标仍显示占位图标（宗教、政治等无对应的符号）；品牌图标统一显示占位图标。

## 禁止 Emoji

界面中不得出现 Emoji，状态与类型一律使用 Lucide 图标或文字表达。检查命令：

```bash
npm run lint:emoji
```

该命令扫描 `public/` 下的 `.js`、`.html`、`.css`、`.json`（跳过各处的 `lib/` 目录和用户安装的第三方扩展）。`©`、`®`、`™` 允许使用。

规则只适用于界面本身，用户与模型生成的聊天内容不受限制。

斜杠命令补全中的类型图标（`enumIcons` 与 `SlashCommandEnumValue` 的 `typeIcon`）使用 Lucide 类名字符串，例如 `'lucide-user'`，由 `renderTypeIcon()` 渲染为图标；其他字符串仍按文字显示。需要在纯文本描述里表达状态时，请使用文字，例如 `(disabled)`，不要把图标类名拼进字符串。

## 兼容性说明

- **第三方扩展：** 常见的注入方式都能正常工作并自动套用新样式，包括设置分区、魔杖菜单项、输入框旁按钮、消息操作按钮、`fa-*` 图标、弹窗与通知。
- **不再支持：** 直接使用 Font Awesome 字体绘制图标的 CSS（`font-family: "Font Awesome 6 Free"` 加 `content: "\f00c"`）会显示为空白，因为该字体已不再加载。改用 `--lucide-*` 变量即可。
- **enumIcons 拼接：** 把 `enumIcons.*` 拼进字符串显示的扩展，现在会显示类名文本（例如 `lucide-user`）。
- **聊天消息：** 消息中的 HTML 可以使用 `lucide` / `lucide-*` 类名，与原先允许 `fa-*` 的规则一致。
- **已保留但不再加载：** Font Awesome 的 CSS 与字体文件（`public/css/fontawesome.min.css` 等）仍在仓库中，可在确认无依赖后删除。

## 回归检查

修改界面样式后建议检查以下项目：

1. `npm run lint` 与 `npm run lint:emoji` 通过。
2. 逐个切换内置主题（Azure、Cappuccino、Celestial Macaron、Dark Lite、Dark V 1.0），并在页面中临时设置浅色主题变量，确认对比度正常。
3. 至少检查中文、英文（字符串最长）两种界面语言。
4. 检查桌面、约 1000px 与 375px 三种宽度，确认没有横向滚动。
5. 对比布局是否因样式改动而换行：在浏览器控制台强制展开所有面板，分别在启用和禁用 `tokens.css`、`ui-*.css` 的情况下测量元素高度，报告高度增加 12px 以上的最内层元素。

```js
const st = document.createElement('style');
st.textContent = '.drawer-content{display:block!important;height:auto!important;position:static!important;width:600px!important;max-height:none!important} .inline-drawer-content{display:block!important}';
document.head.append(st);
await new Promise(r => setTimeout(r, 300));
const els = [...document.querySelectorAll('.drawer-content *')].filter(e => e.offsetParent && !(e instanceof SVGElement));
const measure = () => els.map(e => e.getBoundingClientRect().height);
const withNew = measure();
const links = ['css/ui-components.css', 'css/ui-layout.css', 'css/ui-panels.css', 'css/tokens.css'].map(h => document.querySelector(`link[href="${h}"]`));
links.forEach(l => l.disabled = true);
await new Promise(r => setTimeout(r, 300));
const without = measure();
links.forEach(l => l.disabled = false);
st.remove();
const grew = new Set(els.filter((e, i) => withNew[i] - without[i] >= 12));
[...grew].filter(e => ![...grew].some(o => o !== e && e.contains(o)))
    .map(e => ({ grew: Math.round(withNew[els.indexOf(e)] - without[els.indexOf(e)]), text: e.textContent.trim().slice(0, 50) }));
```

测试聊天界面时可以使用"临时聊天"配合 `/send`、`/sendas` 生成消息，这样不会写入聊天文件。
