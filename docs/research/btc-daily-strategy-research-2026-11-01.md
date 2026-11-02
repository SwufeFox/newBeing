# BTC/USDT daily strategy research, 2026-11-01

## Objective and method

Manually exercise the local MCP research workflow on Binance BTC/USDT daily candles from 2020-01-01 through 2026-10-31. Compare the registered long-only spot baselines against a nominal +100% cumulative-return target, report drawdown, and use walk-forward results to screen parameter sensitivity. This is historical research, not a forecast or trading instruction.

The experiment used the existing public market-data adapter and local MCP stdio server. No model provider key or live order path was used. The same immutable candle snapshot was reused for every run.

## Dataset and assumptions

- Exchange/instrument/timeframe: Binance, BTC/USDT, 1d.
- Bars: 2,496 contiguous completed UTC candles. First bar: 2020-01-01 00:00 UTC; last bar: 2026-10-31 00:00 UTC; range end exclusive: 2026-11-01 00:00 UTC.
- Dataset ID: `sha256:76022b560bd0773fb949ab3ef4f6908012597ecae8d1a095732c79076c46cf54`.
- Local records: `.newbeing/ai-research-2026-11-01/`.
- Initial capital: 10,000 USDT; account mode: spot; position fraction: 1.0; shorts disabled; fee rate: 0.10%; slippage rate: 0.05%.
- A 1d range fits the current 5,000-bar bound while covering the full 2020-to-current period. The final walk-forward test uses indices `[1996, 2496)` (500 bars), from 2025-06-19 through 2026-10-31.
- Walk-forward chooses the highest training `totalReturn`; ties choose the lower parameter value. Drawdown was measured and reported, but was not an automatic selection constraint.

## Full-sample baselines

These runs use the full sample for comparison and are in-sample results.

| Strategy and parameters | Result ID | Total return | Final equity | Max drawdown | Sharpe | Trades | Fees |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `sma-crossover`, fast 20 / slow 50, shorts off | `2716e907-cee2-4021-b27d-a73ffb8f0ce3` | +641.34% | 74,133.91 | 59.16% | 0.9131 | 28 | 2,602.45 |
| `rsi-mean-reversion`, period 14 / oversold 30 / exit 50 / overbought 70, shorts off | `f10e1f1b-b4c4-4294-a79d-98f2f2ae6e19` | +93.81% | 19,381.23 | 24.84% | 0.4914 | 15 | 506.38 |
| `momentum-reversal`, lookback 20 / threshold 2% / reversal off, shorts off | `dfd380a8-c842-46d6-ad6b-7a2cd4df2bd9` | +435.23% | 53,523.37 | 57.82% | 0.8274 | 129 | 10,809.74 |

SMA and momentum exceed the nominal target on this complete historical sample, with deep drawdowns. RSI comes close with lower full-sample drawdown. These full-sample returns do not establish future performance.

## Walk-forward iterations

The original sweeps used the same 2,496 daily bars and cost/account assumptions above. At the time of those runs, each pre-test selection was evaluated on the then-unseen final 20% by the walk-forward runner.

| Sweep | Candidate range | Final pre-test choice | Final-test result |
| --- | --- | --- | --- |
| SMA `fastPeriod`, slow period fixed at 50 | 5–45, step 5 | 5; final training return +1,891.72%, max drawdown 41.33% | −6.79%, max drawdown 14.79%, 3 trades |
| RSI `exitLong`, period 14 / oversold 30 fixed | 40–60, step 5 | 50 in each training fold and final selection | −14.90%, max drawdown 23.27%, 3 trades |
| RSI `oversold`, period 14 / exit 50 fixed | 20–45, step 5 | 25, 25, 30 across the three validation folds; final choice 30 | −14.90%, max drawdown 23.27%, 3 trades |

Sweep IDs: SMA `c49a76d8-e11c-4739-99c0-9172a2924d7d`; RSI exit `e6595fe9-49dd-4192-b040-b4c5fbd6c219`; RSI entry `e5bd89c9-433d-46d8-b159-fabdb6d4b74d`.

