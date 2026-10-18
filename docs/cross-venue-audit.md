# Cross-Venue Audit — backtest / replay / paper 跨四家交易所侦察报告

- 仓库：`E:\Projects\Magixyne\newBeing`（pnpm monorepo）
- 分支：`main`，`git status` 干净（本报告是唯一新增文件）
- 侦察范围：`apps/web/src/**`、`packages/{core,application,market-data,storage,mcp}/src/**`、`e2e/**`、`.newbeing/newbeing.sqlite`（只读查询）
- 证据约定：所有结论带 `文件:行号`。**已确认**=有代码证据；**推测**=标注。

---

## 0. τ 对「已确认事实」的更正

| 你的说法 | 实际 | 证据 |
|---|---|---|
| backtests 硬门在 `api/backtests/route.ts:43-44` | **错**。`43-44` 是 `await request.json()` + schema 解析；硬门在 **`40-41`** | `apps/web/src/app/api/backtests/route.ts:40-41` |
| replay 硬门 `api/replay/route.ts:21-22` | 对 | `apps/web/src/app/api/replay/route.ts:21-22` |
| paper 硬门 `api/paper/route.ts:20` | 对（单行；同函数 `unsupported()` 内还有 `:21` 的 replay 门） | `apps/web/src/app/api/paper/route.ts:20-22` |
| 「API 里调 `getWebMarketAdapter("binance")`，所有调用点都硬编码」 | **不准确**。6 个调用点里只有 4 个硬编码/默认，**`api/market` 与 `api/markets` 是动态传参**（传请求里的 exchange） | 见 §1 全表 |
| `store/workspace.ts:58-70` setExchange 清空 backtest/replay | 对 | `apps/web/src/store/workspace.ts:61-64`（setExchange）、`:70`（setWorkspace） |
| `ccxt@4.5.85` 在 market-data；CcxtSpotAdapter 支持四家 | 对 | `packages/market-data/package.json` `dependencies.ccxt: "4.5.85"`；`packages/market-data/src/binance.ts:8,24-28` |
| 四家 loadMarkets/fetchTicker/fetchOHLCV 实测可用 | 代码层面成立，但**无法在本机离线复核**（需要网络）。视为你方已实测 | 适配器实现 `binance.ts:31-68` |

> 额外发现：`docs/research/references.md:29` 明确写着「**Backtest, Replay, Paper, and AI order preview confirmation remain Binance-only at both UI and server boundaries**」——即「锁 Binance」是当初写进研究档案的**有意决策**，不是遗漏。

---

## 1. 适配器注入链（最重要）

### 1.1 定义与签名

- `getWebMarketAdapter` — `apps/web/src/lib/market-adapter.ts:108`
  ```ts
  export function getWebMarketAdapter(exchange: ExchangeId = "binance"): ExchangeAdapter
  ```
  - **默认值就是 `"binance"`**。函数体 `:109`（fixture 仅对 binance 生效）→ `:110 return getExchangeAdapter(exchange)`。
- `getExchangeAdapter` — `packages/market-data/src/binance.ts:116`：`(id: ExchangeId = "binance"): CcxtSpotAdapter`，`:115` 用 `Map<ExchangeId, CcxtSpotAdapter>` 按 id 缓存实例（**本身是 venue 参数化的**）。

### 1.2 所有 `getWebMarketAdapter(` 调用点

| 文件:行 | 传入参数 | 来源 | 判定 |
|---|---|---|---|
| `apps/web/src/app/api/market/route.ts:26` | `exchange` | `:20` `url.searchParams.get("exchange") ?? workspace.exchange`，`:20-22` 经 `exchangeSchema.safeParse` 校验 | ✅ **动态**（只读行情） |
| `apps/web/src/app/api/markets/route.ts:17` | `id` | `:14` query `exchange ?? getWorkspaceState().state.exchange` | ✅ **动态**（符号搜索） |
| `apps/web/src/app/api/paper/route.ts:44` | `"binance"` | 字面量 | ❌ 硬编码 |
| `apps/web/src/app/api/replay/route.ts:31` | `"binance"` | 字面量 | ❌ 硬编码 |
| `apps/web/src/app/api/replay/[id]/route.ts:65` | *(无参)* | 走默认值 `"binance"` | ❌ 隐式硬编码 |
| `apps/web/src/app/api/backtests/route.ts:62` | `"binance"` | 字面量 | ❌ 硬编码 |

