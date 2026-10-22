import { ENGINE_VERSION, runBacktest, type BacktestConfig, type BacktestResult, type BacktestSweepResult, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { fetchLatestCompletedCandles, getExchangeAdapter, type ExchangeAdapter } from "@newbeing/market-data";
import { canonicalJson, getExperiment, getSavedSweep, getWorkspaceState, identifyDataset, saveDatasetSnapshot, saveResearchResults, validateResearchSweep } from "@newbeing/storage";
import { randomUUID } from "node:crypto";
import { assertResearchAvailable, assertSameOutcome, originalResearchInput, outcomeIdentity, reproductionFor, ResearchError, resolveResearchStrategy } from "./research-inputs.js";
import { sweepCartesian } from "./sweep-values.js";
export { SWEEP_MAX_RUNS, sweepValues, sweepCartesian } from "./sweep-values.js";

export interface SweepRequest {
  exchange?: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  parameters: StrategyParameters;
  config: BacktestConfig;
  parameter: string;
  from: number;
  to: number;
  step: number;
  limit?: number;
}
export type SweepResult = BacktestSweepResult;
export type SweepRun = BacktestSweepResult["runs"][number];

/** One fetch, one snapshot, bounded enumeration, atomic publication of all runs. */
export async function runBacktestSweep(request: SweepRequest, dependencies: { now?: () => number; marketAdapter?: ExchangeAdapter } = {}): Promise<SweepResult> {
  assertResearchAvailable();
  const { strategy, parameters } = resolveResearchStrategy(request.strategyId, request.parameters);
  if (!Object.hasOwn(strategy.defaults, request.parameter) || typeof strategy.defaults[request.parameter] !== "number") throw new Error(`${request.strategyId} has no numeric parameter named "${request.parameter}".`);
  const values = sweepCartesian([{ parameter: request.parameter, from: request.from, to: request.to, step: request.step }]).map((row) => row[request.parameter] as number);
  const exchange = request.exchange ?? getWorkspaceState().state.exchange;
  const adapter = dependencies.marketAdapter ?? getExchangeAdapter(exchange);
  const candles = await fetchLatestCompletedCandles(adapter, request.symbol, request.timeframe, request.limit ?? 600, dependencies.now?.() ?? Date.now());
  assertResearchAvailable();
  const input = { exchange, symbol: request.symbol, timeframe: request.timeframe, candles };
  const datasetId = identifyDataset(input).datasetId;
  // Complete all computations before publishing any result metadata.
  const results = values.map((value) => runBacktest({ ...input, datasetId, strategy, parameters: { ...parameters, [request.parameter]: value }, config: request.config, resultId: randomUUID() }));
  saveDatasetSnapshot(input);
  const reproduction = reproductionFor(datasetId);
  for (const result of results) result.reproduction = { ...reproduction };
  const sweep: SweepResult = {
    sweepId: randomUUID(), exchange, symbol: request.symbol, timeframe: request.timeframe,
    strategyId: strategy.id, strategyVersion: strategy.version, engineVersion: ENGINE_VERSION,
    outcomeVersion: 2, parameter: request.parameter, values, runs: results.map((result, index) => ({ value: values[index]!, resultId: result.resultId, outcomeId: outcomeIdentity(result), metrics: result.metrics })),
    parameters, config: { ...request.config }, datasetId, bars: candles.length,
    createdAt: new Date().toISOString(), reproduction,
  };
  saveResearchResults(results, sweep);
  return sweep;
}

/** Never fetches candles, consults cache, or replaces a saved strategy version. */
export function rerunBacktestSweep(id: string): SweepResult {
  assertResearchAvailable();
  const saved = getSavedSweep(id);
  if (!saved) throw new ResearchError("Sweep result not found.", 404);
  const { strategy, snapshot, reproduction } = originalResearchInput(saved);
  const originals = saved.runs.map((run) => {
    const original = getExperiment(run.resultId);
    if (!original) throw new ResearchError("Saved sweep bindings mismatch.", 422);
    return original;
  });
  try { validateResearchSweep(originals, saved, true); }
  catch { throw new ResearchError("Saved sweep bindings mismatch.", 422); }
  if (!Object.hasOwn(strategy.defaults, saved.parameter) || typeof strategy.defaults[saved.parameter] !== "number") throw new ResearchError("Saved sweep parameter is incompatible.", 409);
  if (saved.values.length < 1 || saved.values.length > 40 || saved.values.some((value) => !Number.isFinite(value))) throw new ResearchError("Saved sweep values are invalid.", 422);
  if (saved.runs.length !== saved.values.length || saved.bars !== snapshot.candles.length) throw new ResearchError("Saved sweep bindings mismatch.", 422);
  const results: BacktestResult[] = saved.values.map((value, index) => {
    const result = runBacktest({ candles: snapshot.candles, exchange: snapshot.exchange, symbol: snapshot.symbol, timeframe: snapshot.timeframe, datasetId: saved.datasetId, strategy, parameters: { ...saved.parameters, [saved.parameter]: value }, config: saved.config, resultId: randomUUID() });
    const run = saved.runs[index]!;
    const original = getExperiment(run.resultId);
    if (!original || run.value !== value || canonicalJson(run.metrics) !== canonicalJson(original.metrics)) throw new ResearchError("Saved sweep bindings mismatch.", 422);
    if (saved.outcomeVersion === 2 && run.outcomeId !== outcomeIdentity(original)) throw new ResearchError("Saved sweep outcome mismatch.", 422);
    assertSameOutcome(original, result);
    result.reproduction = { ...reproduction };
    result.rerunOf = original.resultId;
    return result;
  });
  const sweep: SweepResult = { ...saved, outcomeVersion: 2, sweepId: randomUUID(), createdAt: new Date().toISOString(), reproduction, rerunOf: id, runs: results.map((result, index) => ({ value: saved.values[index]!, resultId: result.resultId, outcomeId: outcomeIdentity(result), metrics: result.metrics })) };
  saveResearchResults(results, sweep);
  return sweep;
}