The SMA screen selected a very strong pre-test fit that lost on the final test. Both RSI screens selected the baseline settings; changing the entry threshold did not change the final-test losses. No tuned setting met the return target out of sample. The final test has now been inspected and must not be treated as untouched for further tuning on this same dataset.

### Risk-constrained follow-up

The next objective maximized training `totalReturn` subject to maximum training drawdown `<= 20%`. The single varied parameter was RSI `oversold` from 20 through 45 in steps of 5; period 14, exit 50, overbought 70, shorts off, Binance BTC/USDT 1d, 10,000 USDT initial capital, 100% position fraction, 0.10% fee and 0.05% slippage stayed fixed. All 2,496 bars came from the same immutable dataset. The final 20% had already been inspected during the earlier iterations, so its result below is a diagnostic, not an untouched validation.

| Walk-forward interval | Selected `oversold` | Training return | Training max drawdown | Validation return | Validation max drawdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50% train / next 10% validation | 25 | +92.14% | 17.63% | +3.79% | 2.42% |
| 60% train / next 10% validation | 25 | +99.43% | 17.63% | 0.00% | 0.00% |
| 70% train / next 10% validation | 25 | +99.43% | 17.63% | +11.56% | 0.42% |

| Evaluation | Total return | Max drawdown | Trades |
| --- | ---: | ---: | ---: |
| Final pre-test training interval `[0,1996)` | +122.48% | 17.63% | 8 |
| Previously inspected final test `[1996,2496)` | −7.34% | 21.51% | 3 |
| Full sample, in sample | +106.15% | 21.51% | 11 |

The constrained selection chose `oversold=25` and clears +100% only on the full historical sample; the previously inspected final interval lost 7.34%. Its 21.51% test drawdown exceeds the 20% training eligibility limit, as expected because the limit does not filter validation or test runs. The constrained sweep is `ccd728d7-22ea-4e8a-87ca-05876a2942aa`; its saved-ID rerun is `df315081-feaa-43d3-9af0-2476ef532acb`. The full-sample single-candidate sweep is `63bbeb6c-cabc-4fac-8cfb-914b189680b3`; its result `2a8f5982-f9de-4693-b1b3-b2b737ab39fe` reran as `a826185d-11f4-46f1-ad7d-370c9db7ac7f` with identical metrics. Because the final test had already been inspected, none of these numbers establish independent out-of-sample success.

### Sharpe selection follow-up (preregistered)

Before running these sweeps, the objective is fixed as the highest finite training Sharpe subject to maximum training drawdown `<= 18%`; ties choose the lower parameter value. Candidates with null or nonfinite training Sharpe are ineligible. Each sweep varies one parameter axis and uses `selection_metric: "sharpe_ratio"`, walk-forward mode, the dataset ID above, and the account/cost assumptions above. The final 20% was inspected in earlier work, so it is diagnostic only and will not guide candidate selection. No numerical Sharpe pass threshold was specified; the prior +100% cumulative-return target remains a secondary historical benchmark.

| Strategy | Varied parameter | Fixed parameters | Candidate range |
| --- | --- | --- | --- |
| `sma-crossover` | `slowPeriod` | `fastPeriod=20`, shorts off | 25–200, step 25 |
| `rsi-mean-reversion` | `oversold` | period 14, exit 50, overbought 70, exitShort 50, shorts off | 20–45, step 5 |
| `rsi-mean-reversion` | `period` | oversold 30, exit 50, overbought 70, exitShort 50, shorts off | 7–28, step 7 |
| `rsi-mean-reversion` | `exitLong` | period 14, oversold 30, overbought 70, exitShort 50, shorts off | 40–60, step 5 |
| `momentum-reversal` | `thresholdPct` | lookback 20, reversal off, shorts off | 0.5–5, step 0.5 |
| `momentum-reversal` | `lookback` | threshold 2%, reversal off, shorts off | 5–50, step 5 |
| `momentum-reversal` | `thresholdPct` | lookback 20, reversal on, shorts off | 0.5–5, step 0.5 |

