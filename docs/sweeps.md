# Backtest sweeps

`POST /api/sweeps` tests one numeric parameter range against a single fetched candle dataset. The default `full-sample` mode preserves the existing behavior: every value is backtested on the complete sample. It is an in-sample comparison and does not estimate out-of-sample performance. This is separate from the `single-holdout` flow in `POST /api/evaluations`.

## Walk-forward mode

Walk-forward uses a contiguous series of `N` candles and the exact index boundaries:

- `b50 = floor(0.50 × N)`, `b60 = floor(0.60 × N)`, `b70 = floor(0.70 × N)`, `b80 = floor(0.80 × N)`.
- Validation folds train on `[0,b50)`, `[0,b60)`, and `[0,b70)`, then validate on `[b50,b60)`, `[b60,b70)`, and `[b70,b80)` respectively.
- Final selection trains again on `[0,b80)`; the selected value is evaluated once on the final test `[b80,N)`.

Every training, validation and final-test interval must contain at least two candles. Walk-forward rejects gapped candle sequences and does not silently shrink a window. Each backtest cold-starts with the same configured capital and execution costs; no position, pending signal or equity carries across segments. Reports include both half-open bar-index boundaries and the first/last candle timestamps for every interval.

Each fold chooses the value with the highest training `totalReturn`; ties resolve to the lowest value in the ascending sweep range. The final candidate is selected using the same rule on the full pre-test interval `[0,b80)`. Thus the final 20% is not used to choose parameters. After a researcher inspects that final test and changes the strategy in response, it no longer serves as an untouched test for that strategy.

The fold metrics describe the specified historical intervals. They are not statistically independent observations, a significance test, a continuous multi-fold account, or a guarantee of future results. Do not combine fold returns or drawdowns into a synthetic continuous equity curve.

## Saved results and reruns

The parent dataset identifies the complete fetched sample. Every walk-forward result also records its half-open bar-index segment, segment dataset ID and reproduction reference. Each segment is stored as an immutable snapshot. The saved sweep contains compact metrics and result IDs for every candidate training run, validation run, final training candidate and final test; complete equity curves, trades and signals remain with each individual backtest result.

`POST /api/sweeps/{sweepId}/rerun` reruns all saved runs from their exact snapshots without network access or input overrides, verifies the outcomes and saves a new sweep linked to the original. The list, detail, create and rerun responses expose the compact report rather than per-bar arrays.

## Performance benchmark

Run `pnpm bench` for the deterministic synthetic workload at 1k, 10k and 100k bars. The benchmark excludes candle generation from the timed section, performs two warmups and five measured repetitions by default, and prints median and min/max elapsed time for both full backtests and signal generation, plus the median backtest heap delta. Override `BENCH_SIZES`, `BENCH_WARMUPS`, `BENCH_REPEATS` or `BENCH_POSITION_FRACTION` when measuring a different workload. The default synthetic position fraction is 0.1 so the 100k case stays within the ledger's numeric representation. These results characterize the core engine on synthetic candles; they do not represent browser rendering or production request latency.