**结论（已确认）**：三个目标模式（backtest/replay/paper）**全部**在调用 `getWebMarketAdapter` 时绕过 workspace 的 exchange，用字面量或默认值锁定 binance。只有两个**只读行情**路由是 venue 动态的。

### 1.3 完整链路：req → 校验 → 取 adapter → 调方法

```
Browser fetch
  └─ apps/web/src/proxy.ts:4-8   (matcher "/api/:path*")
       └─ lib/local-api-guard.ts:23 localApiRejection()  ← Host/Origin/JSON 校验，与 venue 无关
            └─ route handler
                 ├─ [venue 门] getWorkspaceState().state.exchange !== "binance" → 409
                 │    backtests:40-41 / replay:21-22 / paper:20 / order-previews:10 / order-previews/[id]:13
                 ├─ zod 解析 body/query（symbol / timeframe / config）
                 ├─ getWebMarketAdapter(<字面量 "binance" 或默认>)
                 └─ adapter.fetchOHLCV / fetchOHLCVSince / fetchSummary
                      └─ packages/market-data/src/binance.ts:53 逐 venue 的 timeframe 校验
```

**链路中假设 binance 的位置（已确认）**：
1. **venue 门**：读 `workspace.exchange`（来自 SQLite workspace 快照），非 binance 一律 409。这是「先于一切」的拦截。
2. **adapter 实参**：即使门放开，实参仍是字面量 `"binance"`，**请求里根本没有 exchange 通道**（`ResearchBacktestRequest` 不含 exchange 字段：`packages/application/src/index.ts:9-17`）。
3. **fixture 分支**：`market-adapter.ts:109,121` 只在 `exchange === "binance"` 时启用确定性 fixture（E2E 用）。
4. **前端轮询节奏**：多处 `exchange === "binance" ? 3_000 : 15_000`（`inspector.tsx:83,124`、`terminal.tsx:102`、`bottom-dock.tsx` 相关）——**已兼容**非 binance 只是频率不同。

---

## 2. 每个模式真正的交易所依赖点

### 2.1 Backtest（`api/backtests/route.ts` → `runResearchBacktest`）

| 依赖点 | 现状 | 证据 | 跨 venue 影响 |
|---|---|---|---|
| venue 门 | `!== "binance"` → 409 | `backtests:40-41` | **真阻塞** |
| adapter | `getWebMarketAdapter("binance")` | `backtests:62` | **真阻塞** |
| **符号格式** | `/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/` — **quote 无关** | `backtests:12` | ✅ 已兼容 `BTC/USD` |
| 时间周期校验 | zod enum 是全集 `1m..1d`；**不针对 exchange 校验** | `backtests:13` | ⚠️ Coinbase 不支持 30m/4h（`core/types.ts:8`），要到 `binance.ts:53` 才抛错 |
| 手续费/滑点默认 | **无按 venue 的默认**；前端默认 `feeRate=0.001, slippageRate=0.0005` | `store/workspace.ts:53` | ⚠️ 需人工设定，但**非代码阻塞** |
| application 兜底 | `dependencies.marketAdapter ?? getBinanceAdapter()`；错误文案含 "Binance" | `application/src/index.ts:35,37` | ⚠️ 兜底路径硬编码 |

**结论**：backtest 除「门 + adapter 实参 + application 兜底」外，**符号与引擎层面本就 venue-agnostic**。

### 2.2 Replay（`api/replay/route.ts` + `api/replay/[id]/route.ts`）

