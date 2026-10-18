# Cross-Venue + Mode Consolidation — Implementation Plan

Source: `docs/cross-venue-audit.md` (evidence-backed audit, 2026-10-18).
Owner decisions (asked 2026-10-18 21:31 Asia/Shanghai):
- All three functions should run on **all four venues**, not Binance only.
- **Merge Research and Backtest into one Research tab** (top nav goes 4 → 3).
- Purpose: a workstation for the owner's own research.

Order chosen: **consolidate modes FIRST**, then unlock venues. Rationale: removing a
mode shrinks the surface every later venue change has to touch. The audit had the
order the other way; the merge is independent (audit §4) and cheaper first.

---

## Status ledger

| # | Step | Status |
|---|---|---|
| 1 | `BacktestResult` + `ReplaySession` gain `exchange` | ✅ done |
| 2 | `EXCHANGE_TIMEFRAMES` guard reaches Coinbase's limits | ✅ done |
| 5 | Adapter channel: request carries `exchange` | ✅ done |
| 6 | Remove the venue gates | ✅ done (all 6) |
| 7 | Replay symbol regex stops requiring USDT | ✅ done |
| 8 | Paper account keys become venue-aware | ✅ done |
| 9 | Symbol search allows non-USDT quotes | ✅ done |
| 10 | Symbols re-denominate per venue | ✅ done |
| 14 | Paper account namespace honoured end-to-end | ✅ done |
| 15 | Kraken ticker timestamp fallback | ✅ done |
| 3 | Merge Research + Backtest into one mode | ✅ done |
| 4 | Persistence migration (`backtest` → `research`) | ✅ done |
| 16 | Fix two field-name bugs in the results board | ✅ done |
| 17 | Book mid/spread collision + trade table clipping | ✅ done |
| 10 | Mode handoffs: Backtest→Replay, Markets→Research | ⬜ todo |
| 11 | Research closure: parameter sweep + strategy compare | ⬜ todo |
| 12 | Cross-venue regression tests | ⬜ todo |
| 13 | Front-end gates (disabled tabs, "Binance only" copy) | ⬜ todo |

### Verified so far

- **Step 1** — all 6 packages compile; **20 tests pass** (15 core + 5 storage).
- **Step 1 migration** — built a real pre-upgrade database (9 columns, no
  `exchange`, one live session row), opened it through `getDatabase()`:
  column added, **row count unchanged at 1**, read back as
  `exchange: "binance"` (the truthful backfill, not a guess).
- **Steps 5/6/7/2** — `EXCHANGE_TIMEFRAMES` is now consulted with the *requested*
  venue so Coinbase's lack of 30m/4h fails at the edge with a clear message
  instead of deep inside CCXT. `tsc` clean across core/application/storage/mcp/web.
- **Step 8 (live data at risk)** — 15/15 assertions pass against the REAL
  database, read-only: all 6 stored Binance account ids **round-trip
  byte-for-byte**, so balances still resolve; the BTC balance reads back
  `9342.892123860005`, unchanged; non-Binance venues now produce sane ids.
  `PAPER_ACCOUNT_ID` (the quote-only default account) was deliberately not
  touched.

### Two bugs I introduced and caught

1. My first account-id test used a **relative** `NEWBEING_DATA_DIR`, which
   resolves against the *process* cwd — so it silently audited a **freshly
   created empty database** and reported `quote=10000` where the real row holds
   `9342.89`. A read-only audit must open the file by absolute path.
2. That same test called `getPaperPortfolio`, which **INSERTs on miss** — an
   audit must never write. Rewritten to use `better-sqlite3` directly, readonly.
3. First run reported `FAIL PAPER_ACCOUNT_ID unchanged`. That was the
   **assertion** being wrong, not the product: `PAPER_ACCOUNT_ID` is the
   three-segment default account, not a symboled one, so it can never equal
   `paperAccountId("BTC/USDT")`. The constant itself is unchanged.

### Gates removed (all seven)

`api/backtests` (POST), `api/replay` (POST), `api/replay/[id]` (step),
`api/paper` (GET+POST), `api/order-previews` (GET), `api/order-previews/[id]`
(POST), `api/workspace` (PUT). Replay isolation remains in every one of them —
that is a future-data-leak guard, not a venue limit.

### Live cross-venue result (real market data, not fixtures)