### Training-driven second stage (preregistered before execution)

The first stage selected RSI period 28 in each expanding training fold and the final pre-test fit, at the upper edge of that grid. This training-only result motivates extending the period range and checking its interaction with the entry and exit thresholds. The same 18% training drawdown cap, finite-Sharpe ranking, dataset, and costs remain fixed; the final test is excluded from this decision.

| Strategy | Varied parameter | Fixed parameters | Candidate range |
| --- | --- | --- | --- |
| `rsi-mean-reversion` | `period` | oversold 30, exit 50, overbought 70, exitShort 50, shorts off | 35–56, step 7 |
| `rsi-mean-reversion` | `oversold` | period 28, exit 50, overbought 70, exitShort 50, shorts off | 20–45, step 5 |
| `rsi-mean-reversion` | `exitLong` | period 28, oversold 30, overbought 70, exitShort 50, shorts off | 40–60, step 5 |

### Sharpe sweep results

The seven first-stage grids yielded two eligible sweeps. The other five (`sma-crossover` slow period, RSI exit with period 14, and all three momentum grids) had no candidate with finite training Sharpe under the 18% cap, so the MCP operation saved no sweep for them.

| Walk-forward study | Selected parameter | Final training return | Final training max DD | Final training Sharpe | Final-test return / max DD / Sharpe |
| --- | ---: | ---: | ---: | ---: | ---: |
| RSI `oversold` 20–45, period 14 | 25 | +122.48% | 17.63% | 0.7308 | −7.34% / 21.51% / −0.1011 |
| RSI `period` 7–28, oversold 30 | 28 | +90.79% | 12.80% | 0.7979 | +28.98% / 11.61% / 1.0490 |

The period-28 pre-test fit has only two trades; its Sharpe is based on sparse trading activity. Each expanding fold also selected period 28, while its validation intervals made no trades. Because the final test was inspected before this work, its metrics above are diagnostic only.

The second-stage period extension 35–56 produced no eligible candidate. Varying `oversold` 20–45 at period 28 selected 30; varying `exitLong` 40–60 selected 50. Both reproduced the same final-training and final-test metrics as the period-28 baseline.

One-candidate full-sample runs for `rsi-mean-reversion` period 28 / oversold 30 / exit 50 and period 14 / oversold 25 both exceeded the nominal +100% return benchmark. Period 28 returned +146.09%, max drawdown 12.80%, Sharpe 0.8531, and 4 trades. Period 14 / oversold 25 returned +106.15%, max drawdown 21.51%, Sharpe 0.5590, and 11 trades. Full-sample figures include the previously inspected final interval and are in-sample diagnostics, not independent validation.

Walk-forward sweep IDs and saved-ID reruns: RSI `oversold` `af15e79a-2b51-48e8-9692-3d42731e636f` → `449006e4-a81c-466f-b9bb-451edc19c3d0`; RSI `period` `2b00b1af-868b-445b-9a66-7fb5b41bf486` → `494892cb-c8c2-425a-bda1-108fbaa10a0c`; period-28 `oversold` `aacd4f9c-d775-4431-b407-e2b3bf454dcc` → `4da99141-a5be-4274-93f1-6e4fdc97a4f8`; period-28 `exitLong` `75c83eb0-a0ad-4ab2-aa00-67631b9e8b57` → `de108f5a-a334-4732-82a6-b85f900bedd7`. Saved full-sample reruns matched return, drawdown, Sharpe, and trade count when compared fieldwise.

### Training-only refinement (preregistered before execution)

The best final-training Sharpe is 0.7979 with two trades, and RSI periods above 28 did not meet the cap. Refine the transition with `period` 21–34, step 1, at the existing RSI thresholds; refine `oversold` 20–35, step 1, and `exitLong` 45–55, step 1, while holding period 28 for those two sweeps. Keep the 18% cap, Sharpe ranking, dataset, and costs fixed. Do not use the final test to select or adjust these ranges.