| 依赖点 | 现状 | 证据 | 影响 |
|---|---|---|---|
| venue 门 | `!== "binance"` → 409 | `replay:21-22` | **真阻塞** |
| adapter（建会话） | `getWebMarketAdapter("binance")` | `replay:31` | **真阻塞** |
| adapter（步进） | `getWebMarketAdapter()`（默认 binance） | `replay/[id]:65` | **真阻塞** |
| **符号格式** | `/^[A-Z0-9]{2,20}\/USDT$/` — **硬编码 USDT** | `replay:13` | **真阻塞**：Coinbase/Kraken 的 `BTC/USD` 直接 400 |
| 时间周期 | zod enum 全集 | `replay:14` | ⚠️ 同 backtest |
| source 标签 | `marketDataSourceLabel("binance")` | `replay:47` | ⚠️ 文案 |
| 会话是否记 venue | **`ReplaySession` 无 exchange 字段** | `core/types.ts:135-145`；`storage/schema.ts:67-77` 无 exchange 列 | **真阻塞的根因**：即使建会话时取了别家数据，会话本身不记 venue，`[id]` 步进会回到默认 binance 重新抓 bar（数据源不一致） |
| 账户 ID | `replayAccountId` → `paperAccountId`（见 2.3） | `storage/repositories.ts:114-119` | **真阻塞**：继承 USDT/binance 限制 |

### 2.3 Paper（`api/paper/route.ts` + `order-previews`）

| 依赖点 | 现状 | 证据 | 影响 |
|---|---|---|---|
| venue 门 | `!== "binance"` → 409（GET+POST 共用 `unsupported()`） | `paper:19-22` | **真阻塞** |
| 门（previews） | 同样 `!== "binance"` → 409 | `order-previews/route.ts:10`；`order-previews/[id]/route.ts:13` | **真阻塞** |
| adapter | `getWebMarketAdapter("binance")` | `paper:44` | **真阻塞** |
| **符号/账户** | `paperAccountId`：`quote !== "USDT"` → **抛错**；返回 `paper:binance-spot:${base}:USDT` | `storage/repositories.ts:106-112` | **真阻塞**：账户主键把 venue+quote 写死 |
| 常量账户 | `PAPER_ACCOUNT_ID = "paper:binance-spot:USDT"` | `storage/repositories.ts:104` | **真阻塞** |
| 手续费默认 | `feeRate: 0.001` 常量（初始化账户时写死） | `storage/repositories.ts:123,175` | ⚠️ 无按 venue |
| 符号搜索过滤 | `markets.filter(m => m.quote === "USDT")` | `api/markets/route.ts:18` | **真阻塞（UI 层）**：Coinbase/Kraken 的 USD 交易对被过滤掉，用户根本选不到 |
| 图书表头 | 硬编码 `PRICE (USDT)` | `inspector.tsx:90` | ⚠️ 文案 |

### 2.4 其他 venue 假设汇总

- **符号大小写**：`CcxtSpotAdapter` 内部 `validSymbol` 统一 `toUpperCase()`（`binance.ts:10-14`），已兼容。
- **精度/最小下单量**：全仓库无 `precision` / `limits` / `minAmount` 的使用（`git grep` 无命中）→ 现货模拟不校验，**非阻塞**，但也是精度缺口。
- **实时流**：Binance 原生 WS `wss://stream.binance.com:9443/...` 仅 binance 用，其余走 REST 轮询（`market-chart.tsx:251-258,366`）→ **已兼容**。

---

## 3. 阻塞性风险清单

### 3.1 真阻塞（必须改代码才能跨 venue）

