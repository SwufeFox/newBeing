# newBeing functional architecture: audit and delivery plan

Audit started 2026-10-21 (Asia/Shanghai). This is an evolutionary implementation, not a UI rewrite. It records observed source behavior separately from intended architecture and from verification results.

## Source boundary and preservation

- Local branch: `main`; audited starting HEAD: `7d2b738` (`feat(web): add candle cache adapter to market, backtest and replay APIs`).
- Read-only remote discovery (`git ls-remote --symref origin HEAD`) identifies default branch `main` at `396e4c064170abb3ab024250858ba8609e30537b`. No fetch, checkout, merge, commit, staging change, or push was performed. Remote HEAD is not the local starting HEAD.
- Seven pre-existing working-tree edits add Replay provenance to core types, storage schema/migrations/repository, Replay routes and controls. Preserve them in place. The following baseline describes HEAD plus those edits, not an assertion that the working tree was clean.
- Preserve Next.js/pnpm monorepo, existing built-in strategies, CCXT public Spot paths, isolated Paper/Replay wallets, SQLite persistence, local MCP and loopback API protections.
- Functional UI only: reuse current controls and styling. Strategy/AI rendering remains outside this implementation slice. Live execution and untrusted strategy execution remain disabled.

## Observed baseline and gaps

| Area | Working behavior observed | Partial/missing behavior or correctness risk |
| --- | --- | --- |
| Public connectors | `packages/market-data/src/types.ts` defines search, latest/since OHLCV, summary/batch summaries, order book and trades. Four CCXT Spot connectors exist. `EXCHANGE_TIMEFRAMES` records venue-specific support. | `MarketSymbol` only exposes symbol/base/quote/active, without native instrument identity, precision or limits. Canonical instrument and explicit capability records are needed. Coinbase/Kraken pagination flags exist; flags alone do not prove complete remote historical coverage (especially Kraken retention). |
| Candle cache | SQLite `candle_cache` keyed by exchange/symbol/timeframe/timestamp; 30-day write-age TTL. Web wrapper is online-first, fallback on errors. | Baseline `pnpm typecheck` fails in `packages/storage/src/repositories.ts:16` with TS2349: Drizzle transaction result is called as a function. Wrapper spreads a class adapter, losing prototype methods. Web backtest provenance callback is nested while application expects flattened metadata. Partial/forming candle retention requires regression tests. This is not a download catalog or immutable dataset snapshot. |
| Built-in research | `runResearchBacktest` resolves venue, fetches candles, removes forming bars, rejects gaps, records strategy/config/engine/dataset identity and saves results. Sweeps reuse one candle set; history comparison exists. | Dataset ID hashes candle content but does not create a reusable catalog/snapshot. Source drafts are stored, not executed. No secure custom-code runner, multi-instrument portfolio simulator, walk-forward manager or cancellable jobs is evidenced. `openInWorkspace ?? true` has an implicit workspace-write side effect. |
| Paper accounting | Core buy/sell accounting includes fees in entry cost basis, partial sells and realized PnL; explicit lifecycle includes unknown outcomes. Storage separates venue/symbol account namespaces. | Portfolio is a two-balance symbol wallet, not a shared multi-asset account. A unified order/fill/event model is not yet used across environments. Legacy records must not be relabeled as canonical multi-asset history. |
| Replay | Seed filters completed bars at cutoff; steps enforce consecutive timestamps; sessions and isolated wallets persist. Existing provenance edits preserve cache origin. Play/pause/speed and restoration exist. | `packages/application/src/replay.ts` immediately finalizes at supplied price; Web route passes already-observed current close. No pending limit/stop matching, cancellation queue, shared simulation transaction, durable snapshot identity, or full journal/report. Current-close execution is unsuitable for the new trainer and must not be silently reinterpreted in old records. |
| Workspace/UI | Zustand persisted workspace state and SQLite workspace API; Markets/Research/Replay; watchlist and panels; legacy Backtest workspace migrates to Research. | Six independent workspaces, linked multi-charts, drawings and full docking are future work. Do not recreate removed workspaces just to satisfy a navigation checklist. Only integrate controls needed by the functional slice. |
| MCP | `packages/mcp/src/tools.ts` exposes local workspace, completed public candles, isolated Paper/Replay wallet, draft storage, approved built-in backtests and experiment queries. Replay candle queries require the active session symbol/timeframe; experiment reads are gated during Replay. Drafts are explicitly `executable: false`. | `get_portfolio` calls `paperAccountId(symbol)` without selected venue, and `run_backtest` retains a Binance-only gate despite the shared multi-venue application service. Dataset catalog, canonical portfolio and completed-session analysis/export remain missing. Existing `get_market_data` description is stale about Binance-only behavior. These paths need boundary and venue regression tests. |
| Real accounts | No authorization to submit real orders. | Secure local credential storage, read-only private connectors and reconciliation are prerequisites; keep disabled until implemented and tested. Never infer account balances or FX rates from public ticker data without explicit rate provenance. |
| Verification | CI runs test, typecheck, lint, build, Chromium E2E and MCP smoke; Playwright has loopback-only external URL validation and isolated fixture database configuration. | Baseline typecheck fails as recorded above. Prior passing tests predate cache/provenance edits; no previous pass is a current pass. Broad regression results will be recorded separately after implementation. |

