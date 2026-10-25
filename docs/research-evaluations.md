# Single-holdout research evaluations

`POST /api/evaluations` evaluates a previously saved immutable dataset snapshot. The request accepts only `datasetId`, `strategyId`, `candidates`, `config`, and `splitIndex`. It does not accept candles, instrument overrides, strategy definitions, or executable source. `strategyId` must name a registered built-in.

```json
{
  "datasetId": "sha256:<64 lowercase hex characters>",
  "strategyId": "momentum-reversal",
  "candidates": [
    { "lookback": 2, "thresholdPct": 1 },
    { "lookback": 2, "thresholdPct": 50 }
  ],
  "config": {
    "accountMode": "spot",
    "initialCapital": 1000,
    "positionFraction": 0.8,
    "feeRate": 0.001,
    "slippageRate": 0.002,
    "allowShorts": false
  },
  "splitIndex": 12
}
```

There must be 1–40 distinct candidates after resolving defaults, and at least two bars in each partition. Config uses the backtest engine's money precision and validation rules; only spot with shorts disabled is supported. Training selects the highest net `totalReturn`, with canonical parameter JSON ordering to break exact ties. Only the selected parameters run on holdout. This is `single-holdout`, with `cold-start/no-carry-positions`: each partition starts with fresh cash, indicators, and no positions or pending signals. It is not walk-forward validation.

The 201 response contains the full training results, selected candidate index and resolved parameters, holdout result, exact half-open boundaries, initialization and evaluation labels, `trainingDatasetId`, `holdoutDatasetId`, and `resultIds: { training: string[], holdout: string }`. Responses use `Cache-Control: no-store`. Malformed requests return 400; missing snapshot files return 404; incompatible input, invalid splits/parameters/config or corrupt snapshots return 422; Replay access returns 409.

The report's `datasetId` is the full parent snapshot used as input. Every saved training result instead names the canonical hash of the training candles; the holdout result names the canonical hash of the holdout candles. Each segment has its own persisted snapshot and matching `reproduction.snapshotId`. These identities include the original venue, symbol and timeframe as well as the actual segment candles. The pure `runTrainHoldout` entry remains free of storage IO; its caller-provided dataset labels are provisional. Use the exported `runResearchEvaluation` application wrapper for persisted, reproducible results.

The wrapper loads and verifies the parent, runs the pure evaluation, publishes the two immutable segment snapshots, binds the resulting identities and reproduction metadata, and commits all full results through a single `saveResearchResults` transaction. Replay is checked at entry, before publication, and by the storage transaction. A failed result transaction leaves no partial set of evaluation results. Immutable snapshots may remain after a publication failure and can be reused by a retry; snapshot files and SQLite results do not form a single cross-store transaction.

The saved evaluation index, report ID, recent-list endpoint, and detail endpoint preserve the report-level candidate ordering, selection, and parent/split association. Each full result remains in the existing experiment store and can be retrieved by `GET /api/backtests/{resultId}` and rerun without overrides by `POST /api/backtests/{resultId}/rerun`. Such reruns use only the exact segment snapshot, subject to the existing engine/strategy implementation compatibility checks, and do not require the parent snapshot, network or candle cache. This reproduces individual runs; it does not reselect candidates as a new evaluation.

## Saved report history

Successful `POST /api/evaluations` runs now save an independently addressable report and the exact original request text. The aggregate report stores candidate ordering, selection, boundaries, metrics, segment snapshot IDs, and references to the saved result IDs; it deliberately omits equity curves and trades because those remain in the individual backtest result rows. The report row and all individual results are committed in one SQLite transaction, so a failed insert cannot leave a partial evaluation.

`GET /api/evaluations?limit=20` returns recent compact reports (limit is bounded to 1–100). `GET /api/evaluations/{reportId}` returns one report with its exact original request string. Both endpoints return `Cache-Control: no-store` and use the existing Replay research read guard; access while Replay is active is denied. Historical reports can be reopened from the Evaluate panel and are clearly labeled as historical. A successful new run is added to the recent list.


The research dock has an **Evaluate** tab (`apps/web/src/components/evaluation-panel.tsx`) beside Sweep. It prefills the dataset id from the currently loaded backtest result, takes a holdout start index and a from/to/step range over one numeric strategy parameter, and refuses to submit when the dataset id is not canonical, the split is below two bars, the candidate range exceeds 40, or the workspace backtest config is not spot/no-shorts. The panel labels the run as `single-holdout` + cold start and shows the training table, the selected candidate, both half-open boundaries, the holdout metrics, and the saved ids.

A legacy result has no canonical snapshot, so its dataset field stays empty and must be supplied manually — the panel never substitutes a re-fetch for a missing snapshot. The candidate construction lives in `apps/web/src/lib/evaluation-candidates.ts` so it is unit-tested independently of React; it fails closed on an oversized range rather than emitting a truncated one.

## Handoff from a backtest into frozen Replay

`apps/web/src/lib/backtest-replay.ts` builds the Replay seed request for a result: it requires a canonical `datasetId` and at least 100 continuous bars, reveals at most half of them (capped at 200) so practice bars stay ahead of the user, and carries the result's own `initialCapital`/`feeRate`/`slippageRate`. A legacy result or a discontinuous window is rejected with a message instead of silently re-fetching history. Both Replay start paths hold a `captureWorkspaceSelection()` fence, so a session that finishes after the user navigated elsewhere is still saved (its id is set) but does not yank the view back to Replay.

Targeted verification (no repository build):

- Application: `vitest run tests/train-holdout.test.ts tests/evaluations.test.ts`.
- Web: `vitest run tests/evaluation-routes.test.ts`, plus `tests/evaluation-candidates.test.ts` and `tests/backtest-replay.test.ts` for the UI-layer helpers.

Integration coverage uses real SQLite and immutable snapshot files, verifies segment hashes and exact offline outcomes after reopening the database, deletes the parent snapshot before reruns, checks holdout-only changes cannot alter training identity/selection, injects a final-insert failure to verify all-result rollback, and covers HTTP contracts including candidate limits and Replay denial.
