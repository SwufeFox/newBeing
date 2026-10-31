import { ENGINE_VERSION, runBacktest, type BacktestConfig, type BacktestResult, type BacktestSweepResult, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { fetchLatestCompletedCandles, findCandleGaps, getExchangeAdapter, type ExchangeAdapter } from "@newbeing/market-data";
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
  mode?: "full-sample" | "walk-forward";
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
  if (request.mode === "walk-forward") {
    const gaps = findCandleGaps(candles, request.timeframe);
    if (gaps.length > 0) throw new Error(`Walk-forward requires contiguous candles; found ${gaps.length} missing interval(s).`);
  }
  const input = { exchange, symbol: request.symbol, timeframe: request.timeframe, candles };
  const datasetId = identifyDataset(input).datasetId;
  const n = candles.length;
  const boundaries = { train50: Math.floor(0.5 * n), train60: Math.floor(0.6 * n), train70: Math.floor(0.7 * n), train80: Math.floor(0.8 * n), total: n };
  if (request.mode === "walk-forward" && (boundaries.train50 < 2 || boundaries.train60 - boundaries.train50 < 2 || boundaries.train70 - boundaries.train60 < 2 || boundaries.train80 - boundaries.train70 < 2 || n - boundaries.train80 < 2)) {
    throw new Error("Walk-forward requires at least two candles in every training, validation and final-test segment.");
  }
  saveDatasetSnapshot(input);
  const reproduction = reproductionFor(datasetId);
  const storedResults: BacktestResult[] = [];
  const segments: Array<{ start: number; end: number }> = [];
  const execute = (start: number, end: number, value: number): BacktestResult => {
    if (end - start < 2) throw new Error("Every sweep segment requires at least two usable candles.");
    const segmentCandles = candles.slice(start, end);
    const segmentInput = { exchange, symbol: request.symbol, timeframe: request.timeframe, candles: segmentCandles };
    const segmentDatasetId = request.mode === "walk-forward" ? saveDatasetSnapshot(segmentInput) : datasetId;
    const run = runBacktest({ ...input, candles: segmentCandles, datasetId: segmentDatasetId, strategy, parameters: { ...parameters, [request.parameter]: value }, config: request.config, resultId: randomUUID() });
    storedResults.push(run);
    segments.push({ start, end });
    return run;
  };
  let walkForward: BacktestSweepResult["walkForward"];
  if (request.mode === "walk-forward") {
    const select = (end: number) => {
      let best: { value: number; result: BacktestResult } | undefined;
      for (const value of values) {
        const candidate = execute(0, end, value);
        if (!best || candidate.metrics.totalReturn > best.result.metrics.totalReturn) best = { value, result: candidate };
      }
      return best!;
    };
    const folds = [];
    for (const [trainEnd, validationEnd] of [[boundaries.train50, boundaries.train60], [boundaries.train60, boundaries.train70], [boundaries.train70, boundaries.train80]] as const) {
      const chosen = select(trainEnd);
      const validation = execute(trainEnd, validationEnd, chosen.value);
      folds.push({
        trainEnd,
        validationStart: trainEnd,
        validationEnd,
        trainStartTimestamp: candles[0]!.timestamp,
        trainEndTimestamp: candles[trainEnd - 1]!.timestamp,
        validationStartTimestamp: candles[trainEnd]!.timestamp,
        validationEndTimestamp: candles[validationEnd - 1]!.timestamp,
        candidateValue: chosen.value,
        trainingResultId: chosen.result.resultId,
        validationResultId: validation.resultId,
        trainingMetrics: chosen.result.metrics,
        validationMetrics: validation.metrics,
      });
    }
    const finalChoice = select(boundaries.train80);
    const finalTest = execute(boundaries.train80, boundaries.total, finalChoice.value);
    walkForward = {
      mode: "walk-forward",
      boundaries,
      selectionRule: "training-totalReturn-desc/parameter-value-asc",
      finalTrainingStartTimestamp: candles[0]!.timestamp,
      finalTrainingEndTimestamp: candles[boundaries.train80 - 1]!.timestamp,
      finalTestStartTimestamp: candles[boundaries.train80]!.timestamp,
      finalTestEndTimestamp: candles[boundaries.total - 1]!.timestamp,
      folds,
      finalCandidateValue: finalChoice.value,
      finalTrainingResultId: finalChoice.result.resultId,
      finalTestResultId: finalTest.resultId,
      finalTrainingMetrics: finalChoice.result.metrics,
      finalTestMetrics: finalTest.metrics,
    };
  } else {
    for (const value of values) execute(0, candles.length, value);
  }

  for (let index = 0; index < storedResults.length; index++) {
    const result = storedResults[index]!;
    const segmentDatasetId = result.datasetId;
    const segmentReproduction = segmentDatasetId === datasetId ? reproduction : reproductionFor(segmentDatasetId);
    result.reproduction = { ...segmentReproduction };
  }
  const sweep: SweepResult = {
    sweepId: randomUUID(), mode: request.mode ?? "full-sample", exchange, symbol: request.symbol, timeframe: request.timeframe,
    strategyId: strategy.id, strategyVersion: strategy.version, engineVersion: ENGINE_VERSION,
    outcomeVersion: 2, parameter: request.parameter, values, runs: storedResults.map((result, index) => ({ value: result.parameters[request.parameter] as number, resultId: result.resultId, outcomeId: outcomeIdentity(result), metrics: result.metrics, ...(request.mode === "walk-forward" ? { segment: { ...segments[index]!, datasetId: result.datasetId, reproduction: result.reproduction! } } : {}) })),
    parameters, config: { ...request.config }, datasetId, bars: candles.length,
    createdAt: new Date().toISOString(), reproduction,
    ...(walkForward ? { walkForward } : {}),
  };
  saveResearchResults(storedResults, sweep);
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
  if (saved.walkForward) {
    const wf = saved.walkForward;
    const segments = new Map<string, { start: number; end: number }>();
    for (const fold of wf.folds) {
      segments.set(fold.trainingResultId, { start: 0, end: fold.trainEnd });
      segments.set(fold.validationResultId, { start: fold.validationStart, end: fold.validationEnd });
    }
    segments.set(wf.finalTrainingResultId, { start: 0, end: wf.boundaries.train80 });
    segments.set(wf.finalTestResultId, { start: wf.boundaries.train80, end: wf.boundaries.total });
    const legacySegments = new Map<string, { start: number; end: number }>();
    if (saved.runs.some((run) => !run.segment)) {
      let offset = 0;
      for (const [trainEnd, validationEnd] of [[wf.boundaries.train50, wf.boundaries.train60], [wf.boundaries.train60, wf.boundaries.train70], [wf.boundaries.train70, wf.boundaries.train80]] as const) {
        for (let candidate = 0; candidate < saved.values.length; candidate++) legacySegments.set(saved.runs[offset + candidate]!.resultId, { start: 0, end: trainEnd });
        offset += saved.values.length;
        legacySegments.set(saved.runs[offset++]!.resultId, { start: trainEnd, end: validationEnd });
      }
      for (let candidate = 0; candidate < saved.values.length; candidate++) legacySegments.set(saved.runs[offset + candidate]!.resultId, { start: 0, end: wf.boundaries.train80 });
      offset += saved.values.length;
      legacySegments.set(saved.runs[offset]!.resultId, { start: wf.boundaries.train80, end: wf.boundaries.total });
      for (const [resultId, segment] of legacySegments) if (!segments.has(resultId)) segments.set(resultId, segment);
    }
    if (saved.runs.length < segments.size || saved.bars !== snapshot.candles.length || wf.boundaries.total !== snapshot.candles.length || saved.runs.some((run) => !run.segment && !segments.has(run.resultId))) throw new ResearchError("Saved walk-forward bindings mismatch.", 422);
    const idMap = new Map<string, BacktestResult>();
    const results = saved.runs.map((run) => {
      const original = getExperiment(run.resultId);
      const segment = run.segment ?? segments.get(run.resultId);
      if (!original || !segment || run.value !== original.parameters[saved.parameter] || canonicalJson(run.metrics) !== canonicalJson(original.metrics)) throw new ResearchError("Saved walk-forward bindings mismatch.", 422);
      if (saved.outcomeVersion === 2 && run.outcomeId !== outcomeIdentity(original)) throw new ResearchError("Saved walk-forward outcome mismatch.", 422);
      const segmentSnapshot = run.segment ? originalResearchInput({ ...saved, datasetId: run.segment.datasetId, reproduction: run.segment.reproduction }).snapshot : snapshot;
      const result = runBacktest({ candles: segmentSnapshot.candles, exchange: segmentSnapshot.exchange, symbol: segmentSnapshot.symbol, timeframe: segmentSnapshot.timeframe, datasetId: run.segment?.datasetId ?? saved.datasetId, strategy, parameters: { ...saved.parameters, [saved.parameter]: run.value }, config: saved.config, resultId: randomUUID() });
      assertSameOutcome(original, result);
      result.reproduction = { ...(run.segment?.reproduction ?? reproduction) };
      result.rerunOf = original.resultId;
      idMap.set(run.resultId, result);
      return result;
    });
    const mapped = (oldId: string) => idMap.get(oldId)!;
    const report = {
      ...wf,
      folds: wf.folds.map((fold) => ({ ...fold, trainingResultId: mapped(fold.trainingResultId).resultId, validationResultId: mapped(fold.validationResultId).resultId })),
      finalTrainingResultId: mapped(wf.finalTrainingResultId).resultId,
      finalTestResultId: mapped(wf.finalTestResultId).resultId,
    };
    const sweep: SweepResult = { ...saved, walkForward: report, outcomeVersion: 2, sweepId: randomUUID(), createdAt: new Date().toISOString(), reproduction, rerunOf: id, runs: results.map((result, index) => ({ value: result.parameters[saved.parameter] as number, resultId: result.resultId, outcomeId: outcomeIdentity(result), metrics: result.metrics, segment: { start: saved.runs[index]!.segment?.start ?? segments.get(saved.runs[index]!.resultId)!.start, end: saved.runs[index]!.segment?.end ?? segments.get(saved.runs[index]!.resultId)!.end, datasetId: result.datasetId, reproduction: result.reproduction! } })) };
    saveResearchResults(results, sweep);
    return sweep;
  }
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