| # | 位置 | 说明 |
|---|---|---|
| B1 | `api/backtests/route.ts:40-41` | venue 门 |
| B2 | `api/replay/route.ts:21-22` | venue 门 |
| B3 | `api/paper/route.ts:20` | venue 门 |
| B4 | `api/order-previews/route.ts:10`、`api/order-previews/[id]/route.ts:13` | venue 门 |
| B5 | `api/workspace/route.ts:43-45`（PUT） | `state.exchange !== "binance" && activeWorkspace∈{backtest,replay}` → 409。这会**阻断 sync**：即便前端允许，PUT 也会 409 |
| B6 | `api/backtests/route.ts:62`、`api/replay/route.ts:31`、`api/replay/[id]/route.ts:65`、`api/paper/route.ts:44` | adapter 实参锁死 binance；且**请求体无 exchange 通道**（`application/src/index.ts:9-17`） |
| B7 | `api/replay/route.ts:13` | 符号正则硬编码 `\/USDT$` |
| B8 | `storage/repositories.ts:104,106-112` | `paperAccountId` USDT-only + `binance-spot` 字面量（账户主键） |
| B9 | `storage/repositories.ts:114-119` | `replayAccountId` 继承 B8 |
| B10 | `core/types.ts:135-145` + `storage/schema.ts:67-77` | `ReplaySession`/`replay_sessions` 无 exchange 列 → 会话无法记住 venue，步进必然回退到默认 binance |
| B11 | `api/markets/route.ts:18` | 只放行 `quote === "USDT"` |
| B12 | `store/workspace.ts:58-70` | `setExchange` 清空 backtest/replay；`setWorkspace` 阻止非 binance 进入 backtest/replay |
| B13 | `terminal.tsx:376-377,615,728`；`bottom-dock.tsx`（多处 disabled/empty-state）；`inspector.tsx:279-295`；`strategy-lab.tsx:169-170` | 前端各处 `exchange !== "binance"` 禁用/占位 |
| B14 | `packages/mcp/src/tools.ts:207,282,310` | MCP 层的三处 binance 门 |
| B15 | `application/src/index.ts:3,35,37` + `application/src/paper.ts:1,77` | 兜底 `getBinanceAdapter()` + 错误文案 |
| B16 | `e2e/api-mocks.ts:44,68,69` | 测试桩锁 binance（仅测试，但会掩盖真实回归） |

### 3.2 已经兼容、只是被门挡住

| 位置 | 说明 |
|---|---|
| `packages/market-data/src/binance.ts:8,24-28` | `CcxtSpotAdapter` 四家全支持 |
| `packages/market-data/src/binance.ts:10-14` | 符号归一化，四家通用 |
| `api/market/route.ts:26`、`api/markets/route.ts:17` | 已按请求 exchange 动态取 adapter |
| `backtests:12` | 符号正则 quote-agnostic，本就接受 `BTC/USD` |
| `packages/core/src/backtest.ts` | 引擎零 venue 概念 |
| `storage/schema.ts` 全表 | **无任何 exchange 列**（见下） |
| `mcp/src/tools.ts:105,312` | `get_market_data` / `prepare_order` 已用 `getExchangeAdapter(workspace.exchange)`，**天然 venue-aware** |

### 3.3 三个具体包逐个判断

**`packages/application/src/`** — **基本干净，只有兜底**：
- `paper.ts` 无 binance 字面量；仅 `:77` 默认参 `getBinanceAdapter()`，且 HTTP 路由**总是显式传 adapter**（`paper:44`），所以该默认在 HTTP 路径**不会被触发**。
- `replay.ts` **零** binance 引用（只依赖 storage 账户 id）。
- `index.ts:3,35` 兜底 `getBinanceAdapter()`；`:37` 错误文案含 "Binance"。MCP 的 `run_backtest` 走的就是这条**兜底**（`tools.ts:217` 不传 adapter）。

**`packages/storage/`** — **无 exchange 列，但账户主键把 venue 写死**：
- `schema.ts:19-29`（experiments）、`:67-77`（replay_sessions）、`:52-65`（order_previews）**均无 venue 列**。
- 唯一 venue 痕迹是**字符串主键**：`paper_accounts.id = "paper:binance-spot:..."`（`repositories.ts:111`）。
- 线上库实测（只读查 `.newbeing/newbeing.sqlite`）：
  - `paper_accounts` = `paper:binance-spot:{BNB,BNSOL,BTC,ETH,SOL,XRP}:USDT` + `paper:replay:b8e88fe2-…:BTC:USDT`
  - `replay_sessions` = 1 行 `BTC/USDT, 5m, finished`；`experiments` = 7 行。
  - `workspace_states` payload = `{"exchange":"binance","activeWorkspace":"research",...}`。
  - → **改账户 ID 方案会影响已存在的账户行**（主键即身份）。

**`packages/mcp/`** — **读路径已 venue-aware，写路径被门挡住**：
- `tools.ts:105`（get_market_data）、`:312`（prepare_order 报价）已用 `workspace.exchange`。
- 门：`:207`（run_backtest）、`:282`（open_workspace_view）、`:310`（prepare_order）。
- `tools.ts:108` 有 exchange→label 映射，需同步扩到四家文案（已含四家，无需改）。