The three fine-grid sweeps selected `period=25`, `oversold=31` at period 28, and `exitLong=53` at period 28. Their final-training Sharpes were 0.9088 (3 trades), 0.9030 (3 trades), and 0.8065 (2 trades), respectively. All three validation intervals in every sweep had zero trades, so the higher training Sharpes have no validation-trade support.

| Training-selected candidate | Final training return / max DD / Sharpe / trades | Diagnostic final-test return / max DD / Sharpe / trades | Full-sample return / max DD / Sharpe / trades |
| --- | --- | --- | --- |
| RSI period 25, oversold 30, exit 50 | +116.97% / 12.80% / 0.9088 / 3 | +13.86% / 16.02% / 0.5049 / 3 | +147.04% / 16.02% / 0.7897 / 6 |
| RSI period 28, oversold 31, exit 50 | +121.12% / 12.80% / 0.9030 / 3 | +28.98% / 11.61% / 1.0490 / 2 | +185.20% / 12.80% / 0.9338 / 5 |
| RSI period 28, oversold 30, exit 53 | +100.82% / 12.80% / 0.8065 / 2 | +33.53% / 11.85% / 1.0120 / 2 | +168.15% / 12.80% / 0.8513 / 4 |

The period grid selected 25 in all folds; the oversold grid selected 31 in all folds; the exit grid selected 53 in all folds. Saved-sweep reruns and full-sample reruns reproduced the recorded metrics. The best training Sharpe remains below 1 on three trades, and full-sample metrics include previously inspected data.

### Frequency-oriented follow-up (preregistered before execution)

Because every fine-grid validation interval had zero trades, test whether shorter RSI periods increase trading frequency outside the training intervals. Vary only `period` 2–20, step 1, with oversold 30, exit 50, overbought 70, exitShort 50, and shorts off. The strategy accepts periods from 2 upward. Keep walk-forward Sharpe ranking, the 18% training drawdown cap, dataset, and costs fixed; do not use the final test to select parameters.

The RSI period 2–20 sweep had no candidate with finite training Sharpe under the 18% drawdown cap, so no sweep was saved.

### Combined coordinate check (preregistered before execution)

The three fine-grid searches independently selected period 25, oversold 31, and exitLong 53, while the shorter-period grid had no eligible candidate. Test the training-derived threshold combination by varying only RSI `period` 21–34, step 1, with `oversold=31`, `exitLong=53`, `overbought=70`, `exitShort=50`, and shorts off. Keep the same dataset, costs, walk-forward Sharpe objective, and 18% training drawdown cap. This is another training-only selection; the final test remains diagnostic and excluded from decisions.

The combined-threshold sweep selected `period=27` in every training fold. Final training returned +135.41%, max drawdown 12.80%, Sharpe 0.9129, and 3 trades. Each validation interval again had zero trades. The diagnostic final test returned +25.79%, max drawdown 14.28%, Sharpe 0.7321, and 3 trades. The one-candidate full-sample run returned +196.11%, max drawdown 14.28%, Sharpe 0.8504, and 6 trades. Full-sample and final-test metrics are not independent evidence because those periods were previously inspected.

The combined-threshold result is the highest final-training Sharpe in these follow-ups, but it remains below 1 on three trades and has no validation trades. No validated high-Sharpe alpha was found on this BTC/USDT daily snapshot. Further fine tuning on the same sample would add selection bias without producing validation observations; continue only with a new market hypothesis or a broader independent dataset.

The later training-only sweeps and full-sample candidate checks were rerun from their saved IDs. Return, drawdown, Sharpe, trade count, and fees matched fieldwise:

| Follow-up | Walk-forward sweep → rerun | Full-sample sweep → rerun |
| --- | --- | --- |
| RSI period 21–34, default thresholds | `1ab5fd84-ff76-4610-aee7-1b417768ba2b` → `8a37759c-938c-4228-9ff1-b0372222505b` | `dd82afed-87f2-43d9-8e85-7bd7f900e406` → `aeb43a6d-1c60-4747-907f-a6e43c10b393` |
| RSI oversold 20–35 at period 28 | `9edb38b9-86c9-40b9-b8ca-c3f18ffb2bb6` → `cdb44f4e-be6b-459c-a6be-bab0bd35a19f` | `3bc0ac5f-3c7d-47f2-9974-2c28881d211f` → `90cf1cae-1de2-489c-a1c5-605662b8e623` |
| RSI exit 45–55 at period 28 | `ca13bc1d-c020-4540-bc55-5decde77caef` → `bc04f5a2-1c01-4fb1-b762-e9b298808b1c` | `8ea1ecff-bb55-4f58-a9bb-f2d48f8dbc61` → `326dd7d7-2c9f-4cac-a493-5686d9006334` |
| Combined oversold 31 / exit 53, period 21–34 | `1f8e31f9-6aaf-4427-9078-b87ca691aaf0` → `454780ae-7551-434a-b70c-6ea262276904` | `48bd0461-36f7-42fd-9bdd-2f27e94aaa1e` → `74358f94-8080-4345-8dcd-38452535287b` |

The RSI period 2–20 and 35–56 sweeps had no candidate satisfying the finite-training-Sharpe and 18% training-drawdown constraints, so neither produced a saved sweep ID.

## Reproducibility and workflow fix

The baseline results share the dataset ID above. The SMA walk-forward sweep was rerun as `f0e1867b-be92-42f1-a507-d7d188012abc`. The selected RSI baseline was run as `ffe7322c-b22f-4ee8-8a3a-fd9bf2332897` and rerun as `d7dd402c-c171-441b-b12d-1260fdcfdedf`; both returned identical metrics. The RSI entry sweep also produced a full-period result `0f690a7e-c032-4ef1-a14f-4df8f8a8b094` and rerun `969d886a-30b7-42ce-8d4a-97810cf6d08d`, with identical metrics.

The first 2,496-bar MCP run exposed a validation mismatch: market-data range retrieval allowed 5,000 bars, but snapshot identity rejected more than 1,000. `MAX_RESEARCH_BARS = 5_000` now lives in `packages/core/src/types.ts`; the market range helper and storage snapshot validator use that shared value. This aligns the persisted dataset limit with the already documented MCP range limit. Local run records remain in the dedicated data directory above.

A storage test invocation initially failed after its existing snapshot helper import was displaced while adding the boundary case. The import was restored; the complete storage package test command then passed.

The next public Binance request timed out while fetching exchange metadata. `run_research_sweep` now accepts `dataset_id` to reuse a verified immutable snapshot offline; the application checks exchange/symbol/timeframe identity and rejects mixing a saved dataset with a limit or explicit date range. The constrained run succeeded through the MCP stdio server using the saved dataset, and provenance identifies it as a saved immutable snapshot.

## Verification

- `pnpm build:packages` — passed after the saved-dataset and drawdown-constraint changes.
- `pnpm --filter @newbeing/core test` — 6 files, 40 tests passed.
- `pnpm --filter @newbeing/market-data test` — 5 files passed, 1 skipped; 69 passed, 2 skipped.
- `pnpm --filter @newbeing/storage test` — 8 files, 55 tests passed, including the 5,000-candle identity and persistence boundaries.
- `pnpm --filter @newbeing/application test` — passed with saved-snapshot reuse, drawdown filtering, and rerun persistence coverage.
- `pnpm --filter @newbeing/mcp typecheck` — passed.
- `pnpm mcp:smoke` — passed with the official stdio client, 19 tools, and an isolated database.
- Actual MCP Sharpe sweeps from the saved dataset, saved sweep reruns, fixed-candidate full-sample runs, and full-sample reruns — completed; compared metrics matched fieldwise.