## Additional source-audit findings

The independent read-only audit completed against the starting tree and identified these specific defects/limits. They are not assertions of post-change failures:

- `paper_orders` has no durable account/venue/session binding. Wallet IDs are isolated, but duplicate-ID comparison only checks symbol/side/quantity. Order history is global; Replay filters its prefix after a global latest-100 limit. Existing previews omit venue and confirmation uses current workspace venue. Shared-account rollout must migrate bindings rather than assume namespace isolation also isolates order history.
- Paper intent/quote/fill is durable in stages, but created/submitted/unknown retries do not resume automatically. `unknown` must be reconciled, never blindly retried. Browser ticket UUIDs are generated per click, so lost-response retries may submit a genuinely new ID.
- Replay step initially accepts only `{ action: "step" }`; stale-cursor comparison protects overlapping fetches, but a later retry can read a new cursor and step again. New execution API needs an explicit expected cursor/request revision.
- Source-draft execution is correctly disabled. Built-in strategy regression fixtures cover next-open fills, stop-first behavior, fees, deterministic/prefix invariance and streaming parity. There was no Replay application test file before this implementation.
- Original sweep dataset identity records endpoints without a content hash; experiment replay refetches history. Server caching can fetch ahead while `futureBarsLoaded: 0` denotes client-visible bars only. A future immutable dataset service must make that distinction explicit.
- `/api/market` retains a Binance-only Replay gate and fails to bind venue to `session.exchange`. MCP normal portfolio defaults to Binance and research/preview/navigation have stale Binance-only restrictions. These must be corrected before claiming multi-venue behavior across all interfaces.
- Selected backtest chart markers are not originally filtered by venue/symbol/timeframe; changing market selection can overlay another experiment. Workspace synchronization uses a singleton row and timestamps rather than optimistic revisions, so it is not independent per-client state.
- Existing Playwright source uses a `terminal` button label although navigation renders `Markets`, and fixture quote timestamps are bar opens older than the Paper 30-second freshness threshold. E2E failures must be diagnosed against source drift rather than papered over. MCP smoke only exercises registration/context/draft operations, not Replay/portfolio boundaries.

## Target dependency boundaries

`core` owns canonical identity, validated order lifecycle and pure deterministic accounting/matching. `market-data` owns public transport, native metadata normalization, capabilities and historical fetches. `storage` owns migrations, transaction boundaries, durable order/event/fill/session state and dataset metadata. `application` owns use cases, visibility/risk policy and environment-specific orchestration. Web and MCP call application services; neither is an execution engine or secret store.

Canonical instrument identity is `(exchange, marketType, nativeId)` with an encoded stable ID; normalized display symbol remains separate. Spot support must be explicit. Perpetual/Futures are domain distinctions, not enabled capabilities. Every order/fill/position carries explicit account and venue identity. Paper, Replay and real accounts are separate environments. Valuation does not net unrelated wallets or invent USD/USDT parity.

## Prioritized implementation plan

### Phase 1 — Core foundation and high-risk regression coverage