---

## 4. 合并 Research 与 Backtest 的影响面

### 4.1 两者现在的差异（对方没有的）

| 维度 | research 独有 | backtest 独有 | 证据 |
|---|---|---|---|
| Rail 左栏内容 | `RailStrategyRoster`（策略名 + 参数） | `RailRunHistory`（本地运行历史） | `terminal.tsx:658-659` |
| Rail 说明 | `RAIL_NOTES.research` | `RAIL_NOTES.backtest` | `terminal.tsx:41-42` |
| Inspector tab | `[book, trades, strategy, context]` | `[strategy, context]` | `inspector.tsx:357-361` |
| Inspector 底部 | 显示 `PaperTicket`（因 `selectedTab !== "strategy"`） | 唯一 tab 是 `strategy` → **从不显示票据** | `inspector.tsx:380` |
| Dock allowedTabs | `[history, logs]` | `[backtest, logs]` | `bottom-dock.tsx:206-210` |
| Dock trigger | `Experiments`(history) | `Results`(backtest) | `bottom-dock.tsx:260-261` |
| Dock 内容 | `ExperimentHistory`（仅在 research 渲染） | `BacktestView`（仅在 backtest 渲染） | `bottom-dock.tsx:270-271` |
| 网格/高度 | inspector 列宽 `max(w,380)` | dock 高 `max(h,320)` | `terminal.tsx:594-596, 605-607` |
| 顶栏标签 | "Research" / 移动端 "Strategy" | "Backtest" | `terminal.tsx:615,728` |

**交集**：两者共享 `strategy` inspector tab（`StrategyLab`）+ `logs` dock。`StrategyLab` 的 "Run backtest" 按钮**两个模式都在**（`strategy-lab.tsx:170`）。

**结论（已确认）**：合并 = **并集**，几乎无冲突；backtest 是 research 的「带 Results dock + 更高 dock」子集 + 多了 run history rail。

### 4.2 联合类型被穷举/switch 的位置

`WorkspaceState["activeWorkspace"]` = `"terminal" | "research" | "backtest" | "replay"`（`core/types.ts:127`）。

| 文件:行 | 形式 |
|---|---|
| `packages/core/src/types.ts:127` | 类型定义 |
| `packages/core/src/types.ts:167` | `DEFAULT_WORKSPACE_STATE.activeWorkspace = "terminal"` |
| `apps/web/src/app/api/workspace/route.ts:14` | `z.enum([...4])` |
| `apps/web/src/app/api/workspace/route.ts:43` | 门 `activeWorkspace === "backtest" \|\| ... "replay"` |
| `apps/web/src/store/workspace.ts:24` | setter 签名 |
| `apps/web/src/store/workspace.ts:61,70` | setExchange / setWorkspace 三目 |
| `apps/web/src/store/workspace.ts:131,154` | partialize / toShared |
| `apps/web/src/components/terminal.tsx:39` | `RAIL_NOTES: Record<activeWorkspace, string>`（**穷举 Record**） |
| `apps/web/src/components/terminal.tsx:375-382` | `setPage` |
| `apps/web/src/components/terminal.tsx:583` | `workspaceName` 映射字面量 |
| `apps/web/src/components/terminal.tsx:615,728` | 顶栏 + 移动端 tab 数组 |
| `apps/web/src/components/inspector.tsx:24` | props 类型 |
| `apps/web/src/components/inspector.tsx:146,148,173` | 读取 / 三目 / 展示 |
| `apps/web/src/components/inspector.tsx:357-361` | `tabsForWorkspace` 链式三目 |
| `apps/web/src/components/bottom-dock.tsx:195` | props 类型 |
| `apps/web/src/components/bottom-dock.tsx:206-210` | `allowedTabs` |
| `apps/web/src/components/bottom-dock.tsx:258-262` | TabsTrigger 条件 |
| `apps/web/src/components/bottom-dock.tsx:268-272` | 内容条件 |
| `packages/mcp/src/tools.ts:82,98,121,240,253,287,311` | `=== "replay"` 读取 |
| `packages/mcp/src/tools.ts:273` | `z.enum([...4])`（open_workspace_view） |
| `packages/application/src/index.ts:30,55` | replay 抑制 / 写 `activeWorkspace:"backtest"` |
| `apps/web/src/app/api/backtests/route.ts:29`、`backtests/[id]/route.ts:7` | replay 抑制 |

