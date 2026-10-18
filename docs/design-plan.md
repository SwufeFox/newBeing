# newBeing — 界面结构规划

依据：PRTS Design（MooncellWiki/prts-design，取自官网 CSS + torappu 解包）与
腾讯游戏学院《明日方舟》UI 拆解。所有结构决策都对得上上游的类名与用法。

---

## 一、方舟的信息架构（调研结论）

### 1.1 Tab 的三种变体，各管一个层级

| 类 | 用途 | 视觉标记 |
|---|---|---|
| `.ak-tabs` | 页内主分区 | 下划线 + **6×6 三角角标**（仅当前项，`::before`） |
| `.ak-tabs--block` | 游戏内块状标签 | 选中项**黑白反转**（`bg: var(--ak-fg)`，`color: var(--ak-bg-canvas)`） |
| `.ak-tabs--vertical` | 长内容多分区 | 左缘 3px 条；可带第二行小字 |

`.ak-tabset--left` = 竖向标签列 + 右侧面板，`grid-template-columns: max-content minmax(0,1fr)`。

### 1.2 装饰语言（11 类，各有明确用途）

| 类 | 作用 |
|---|---|
| `.ak-stripes` | -45° 斜纹；`--strong/--warning/--danger/--hazard` 四档 |
| `.ak-stripe-edge` | 8px 黄黑斜纹贴边 |
| `.ak-halftone` | 网点 + 渐隐遮罩（`mask-image`），可 `--l` / `--full` |
| `.ak-blue-band` | 蓝底白字 + 网点，区块标题 |
| `.ak-corner` | 10px（`--lg` 18px）三角角标，左上/右上，可黄/红 |
| `.ak-brackets` | 14px 四角括线，框住读数区 |
| `.ak-inverse` | 黑白反转 |
| `.ak-chevrons` | `»` 动作指引，hover 右移 3px |
| `.ak-en` | 大写拉丁装饰字 |
| `.ak-glyph` | 白色线稿图标 |
| `.ak-bilingual` | 中英双语排布 |

**明确不做**：无切角（`.ak-chamfer`）、无斜切（`.ak-skew`）、无 45° 斜边、无辉光。

### 1.3 `.ak-stat` 的结构

```
padding 12px 16px
border 1px
border-top-width: 2px + border-image: linear-gradient(accent 2px, border 2px)  ← 顶部青色条
label: 600 overline / uppercase / tracking .14em / fg-muted
value: 700 h2 / tabular-nums / fg
delta: xs / --up / --down
```

---

## 二、层级规划

### L1 — 顶栏（4 个模式）

用 `.ak-tabs--block` 的语义：黑白反转标记当前模式。
这是「系统」层，不是内容层。

```
MARKETS   RESEARCH   BACKTEST   REPLAY
```

### L2 — 每个模式内部（竖向 tab，`.ak-tabs--vertical`）

| 模式 | L2 分区 | tab 数 |
|---|---|---|
| Markets | 无（交易台，四块并列） | 0 |
| Research | 参数 / 源码 / 说明 | 3 |
| Backtest | 指标 / 交易 / 实验 / 日志 | 4 |
| Replay | 会话 / 账户 / 订单 | 3 |

### L3 — 面板内部

**不设 tab**，内容直排。方舟的做法：面板内部靠分隔线与底色阶梯分组，
不叠加第三层 tab。

---

## 三、Dock 按模式拆分

现状：5 个标签在所有模式都显示 → 5 × 4 = 20 个无效组合。

改为：

| 模式 | Dock 标签 | 数量 |
|---|---|---|
| Markets | Positions / Orders | 2 |
| Research | Experiments / Execution | 2 |
| Backtest | Metrics / Trades / Experiments / Execution | 4 |
| Replay | Session / Orders | 2 |

总计 **10 个**，每个都只在有意义的模式下出现。

---

## 四、竖向 tab 的两处用法

### 4.1 右侧检查器

```
┌────────────┬──────────────────────┐
│ ▍Book      │                      │
│  Trades    │   内容区              │
│  Strategy  │                      │
│  AI        │                      │
└────────────┴──────────────────────┘
```

- 左缘 3px 条标记当前项
- 可带第二行小字（如「Strategy · 未运行」）
- 宽度 96px 固定

### 4.2 底部 dock

同上结构，标签列宽 88px。

---

## 五、装饰强度：克制

只用三处：

1. **当前 tab 的三角角标**（`.ak-corner`，6px）—— 标记当前，不增加噪音
2. **危险/警告状态的斜纹**（`.ak-stripes--warning`）—— 仅 stale / replay 隔离
3. **面板头的 4px 色条**（已实现）+ `.ak-stat` 顶部 2px 条 —— 分区感

**不用**：大面积网点、四角括线、双语标题、蓝底 band。

理由：这是交易工具，读数优先。装饰只用来标记状态与层级，不铺满。

---

## 六、实施顺序

1. 顶栏改 `.ak-tabs--block` 语义（黑白反转）
2. 右侧检查器改竖向 tab
3. dock 改竖向 tab + 按模式拆分内容
4. L2 分区（Research / Backtest / Replay）
5. 三处克制装饰