`12/12` on backtest + replay + paper across binance / okx / coinbaseexchange /
kraken. Backtest equity per venue: 9705.04 / 9705.51 / 9703.97 / 9706.75 (the
venues genuinely quote different prices, so the runs legitimately differ).
Replay sessions record and keep their own venue and step successfully.
Paper fills price off the venue's own book: 81340.20 / 81326.10 / 81224.15 /
81230.80. Replay isolation still returns 409 for backtest history and paper
orders.

### Three real bugs found by testing, not by reading

1. **The paper account namespace was ignored on three of four paths.**
   `executePaperOrder` built the intent against the venue's account but let
   `finalize`, `markUnknown` and `readPortfolio` fall back to the default venue,
   so the fill was booked to one account and read from another →
   "Paper account not found" on Coinbase.
2. **Kraken returns a ticker with no timestamp at all** (`undefined`, verified
   against the live API). The quote-freshness guard rejects that, which made
   Kraken structurally unable to fill a paper order. Fixed in the adapter by
   falling back to the newest trade's time — an observed exchange value; still
   null if unavailable, so no invented clock.
3. **Switching venue kept the old pair.** Going from Binance to Kraken left the
   app on `BTC/USDT`, which Kraken does not list, so the book header, the ticket
   and every watchlist row quoted a market that cannot be fetched. Pairs and the
   watchlist now re-denominate through one shared map, on both the client and
   the server (the server is the authority: it normalises on write, and the
   client adopts the correction instead of keeping the value that was rejected).

### The merge (step 3/4)

Top nav is now **Markets / Research / Replay**. Research owns the strategy
parameters *and* the results board, which is what makes it usable for iterating;
previously you configured a strategy in one workspace and read its metrics in
another. Verified in a real browser: inspector offers Book/Trades/Strategy/AI,
the dock offers Results/Experiments/Execution, and the rail shows the strategy
roster and run history together.

**Migration is read-side and idempotent.** An old `activeWorkspace: "backtest"`
is healed to `research` when the row is READ, so the API never hands the UI a
workspace it cannot render. Verified 8/8 against a database built to look
pre-merge: symbol, activeBacktestId and layout all survive; the value is
`research` afterwards; a second read is unchanged.

Three surfaces still ACCEPT the retired value so nothing breaks:
the `/api/workspace` PUT (normalises rather than 400s — a 400 would wedge the
client's sync loop, which retries every 350ms), the MCP `open_workspace_view`
enum, and the localStorage `migrate` (version 2 → 3).

### Two field-name bugs found by looking at the rendered result

Both were silent: the data was correct and the UI read the wrong name.

1. The run-history rail read `metrics.totalReturnPct`; `BacktestMetrics` exposes
   `totalReturn` as a **fraction**. Every row rendered "—".
2. The trade table and equity-curve label defaulted to `USDT` instead of the
   pair's own quote, so a `BTC/USD` run was labelled USD in one place and USDT
   in another.

### Two layout defects the merge exposed

1. The book mid row: `81,188.895` and `SPREAD 0.0100` overlapped once a
   five-figure price needed more room than the ETH-era layout gave. Now the
   spread stacks label-over-value; measured 85px of clearance.
2. The trade table's `REASON` column was clipped by its own scroll box. It
   scrolls now (871px of content in a 775px client).

### A build failure I caused

Importing the venue label map from `@/lib/market-adapter` into a **client**
component pulled CCXT into the browser bundle (22 Turbopack errors). The labels
now live in `@/lib/exchanges`, which imports nothing but a type.
Lesson: a module that reaches a server-only dependency must never be imported by
a client component just to borrow a constant.

### Corrected during implementation

The audit had the order as venues-first, modes-second. Swapped: consolidating
modes first shrinks the surface every venue change has to touch.
Also the audit said the backtest gate was at `route.ts:43-44`; the actual gate
was `40-41` (43-44 is the JSON parse). Verified by reading the file.

## Non-negotiable invariants (must hold after every step)

1. **Safety boundary unchanged**: live trading stays off. No new order endpoint.
   `localApiGuard` (Host/Origin/JSON) keeps rejecting; Replay still forbids
   future-derived reads (409).
2. **Determinism preserved**: same input → identical equity, to the last decimal.
3. **No silent data loss**: existing SQLite rows and localStorage snapshots must
   survive migration. `backtest` is remapped on READ, not deleted.
4. **tsc + next build + 40 package tests stay green.**

## Why step 1 comes first

Both handoffs the owner wants depend on it: "same market conditions into Replay"
cannot even be expressed while `BacktestResult` has no venue, and Replay's step
endpoint re-fetches bars by id — without a venue on the session it falls back to
`getWebMarketAdapter()`'s Binance default and would silently mix venues.