（另有大量 `=== "replay"` 抑制逻辑：`api/market/route.ts:23,38`、`api/order-previews*`、`api/paper:21`、`mcp` 各处。）

### 4.3 持久化里有没有存 "backtest"

| 存储 | 是否存 workspace 值 | 证据 |
|---|---|---|
| SQLite `workspace_states.payload`（单一 JSON blob） | **是**。`activeWorkspace` 是 JSON 字段；实测线上值 = `"research"`，但**历史上可含 `"backtest"`** | `storage/repositories.ts:16-25`（读时 `{...DEFAULT, ...payload}` 直接合并，不做枚举校验）；`storage/schema.ts:3-7`（payload 是 `text`） |
| 浏览器 `localStorage["newbeing-workspace-v1"]` | **是**。`activeWorkspace` 在 `partialize` 白名单里 | `store/workspace.ts:113,131`；`migrate` 只重写 layout，`version: 2`（`:116-125`） |
| `experiments` 表 | 否 | `schema.ts:19-29` |
| `replay_sessions` 表 | 否 | `schema.ts:67-77` |
| `paper_*` / `order_previews` | 否 | `schema.ts:31-65` |

**风险（已确认）**：`api/workspace/route.ts:14` 的 `z.enum` 一旦移除 `"backtest"`，任何带着旧值 `"backtest"` 的客户端/远端快照在 PUT 时会被 **400 拒绝**，而 `workspace-sync.tsx:52-93` 的同步循环会持续失败（它会 350ms debounce 后不断重发）。同时本地 `localStorage` 的旧 `"backtest"` 会直接 rehydrate 进 store（`store/workspace.ts:83-95` 的 `setFromRemote` 只是展开）。

### 4.4 合并的最小改动路径（只说路径与风险，不实现）

路径（按依赖）：
1. **核心类型先行**：`core/types.ts:127` 联合类型去 `"backtest"`（或保留并 alias）。→ 决定后续所有枚举。
2. **服务端枚举**：`api/workspace/route.ts:14` 的 z.enum、`:43` 的门、`mcp/tools.ts:273` 的 z.enum 同步收敛。
3. **持久化迁移**：
   - localStorage：`store/workspace.ts:117` 的 `migrate` **同时映射** `activeWorkspace:"backtest" → "research"`，并把 `version` 升到 3（`:116`）。
   - SQLite 快照：`storage/repositories.ts:16-25` 读取时兜底归一（读到 `"backtest"` → `"research"`），避免旧 blob 反复 400。
4. **UI 收敛**：`terminal.tsx:39`（穷举 Record 必须同步，否则 TS 报错）、`:583,615,728`；`store/workspace.ts:70`；`inspector.tsx:357-361`；`bottom-dock.tsx:206-210,258-262`。
5. **保留 BacktestView**：把 `bottom-dock.tsx:271` 的 `Results` tab 挪进合并后的 research dock（research 现有 `[history, logs]` → 变 `[history, results, logs]`）。
6. **MCP 契约**：`tools.ts:273` 去掉 `"backtest"` 是**破坏性契约**（外部调用方若传 `"backtest"` 会 400）。

风险：
- **穷举 Record 是编译期安全网**：改 `core/types.ts:127` 后 `terminal.tsx:39` + `inspector.tsx:24` + `bottom-dock.tsx:195` 会立刻编译失败 → 这其实是**好**的，它保证不漏改。
- `workspace-sync.tsx:74` 用 `JSON.stringify` 比对本地/远端；若读取端不归一，旧 blob 与本地会永远不同 → 死循环 PUT（400）。
- E2E 断言用的是 `"research"`（`workstation.e2e.ts:67`）不是 `"backtest"`，**不受影响**；但 `api-mocks.ts:46` 的默认 `activeWorkspace` 也是 `"terminal"`，无需改。

---

