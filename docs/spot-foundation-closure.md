# Spot foundation closure — working record

Status: the implemented spot foundation has passed targeted acceptance regressions. Full-repository test/typecheck/lint/build/MCP remains owned by the main thread; its results have not returned to this worker. This is not a claim that those checks passed or that the broader research iteration is complete. Existing uncommitted work is preserved; no stage/commit/push and no migration/reset of legacy assets.

## Closed implementation gaps

- Storage idempotency compares symbol, side, quantity **and maximumPrice** inside the immediate SQLite reservation transaction. Identical concurrent requests produce one quote/fill; differing price bounds reject. This behavior was already present when this worker inspected the tree and is now covered by the verified storage/application regressions.
- Backtest persists an explicit executionPolicy for new results. Spot and explicit legacy-margin retain separate accounting/protection descriptions; legacy records may omit the field. Spot Backtest is checked against shared-wallet settlement for rounded quantity, entry fees, net PnL and final equity. These policy changes were already present on inspection and passed the targeted regressions.
- A deterministic local precision/balance rejection during shared spot settlement now ends as rejected and releases only that order's reservation. It no longer becomes unknown and indefinitely retains funds. Unexpected/network failures still retain an unknown reservation for explicit cancellation; persistence failures still roll back balances, fills and ledger together.
- Concurrent HTTP retries of a submitted shared-wallet intent return 202, just like unknown intents, instead of a false 422 rejection. The existing ticket retains the request ID for pending/unknown orders and refreshes it after a final outcome or cancellation of that request.
- Frozen Replay steps no longer initialize the live connector or candle-cache adapter. Frozen starts also avoid constructing a candle-cache adapter, and their session metadata no longer labels frozen bars as live. No page layout was redesigned.

## Verified paths and acceptance evidence

A source-resolved narrow Vitest run completed with exit 0: **8 files, 55 tests passed**. The temporary runner configuration pointed core/storage/application/market-data imports at their TypeScript sources and the web alias at apps/web/src, avoiding dependence on dist artifacts while the main thread owns the full build. The temporary runner configuration was removed after verification.

Suites exercised:

- packages/core/tests/spot.test.ts (6) and replay.test.ts (12).
- packages/storage/tests/spot.test.ts (7) and replay-execution.test.ts (10).
- packages/application/tests/spot.test.ts (10) and replay.test.ts (3).
- apps/web/tests/spot-routes.test.ts (3) and replay-routes.test.ts (4).

The new deterministic-rejection and connector-unavailable regressions were run before their fixes and failed on the actual affected paths. The final run passed all suites above. These are targeted tests, not a replacement for the main thread's pending repository checks.

Covered monetary invariants include one initial seed across restarts; venue/quote isolation; shared available quote across symbols; unavailable inventory rejected before reservation; independent sell reservations; idempotent cancellation and settlement; late successful/failed quotes fenced by cancellation; unknown reservation retention across restart; over-bound buy rejection; deterministic dust rejection releasing funds without consuming another order's reservation; reconcilable ledger/cost basis/PnL; and transaction rollback on injected persistence failure.

The Replay HTTP regression starts through POST /api/replay with a real persisted datasetId, verifies that only the revealed seed is returned, closes/reopens the database, then disables connector initialization and steps through POST /api/replay/[id]. It verifies the next frozen candle and zero historical OHLCV fetches. Storage regressions additionally reject a mismatched venue or seed before session publication, reject a modified next candle without advancing cursor/revision/fills, execute at the frozen bar's actual price, preserve the binding across restart, and refuse advancement past snapshot exhaustion. Existing route regressions cover revision conflicts, legacy read-only behavior and missing intervals.

## Protocol boundaries and research handoff

- Shared spot uses the explicit /api/spot open/read/order/cancel contract and a separate paper:shared-spot:v1:<venue>:<quote> namespace. Read does not seed; open does not import old wallets. maximumPrice bounds buy execution and determines quote reservation including fees; on sells it is a sizing/reference price, not a minimum sell price. Submitted/unknown reserves remain unavailable until a final fill/rejection or explicit cancellation.
- Existing legacy OrderPreview storage/API still binds to its original per-symbol paperAccountId. It must not be presented as a shared-wallet preview or silently redirected to the shared account. A future shared preview must persist its own account namespace, venue/native instrument, side/quantity/maximumPrice, fee policy and expiry; preview creation must not reserve, and confirmation must atomically claim the preview and reserve the corresponding shared-wallet intent before fetching a quote. Competing confirm/dismiss/expiry/retries need protocol regressions before such a preview is exposed. This worker did not add a shared preview API and does not claim preview parity.
- Research snapshots freeze canonical contiguous candle content and venue/symbol/timeframe. POST /api/replay accepts datasetId and endAt; creation checks seed equality and stores the datasetId in ReplayExecution. Every frozen step reloads and verifies that immutable snapshot, then storage checks the proposed candle against it. The public response reveals only session bars and the identifier, not future candles. Dataset exhaustion returns no next candle rather than falling back to online history.
- Frozen **playback after creation** is connector independent. Creating a session still resolves active native instrument metadata through the connector because the candle snapshot does not contain a frozen native-instrument record. A fully offline creation/import workflow needs an explicit versioned instrument-metadata binding, not a fabricated native ID.
- Snapshot bars do not reproduce the original Backtest orders: manual Replay has its own capital, fee/slippage configuration, pending orders, fills and journal. A future research-to-Replay UI handoff should pass the saved datasetId, venue/symbol/timeframe and chosen endAt explicitly, display the selected execution configuration/policy, and preserve historical outputs. Broader research UX and model iterations remain separate work.

## Main-thread validation still pending

No full-repository test/typecheck/lint/build/MCP success is asserted here. The main thread should record its actual exits after incorporating these final source changes. This worker ran no duplicate repository-wide verification and created no commit or push.