1. Fix existing cache transaction, adapter delegation and provenance mismatches; add fixtures for fallback, isolation, completion boundaries and optional metadata.
2. Add canonical instrument/account/order/fill/event contracts and tested lifecycle transitions. Integrate these with real Replay records and native public metadata rather than creating unused interfaces.
3. Use additive, restart-safe migrations for Replay version/configuration/execution records. Preserve legacy tables and provenance. Do not transform legacy close fills into next-bar fills.
4. Expose capabilities/instrument identity through existing public services/API without breaking symbol consumers.

### Phase 2 — Persistent Replay vertical slice (current priority)

1. New simulator version with explicit virtual clock, initial capital, fees/slippage, dataset identity and execution assumptions.
2. Persist intent first; market orders wait for next available bar open. Match limit/stop orders only against later candles. Record conservative gap and ambiguous OHLC behavior; bar simulation is not tick simulation.
3. Atomically advance cursor, match pending orders and protective exits, record fills/events, update balances/position and equity. Enforce request idempotency and expected-cursor concurrency checks. Prove rollback/reload behavior.
4. Connect minimal existing controls for order type/prices, cancellation, session configuration and notes/tags. Include partial closing, journal export and a report derived from stored fills/equity.
5. Add a deterministic E2E discretionary workflow. Keep public/research/MCP future-data gates intact and do not return prefetched future arrays.

### Phase 3 — Reproducible quantitative research

Immutable dataset catalog/checksums, source provenance, gap/duplicate validation, bounded downloads and file-based columnar storage for large datasets; CSV/Parquet import/export; explicit strategy API/versioning. Custom source execution remains disabled until an isolated runner has enforceable CPU/memory/time/filesystem/network limits and adversarial tests. A worker thread or Node `vm` alone is not a security boundary. Add validation/walk-forward/cost sensitivity and cancellable runs after the dataset boundary is sound.

### Phase 4 — Multi-exchange portfolio

Shared multi-asset Paper accounts with migration compatibility, explicit positions/fills, timestamped FX conversion and unavailable/stale warnings; portfolio snapshots. Then secure local secret-storage boundary and read-only private account connectors, reconciliation and unknown-outcome recovery. No live trading.

### Phase 5 — MCP and stabilization

Expose approved dataset/experiment/portfolio/completed-Replay workflows using the same application services and visibility policy. Add structured export, API consistency, regression/performance evidence and operational documentation. Live order submission is excluded and requires separate authorization.

## Migration and safety acceptance

- Additive migrations; legacy rows remain readable and are identified with their actual execution convention.
- One durable transaction per Replay mutation; no network work while a database transaction is open.
- Reused idempotency keys with incompatible intent must reject rather than return unrelated success.
- Finite positive quantities/prices, balances/fee constraints, no Spot shorting; native precision/minimum constraints must be distinguished from unavailable metadata.
- No future candle exposure in Replay responses/indicators/MCP; immutable server-side datasets may contain future bars but clients receive only the visible prefix.
- No unrestricted user-code execution, raw credentials, real order submission, fake fill liquidity or fabricated valuation rates.
- All changes remain unstaged and uncommitted for review.

## Review cases required for the Replay slice

These independent-review cases must be resolved or reported as remaining limits before acceptance:

1. **Legacy cache finality:** an hourly candle cached at 12:10 for a 12:00 open must not become usable as a final candle after 13:00 merely because wall time advanced. Compare acquisition time to close time or invalidate/refetch it.
2. **Bracket validity:** a buy limit at 90 with SL 95 on a 100/100/89/96 bar must not produce a profitable stop-loss fill from an invalid above-entry stop. Validate against applicable entry/fill and define gap invalidation.
3. **HTTP retry identity:** repeating the exact step command after a lost response must not advance another candle. Require expected cursor/revision or a durable command identifier; internal transaction safety alone is insufficient.
4. **Ledger consistency:** MCP, GET session, ticket, journal/report and step responses must read the same configured-capital execution ledger. Do not initialize a separate default legacy wallet when querying a new session.
5. **Venue binding:** request venue must equal `session.exchange`, including for already-revealed candles. Do not accept a Binance label for Kraken session bars.
6. **Preview/order account binding:** prepare on one venue, switch workspace venue, then confirm. The approved intent must stay scoped to its original venue/account. Same client ID on another account must reject; finalization must use the saved binding.
7. **Server prefetch terminology:** server-side future storage is permitted only behind the visibility boundary. A `futureBarsLoaded: 0` response describes client visibility, not a claim that upstream was never prefetched. This slice should bound step fetch/cache to the next permitted bar where practical.

