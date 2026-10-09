# Reference Map

Research snapshot: **2026-10-09**. The initial workspace contained no existing newBeing checkout, so the implementation is bootstrapped here. The repository SHAs below are pinned from `git ls-remote` / GitHub trees before implementation; source links use those immutable revisions. We read implementation files, types/docs, tests, license metadata and relevant issue/PR history. No GPL/AGPL code was copied.

## Charting — TradingView Lightweight Charts

- **Repository:** [tradingview/lightweight-charts](https://github.com/tradingview/lightweight-charts)
- **Reference revision:** `b83a741948be28a1921608e448cb0c069b9f37f0`
- **License:** Apache-2.0; preserve license/notice and visible TradingView/Lightweight Charts attribution. No Advanced Charts / Trading Platform code used.
- **Inspected:** [`website/tutorials/react/01-simple.mdx`](https://github.com/tradingview/lightweight-charts/blob/b83a741948be28a1921608e448cb0c069b9f37f0/website/tutorials/react/01-simple.mdx), [`src/api/series-api.ts`](https://github.com/tradingview/lightweight-charts/blob/b83a741948be28a1921608e448cb0c069b9f37f0/src/api/series-api.ts), [`src/plugins/series-markers/types.ts`](https://github.com/tradingview/lightweight-charts/blob/b83a741948be28a1921608e448cb0c069b9f37f0/src/plugins/series-markers/types.ts), `tests/type-checks/series-markers.ts`, and E2E marker cases under `tests/e2e/graphics/test-cases/series-markers/`.
- **Issue reviewed:** [#1429](https://github.com/tradingview/lightweight-charts/issues/1429), React Strict Mode / chart removal during resize. Cleanup must be idempotent; disconnect `ResizeObserver` before removing chart and avoid duplicate `remove()`.
- **Decision:** **Direct dependency** (`lightweight-charts` 5.x). Let its canvas, time scale, crosshair, series and markers do the hard work; React owns lifecycle/data adaptation only. Volume uses a histogram series; signal markers use the official marker API. Retain a visible attribution link at all times.

## Exchange data — CCXT + Binance public streams

- **Repository:** [ccxt/ccxt](https://github.com/ccxt/ccxt)
- **Reference revision:** `f0aca06eb7482f083bed8406fadfcc0c05e45b1c`
- **License:** MIT (`LICENSE.txt`).
- **Inspected:** `js/src/binance.js`, `js/src/abstract/binance.js`, `examples/ts/binance-server-time.ts`, `ts/src/test/static/response/binance.json`, `ts/src/test/static/markets/binance.json`, and CCXT's OHLCV manual / market-data docs. The exchange-specific class delegates common parsing, rate limiting and request handling to the shared Exchange base.
- **Issue reviewed:** [#25610](https://github.com/ccxt/ccxt/issues/25610), report of Binance `fetch_ohlcv` returning surprising timestamps for a historical `since` query. Regardless of the issue's closure, consumers should validate alignment, order, duplicate times and gaps rather than assuming an adapter response is a complete continuous dataset.
- **Decision:** **Direct dependency** (`ccxt`) for public REST, normalized market metadata, tickers, order books, trades and OHLCV. One `ExchangeAdapter` boundary keeps CCXT symbols away from the UI. Historical Replay uses CCXT's standard OHLCV `since` parameter, then server-side `completedBarsThrough` filtering; `nextCompletedBarAfter` releases only the first completed bar after the persisted cursor. For public real-time klines, use Binance's documented public stream URL and the browser's native WebSocket; CCXT's open-source package does not supply the Pro streaming API. Our code is only connection lifecycle/reconnect and candle reconciliation, not a reimplementation of a generic WS client or signed protocol. No keys are accepted.

## Backtesting — Freqtrade and LEAN

- **Repository:** [freqtrade/freqtrade](https://github.com/freqtrade/freqtrade)
- **Reference revision:** `91061b937de176bf36380bfcfb217110e724c403`
- **License:** GPL-3.0. **Architecture and test ideas only**; no source copied and no GPL runtime dependency introduced.
- **Inspected:** `freqtrade/optimize/backtesting.py`, `tests/optimize/test_backtesting.py`, `tests/optimize/test_backtest_detail.py`, `freqtrade/optimize/analysis/lookahead.py`, `tests/optimize/test_lookahead_analysis.py`, and `docs/lookahead-analysis.md`.
- **PR reviewed:** [#8369](https://github.com/freqtrade/freqtrade/pull/8369), introduction of lookahead analysis. Its differential-analysis approach motivates explicit future-leakage regression tests.
- **Decision:** **Reference design only** for the first engine. Freqtrade's dataframe/strategy ecosystem is powerful but GPL-3.0 and too broad for a small local TS vertical slice. Implement a deterministic single-market bar event loop with a narrow typed signal interface, strict next-open fills, adverse costs and result provenance. Tests compare same-input repeatability and prove that changing future bars cannot alter earlier signals/trades. Revisit a separately hosted engine only if later research shows a correctness/feature advantage worth the integration boundary.

### LEAN fill and statistics cross-check

- **Repository:** [QuantConnect/Lean](https://github.com/QuantConnect/Lean)
- **Reference revision:** `80e7843f645673bcbeaab963049f76f20f6785e1`
- **License:** Apache-2.0; design/test reference only, no C# source copied.
- **Inspected:** `Common/Orders/Fills/ImmediateFillModel.cs`, `Tests/Common/Orders/Fills/ImmediateFillModelTests.cs`, `Common/Statistics/StatisticsBuilder.cs`, and `Tests/Common/Statistics/StatisticsBuilderTests.cs`.
- **Finding / decision:** LEAN makes fill model and bar timing explicit and checks calculations with deterministic fixtures; its general statistics pipeline consumes aligned daily performance/equity points and a configured trading-days-per-year value. newBeing instead uses next-bar-open execution and reports per-bar Sharpe annualized from the median observed bar duration (365.25-day crypto year). These conventions are not equivalent; the UI and result provenance must label the chosen method rather than imply LEAN parity. Tests for stop/fill cases and equity alignment are adapted as behavior checks, not source.

### Incremental indicators and event-driven evaluation

- **QuantConnect LEAN RSI:** [RelativeStrengthIndex.cs at the pinned LEAN revision](https://github.com/QuantConnect/Lean/blob/80e7843f645673bcbeaab963049f76f20f6785e1/Indicators/RelativeStrengthIndex.cs). The update path consumes each new sample and maintains gain/loss averages through the selected moving-average implementation; Wilder smoothing is a recurrence rather than a fresh whole-history pass.
- **Backtrader indicator development:** [official indicator-development guide](https://www.backtrader.com/docu/inddev/), with its line-buffer/minimum-period lifecycle and per-bar `next`/`nextstart` callbacks. This is an architectural reference, not copied code.
- **Decision:** newBeing now has optional stateful per-candle signal streams for its three built-ins. Wilder RSI state is updated once per completed bar; SMA uses a bounded ring of closes while summing each active window in the same chronological order as the prior loop, preserving floating-point results; momentum retains only its lookback window. Strategies without a stream retain the stricter `signalAt(prefix)` fallback, so custom/future implementations cannot see bars after the current index. Golden fixtures hash the complete signal series, trades, and equity curve against the pre-optimization execution.
- **Benchmark baseline:** on the local Node 24 runtime and deterministic synthetic-wave fixture, the original prefix-copy implementation took about **17.4 s for 100k SMA bars** and **4.9 s for 10k RSI bars**. The old 100k RSI run was stopped after it did not finish within the benchmark budget. Current-size results are generated with `pnpm bench`; timings are machine-specific and are not CI pass/fail thresholds.

## MCP — official TypeScript SDK

- **Repository:** [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **Reference revision:** `b022522089a0c8b632595c6e7b536453945ed5a9`
- **Published dependency:** `@modelcontextprotocol/server@2.3.1` plus `@modelcontextprotocol/client@2.3.1`.
- **License:** Apache-2.0 for the pinned repository and server package; preserve license/notice on redistribution.
- **Inspected:** `examples/guides/servers/tools.examples.ts`, `examples/guides/serving/stdio.examples.ts`, `packages/server/src/server/mcp.ts`, `packages/server/src/server/serveStdio.ts`, `packages/server/src/server/stdio.ts`, and `packages/server/test/server/stdio.test.ts`.
- **Issue / PR reviewed:** historical v1 [#2776](https://github.com/modelcontextprotocol/typescript-sdk/issues/2776) reports a stdio client deadlock when stderr is piped but not drained; [#2678](https://github.com/modelcontextprotocol/typescript-sdk/pull/2678) adds protocol error surfacing. The app uses the v2 `serveStdio` entrypoint, emits no protocol/log text to stdout, and the SDK's own stdio tests are the behavior reference.
- **Decision:** **Direct dependency** on the current official TypeScript SDK v2 packages; local stdio transport only. Tools call the same application services as HTTP/UI. Market reads and workspace reads are safe; backtest/strategy writes are research-scoped; `prepare_order` stores a Paper-only preview and never submits an order. Live order execution is not registered. ChatGPT cannot call localhost simply because a browser app runs there; an authenticated remote HTTPS bridge is explicitly out of scope until independently designed and audited.

## UI/product reference — FreqUI

- **Repository:** [freqtrade/frequi](https://github.com/freqtrade/frequi)
- **Reference revision:** `f13e40004432c0d62aee8b424113e871cf44d6c7`.
- **License:** GPL-3.0. No source/components copied or linked.
- **Inspected:** `src/utils/charts/candleChartSeries.ts`, `src/utils/backtestMetrics.ts`, `src/stores/chartConfig.ts`, `e2e/chart.spec.ts`, and `e2e/backtest.spec.ts`.
- **Finding / decision:** pair controls, plotted trades, dense chart/results hierarchy and E2E assertions around refreshing chart data are useful product references. FreqUI displays metrics computed by the Freqtrade backend; it does not establish our metric formulas. Its backend coupling and GPL license make it unsuitable as a dependency. Use a fresh React/Tailwind design and local Radix/shadcn-style primitives instead.

## Exchange stream protocol — Binance Spot API docs

- **Repository:** [binance/binance-spot-api-docs](https://github.com/binance/binance-spot-api-docs)
- **Reference revision:** `263ac1aa96556af0b4da824c82a1d8cd9a0edda9`
- **Inspected:** [`web-socket-streams.md`](https://github.com/binance/binance-spot-api-docs/blob/263ac1aa96556af0b4da824c82a1d8cd9a0edda9/web-socket-streams.md), especially UTC kline intervals, event timestamp and close flag fields.
- **License:** GitHub API reported no license metadata for the docs repository at this revision; documentation only, no text/code copied into the app.
- **Decision:** Use the documented public `/ws/<symbol>@kline_<interval>` stream and its `k` payload (open time, OHLCV, closed flag) with the browser's native WebSocket implementation. Application code handles reconnect and REST reconciliation only. Do not treat a connected socket as proof of gap-free history.

## Reuse / license ledger

| Component | Use | License decision | Attribution / caveat |
| --- | --- | --- | --- |
| Lightweight Charts | npm dependency | Apache-2.0 compatible | Visible TradingView Lightweight Charts attribution in chart footer; no Advanced Charts code |
| CCXT | npm dependency | MIT compatible | Keep its license via package manager; public-only adapter |
| Freqtrade | read design/tests only | GPL-3.0 not copied/linked | Lookahead/backtest behavior is independently implemented |
| LEAN | read design/tests only | Apache-2.0, no source copied | Different daily statistics convention; note newBeing's per-bar Sharpe method |
| FreqUI | read UI/tests only | GPL-3.0 not copied/linked | Fresh layout; backend-computed metrics only |
| MCP TypeScript SDK | npm dependency | Apache-2.0 compatible | Preserve NOTICE; verify package license at version bumps |
| Binance public stream | documented wire API | docs repo has no detected license metadata; no code copied | Public-only; reconnect and REST gap repair required |

## Verification follow-ups

Use the referenced chart marker type/e2e cases for marker rendering; CCXT market fixtures for symbol and OHLCV normalization; Freqtrade lookahead tests as a model for perturbation-based leakage checks; and MCP SDK stdio tests for connect/list/call behavior. Each new major module adds its own executable test before it is considered complete.

Historical Replay has a dedicated storage cursor and tests that prove retries at the same cursor do not append another candle; the REST route only returns server-filtered completed bars at or before the cursor, and Replay UI/MCP/API surfaces suppress current quotes and full-history backtest results until Replay is exited.