## 5. 模式间衔接的现状

### 5.1 是否零交接 —— 确认零

四个模式**互不相连**，进入方式都是裸 store setter：
- Markets：`watchlist.tsx:261` `setSymbol(symbol)`。
- Research：`terminal.tsx:381` `setInspectorTab("strategy")`（仅此）。
- Backtest：`terminal.tsx:408-409` `setWorkspace("backtest")` + `setDockTab("backtest")`；结果由 `setBacktest`（`store/workspace.ts:81`）写入。
- Replay：`terminal.tsx:469` `setWorkspace("replay")`；`setActiveReplayId`（`store/workspace.ts:82`）。

**没有任何一处把 A 模式的产物喂给 B 模式的入口**（`git grep` 无跨模式调用）。

### 5.2 为什么没有 —— 是没写，不是技术障碍

现有模式间只有**「抑制」耦合**，没有「交接」：
- backtest 列表在 replay 中 409（`backtests/route.ts:29`）；backtest POST 在 replay 中被 `application/index.ts:30` 抛错。
- 行情在 replay 中被限制（`market/route.ts:23,38`）。
- paper 在 replay 中 409（`paper:21`）。
- MCP 的 `get_backtest_result`/`list_experiments` 在 replay 中报错（`tools.ts:240,253`）。

**结论（已确认）**：零交接是**设计选择**，技术上没有硬障碍——所有需要的数据都在 store/DB 里，只是没人接线。

### 5.3 Backtest 结果 → Replay 需要什么

Replay 建会话所需（`api/replay/route.ts:12-17`）：`symbol`、`timeframe`、`endAt`、`limit`。

Backtest 结果里**有的**（`core/types.ts:98-114`）：`symbol` ✅、`timeframe` ✅。
**缺的**：
- `endAt`：**没有直接字段**。可从 `equityCurve.at(-1).timestamp`（`:111`）或最后一笔 `trades.at(-1).exitTime`（`:112`）推导。**推测**：这是可行但不精确的近似。
- `limit`：无。
- **venue**：`BacktestResult` **无 exchange 字段**（`types.ts:98-114` 确认），所以「同样行情进 Replay」在数据模型上**无法表达用哪家**——这是 B10 的直接后果。

**关键阻断**：即使你推导出 `endAt`，replay 端点会（a）门拒 binance 以外；（b）符号正则拒非 USDT；（c）`[id]` 步进用默认 binance 重新抓 bar。所以 backtest→replay 的**真正前提是先解掉 B2/B6/B7/B10**。

### 5.4 Markets 选中标的 → Research 缺什么

现状：`watchlist.tsx:261` 只做 `setSymbol`；Research 只读 `selectedStrategyId`/`strategyParameters`（`strategy-lab.tsx:40-52`）。

缺的**不是数据**，而是一个动作：把「已选中 symbol」+ 可选「当前 timeframe」送达 Research 上下文，并 `setPage("research")`。**无结构障碍**。唯一注意：`api/markets/route.ts:18` 只放行 USDT 对，所以从 Markets 选出的标的在非 binance venue 下**目前根本选不到 USD 对**（B11）。

---

## 6. 按依赖排序的实施清单

> 依赖顺序：**上层解门 → 中层打通 adapter 通道与数据模型 → 下层 UI/前端 → 最后合并 Research/Backtest**。同层可并行。

### 第 0 层（前置，其他一切的前提）
1. **B10 数据模型补 venue**：给 `ReplaySession`（`core/types.ts:135`）+ `replay_sessions`（`schema.ts:67`）加 `exchange` 列；`BacktestResult`（`core/types.ts:98`）加 `exchange` 字段。
   - *为何最先*：没有它，replay 步进（B6）、backtest→replay 交接（5.3）都无法表达 venue。**B10 是 B6 的前提，也是 §5.3 交接的前提。**
2. **B6 打通 adapter 通道**：在 `ResearchBacktestRequest`（`application/index.ts:9`）、replay/paper 请求体加 `exchange`；`getWebMarketAdapter` 调用点（`backtests:62`、`replay:31`、`replay/[id]:65`、`paper:44`）改传真实 exchange。
   - 依赖 1（需有字段可传）。