## Verification log

- Before implementation: `pnpm.cmd typecheck` **failed**, `packages/storage/src/repositories.ts` TS2349 (transaction return called). This is a baseline finding, not an environmental blocker.
- Verification closeout (2026-10-21): initial `test` and `typecheck` passed. Initial lint exposed the plain `.mjs` Babel-parser configuration and a synchronous Replay chart state reset; both were corrected without disabling the rules. A missing `exchange` callback dependency was also corrected.
- Core review case 2 is now covered by three regression examples: brackets invalid relative to the actual entry fill reject before changing inventory or charging fees, including adverse gap invalidation. The fill-policy text records this behavior.
- Full real-backend fixture E2E passed **6/6** after correcting missing test Origin headers, candle-response selection, shared workspace setup and the overflowing Replay seed controls. No training case was skipped. The final sequential run also passed **6/6 in 3.8 minutes**, including browser download reconciliation of journal JSON against the persisted session, execution and report.
- `pnpm.cmd mcp:smoke` passed with 12 registered tools and real stdio checks for configured Replay capital/fees/fills, visible-prefix candles, symbol/timeframe/venue mismatch rejection, hidden research history and disabled live previews. MCP selected-venue checks and normal Paper portfolio venue selection were corrected.
- Final sequential verification after the JSON journal export addition (2026-10-21): `pnpm.cmd test`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build` and `pnpm.cmd test:e2e --output=.newbeing/replay-validation-20261021/results-release` all exited **0**. The production build compiled, completed TypeScript checking, generated all four static pages and finalized page optimization. Playwright's final result metadata records `status: passed` and an empty `failedTests` list. Lint reports two warnings (the existing `bottom-dock.tsx` effect dependency and an unused disable in `decoded.tsx`) and no errors.
- Non-failing runtime diagnostics: an earlier E2E pass emitted a `RailRunHistory` React list-key warning; the final E2E dev server emitted `Failed to generate static paths` / `Unexpected end of JSON input` diagnostics. All six final tests subsequently passed without retries or skips; these dev-server diagnostics were not reproduced or resolved independently. Expected negative Replay commands also logged rejected intent/revision/finished-session warnings.
- Cleanup closeout: runner PID 22204 and the tracked pnpm, Playwright, Next.js and Chromium descendants all exited; no listener remained on port 3100. After recording the results, only the run-owned `.newbeing/replay-validation-20261021` directory (scripts, logs, diff snapshot, isolated databases, caches and browser results) was removed. Pre-existing build directories, `test-results`, screenshots, logs and local databases were retained. The E2E-generated `apps/web/next-env.d.ts` path changes were restored and its Git diff is empty. Changes remain unstaged and uncommitted.

### Remaining scope and evidence limits

- The current Replay ledger is versioned and durable; it is not an immutable historical dataset catalog. The 1,000-bar visible window and server candle cache are not a dataset snapshot/checksum service. That remains Phase 3.
- Native connector precision/limits are exposed as metadata, but Replay does not enforce venue lot-size/min-notional constraints. It uses the documented full-fill/balance-rejection OHLC model without liquidity or volume simulation.
- Normal Paper preview/account binding (review case 6) and legacy global order-history filtering remain separate pre-existing limitations. The new configured Replay ledger uses its own account/instrument-bound orders and fills; do not describe the normal Paper migration as complete.
- MCP still has pre-existing Binance-only gates on backtest initiation, Replay navigation and Paper previews. This closeout verifies active-session reads and visibility; it does not claim complete multi-venue MCP workflow support.
- No remote venue connectivity/pagination tests, OS sandbox tests, mobile visual review or performance benchmarks were run. Live execution and untrusted source execution remain disabled.

