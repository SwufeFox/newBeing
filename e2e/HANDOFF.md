# Replay E2E handoff

## Verification closeout (2026-10-21)

The original static handoff below is historical. The final sequential verification after adding journal JSON export and its browser download reconciliation completed successfully: `test`, `typecheck`, `lint`, `build` and `test:e2e` all exited **0**. The real-backend fixture suite passed **6/6 in 3.8 minutes**, without API stubs, retries or skipped training tests. Playwright's final result metadata records `status: passed` with no failed tests. Non-failing lint and dev-server diagnostics are recorded in `docs/functional-architecture.md`.

Protocol corrections made during execution: write requests supply the loopback Origin required by the existing proxy guard; the broad market assertion waits specifically for candles, not summary/book/tickers; broad-test setup resets the singleton workspace before navigation. The fixture summary uses quote acquisition time rather than candle-open time. Replay configuration fields wrap so the seed button remains clickable within the chart column; no forced/keyboard click bypass was introduced for this failure.

The browser case now downloads `replay-{sessionId}.json` and compares its entire session/execution/report payload to the actual final API snapshot, including saved notes, tags, fills, equity and the revealed candle prefix. Export reads persisted client state; unsaved note edits are not included. There is no extra export API endpoint.

Validation data, browser temp and results were isolated under `.newbeing/replay-validation-20261021` and removed after recording the results and confirming the runner and its tracked descendants had exited, with no listener on port 3100. The generated `next-env.d.ts` changes were restored. Pre-existing build directories, `test-results`, screenshots, logs and local databases were retained. See `docs/functional-architecture.md` for the complete check results and explicit remaining limits.

## Original source-only handoff

Implementation is confined to `e2e/`. No build, typecheck, lint, test discovery, test execution, development server, or browser session was run for this change. Review is static against the current working-tree routes, fixture adapter, persistence and matching code.

## Changed coverage

- `workstation.e2e.ts`: repair old navigation selectors using the existing `workspace-*` test IDs; add four real-backend training cases.
- `replay-api.ts`: HTTP helpers, protocol shapes and independent balance/fee/report reconciliation from returned fills.
- Keep the training cases in the existing spec: Playwright runs a file's tests sequentially, which avoids new parallel files racing the singleton workspace row.

The training cases cover configured capital/fees/slippage, pending market/limit/stop orders, cancellation, next-bar execution, partial closing, insufficient-balance rejection without partial fills, exact order retries, conflicting intent, stale revisions, exact step retries, journal persistence, reports, retained inventory on finish, session and normal Paper account isolation, revealed-candle boundaries, venue/symbol/timeframe mismatch, and live/research visibility gates.

Bracket cases cover entry-bar stop protection, a later candle touching both SL and TP with stop winning, adverse stop-gap pricing, and targets waiting until after their entry bar. Every trigger and expected price comes from actual returned OHLC and configured costs. No order or fill response is mocked by the new cases.

The browser case uses the existing UI to seed a configured session, queue a buy, advance one bar, change speed, save notes/tags, reload its ledger, and finish while retaining inventory. Assertions inspect both responses and visible controls/position. Browser history/account checks reuse the real API.

## Protocol used

1. Read and PUT the complete workspace state; select Binance BTC/USDT, daily candles and Markets (`activeWorkspace: terminal`).
2. Read fixture candles from `/api/market` before entering Replay. Assert its source is `Deterministic test fixture`; never fall back to live prices.
3. POST `/api/replay` with `endAt` at a selected candle's close, `limit: 50` and explicit configuration. `endAt` is a completion cutoff, not a bar-open cursor. The UI uses local datetime input; API times are epoch milliseconds.
4. Seed responses contain session/execution/portfolio but no report/orders. GET `/api/replay/{id}` supplies the full snapshot.
5. Orders use UUID `requestId`; returned IDs are `replay-{sessionId}-{requestId}`. All commands send `expectedRevision`; steps also send the pre-step `expectedCursor`.
6. Steps expose one contiguous next bar. `futureBarsLoaded: 0` describes client visibility, not absence of server prefetch/cache.
7. Normal Paper GET is blocked while Replay is selected. Switch back to Markets before comparing the normal Paper portfolio. Research history is `/api/backtests`, not `/api/experiments`.
8. Finish cancels pending orders and marks remaining inventory. It does not liquidate the position. Reports remain available through session GET; no download/export endpoint is assumed.

## Fixture and integration limitations

- `PLAYWRIGHT_API_STUBS=1` uses the old browser fixture protocol: it lacks configured execution/revision/fill/report state and treats arbitrary Replay POSTs as steps. New training cases explicitly skip in that mode. The old mock implementation is unchanged.
- The real fixture adapter builds 1,000 bars relative to the current completed interval, so it is deterministic by index rather than immutable by timestamp. Daily bars reduce the rollover window; a run crossing UTC midnight can still observe shifted fixture values. Assertions compare revealed bars to the data read at setup so that drift fails visibly.
- Only Binance has a deterministic backend fixture. Mismatched-venue checks test the Replay boundary, not remote venue connectivity or execution.
- An external `PLAYWRIGHT_BASE_URL` must already serve the current protocol in nonproduction fixture mode with an isolated data directory. The checked-in Playwright config provisions these when starting its own server.
- At source review, `apps/web/src/lib/candle-cache-adapter.ts` referenced `interval` inside its completion filter without declaring it. This can block seeding/compilation until the concurrent production fix lands. It was not edited here.
- At source review, the backend fixture summary timestamp was the last daily/15-minute candle's open rather than a fresh quote acquisition time. The pre-existing broad workstation test's real Paper order can therefore encounter its quote freshness guard. No fake quote/fill was added to bypass it.

## Deferred verification

After the production developer completes compile/unit fixes and authorizes execution, use the existing Playwright configuration. The focused selection is the `manual Replay training against the real API` describe block in `e2e/workstation.e2e.ts`. Run the complete spec afterward to include navigation and existing fixture smoke coverage. Passing status is intentionally not claimed in this handoff.