### 第 1 层（解门 —— 依赖 0）
3. **B1/B2/B3/B4/B5**：移除/泛化五处 venue 门（`backtests:40`、`replay:21`、`paper:20`、`order-previews:10`、`order-previews/[id]:13`、`workspace PUT:43`）。
4. **B14 MCP 门**：`tools.ts:207,282,310`。
5. **B7 replay 符号正则**：`replay:13` 去 `\/USDT$`。
6. **B8/B9 账户体系**：`storage/repositories.ts:104,106-112,114-119` 支持 `exchange`（账户主键需迁移旧行）。
   - **依赖 1**（主键要能表达 venue）。这是**唯一涉及已存在数据迁移**的改动（线上已有 7 个账户行）。

### 第 2 层（前端 —— 依赖 0/1）
7. **B12 store 逻辑**：`store/workspace.ts:58-70`。
8. **B13 各处禁用/占位**：`terminal.tsx:376-377,615,728`、`bottom-dock.tsx`、`inspector.tsx:279-295`、`strategy-lab.tsx:169-170`。
9. **B11 符号搜索**：`api/markets/route.ts:18`（USDT→任意 quote）。
10. 文案类：`inspector.tsx:90`（`PRICE (USDT)`）、`replay:47`、`application/index.ts:37`。

### 第 3 层（合并 Research/Backtest —— 独立于 1-10）
11. `core/types.ts:127` 去 `"backtest"` → 编译器会点出所有漏改（`terminal.tsx:39`、`inspector.tsx:24`、`bottom-dock.tsx:195`）。
12. 持久化迁移：`store/workspace.ts:116-125`（version 3 + 映射 `backtest→research`）+ `storage/repositories.ts:16-25`（读时归一）。
13. 服务端枚举：`api/workspace/route.ts:14`、`mcp/tools.ts:273`（**破坏性契约**）。
14. UI 收敛 + 把 `Results` dock tab 并入 research（`bottom-dock.tsx:206-210,258-262,271`）。

### 收尾
15. **B15** 兜底与文案：`application/index.ts:3,35,37`、`application/paper.ts:1,77`。
16. **B16** E2E 桩：`e2e/api-mocks.ts:44,68,69`。
17. 新增跨 venue 回归测试（现有测试覆盖：`market-data/tests/market-data.test.ts:8` 已四家建 adapter；但无 backtest/replay/paper 的跨 venue 用例）。

### 最小闭环（若只想尽快解锁一条链路）
- 要跑通 **backtest 跨 venue**：只需 **0.1(部分) + 2 + 3 + 6*(仅 backtest 门/通道，不动账户)** —— backtest 的符号正则（`backtests:12`）本就兼容，`BacktestResult` 加 exchange 即可。
- 要跑通 **paper 跨 venue**：额外必须 **B8/B9**（账户主键）+ **B11**（否则选不到对）+ **B7 无关但 B6 首当其冲**。
- **replay 最难**：**B10（会话记 venue）+ B6（步进 adapter）+ B7（符号）+ B2** 四者缺一不可。

---

## 附录 A：本报告未验证项（推测）
- 四家 venue 的真实 `fetchOHLCV` 返回在连续性与 gap 上的差异 → **未联网验证**（你方已实测，本报告采信）。
- backtest 结果推导 `endAt` 的精确性 → **推测**可行（用 `equityCurve.at(-1).timestamp`），但可能与 replay 的 continuity 校验（`replay:34-35` `findCandleGaps`）不完全吻合。
- 账户主键迁移对线上 7 行的具体破坏面 → 需在实现阶段实测（本报告只确认了行内容）。

## 附录 B：原始证据来源
- `git grep` 全仓（排除 node_modules）用于 `getWebMarketAdapter` / `getExchangeAdapter` / `binance` / `activeWorkspace` / `exchange` / `USDT` / `EXCHANGE_TIMEFRAMES`。
- SQLite 只读查询：`packages/storage/node_modules/better-sqlite3` 打开 `.newbeing/newbeing.sqlite`（readonly），仅 SELECT。
- 未修改任何源码，未改 git 状态（`git status --short` 为空），未 commit。
