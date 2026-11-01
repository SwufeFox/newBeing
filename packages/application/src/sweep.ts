import { randomUUID } from "node:crypto";
import { ENGINE_VERSION, runBacktest, type BacktestConfig, type BacktestResult, type BacktestSweepResult, type Candle, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { fetchCompletedCandlesRange, fetchLatestCompletedCandles, findCandleGaps, getExchangeAdapter, type ExchangeAdapter } from "@newbeing/market-data";
import { canonicalJson, getExperiment, getSavedSweep, getWorkspaceState, identifyDataset, loadDatasetSnapshot, researchSweepRunSegments, saveDatasetSnapshot, saveResearchResults, validateResearchSweep } from "@newbeing/storage";
import { assertResearchAvailable, assertSameOutcome, originalResearchInput, outcomeIdentity, reproductionFor, ResearchError, resolveResearchStrategy, type OriginalResearchInput } from "./research-inputs.js";
import { sweepCartesian } from "./sweep-values.js";
export { SWEEP_MAX_RUNS, sweepValues, sweepCartesian } from "./sweep-values.js";

export interface SweepRequest {
  exchange?: ExchangeId;
  datasetId?: string;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  parameters: StrategyParameters;
  config: BacktestConfig;
  parameter: string;
  from: number;
  to: number;
  step: number;
  startAt?: number;
  endAt?: number;
  limit?: number;
  maxTrainingDrawdown?: number;
  selectionMetric?: "totalReturn" | "sharpeRatio";
  mode?: "full-sample" | "walk-forward";
}
export type SweepResult = BacktestSweepResult;
export type SweepRun = BacktestSweepResult["runs"][number];

/** One verified snapshot, bounded enumeration, atomic publication of all runs. */
export async function runBacktestSweep(request: SweepRequest, dependencies: { now?: () => number; marketAdapter?: ExchangeAdapter } = {}): Promise<SweepResult> {
  assertResearchAvailable();
  if (request.endAt !== undefined && request.startAt === undefined) throw new Error("endAt requires startAt.");
  if (request.datasetId !== undefined && (request.limit !== undefined || request.startAt !== undefined || request.endAt !== undefined)) throw new Error("datasetId cannot be combined with limit or an explicit historical range.");
  if (request.startAt !== undefined && request.limit !== undefined) throw new Error("limit cannot be combined with an explicit historical range.");
  if (request.maxTrainingDrawdown !== undefined && (!Number.isFinite(request.maxTrainingDrawdown) || request.maxTrainingDrawdown < 0 || request.maxTrainingDrawdown > 1)) throw new Error("maxTrainingDrawdown must be between 0 and 1.");
  if (request.maxTrainingDrawdown !== undefined && request.mode !== "walk-forward") throw new Error("maxTrainingDrawdown is available only in walk-forward mode.");
  if (request.selectionMetric !== undefined && request.selectionMetric !== "totalReturn" && request.selectionMetric !== "sharpeRatio") throw new Error("selectionMetric must be totalReturn or sharpeRatio.");
  if (request.selectionMetric === "sharpeRatio" && request.mode !== "walk-forward") throw new Error("selectionMetric=sharpeRatio is available only in walk-forward mode.");
  const { strategy, parameters } = resolveResearchStrategy(request.strategyId, request.parameters);
  if (!Object.hasOwn(strategy.defaults, request.parameter) || typeof strategy.defaults[request.parameter] !== "number") throw new Error(`${request.strategyId} has no numeric parameter named "${request.parameter}".`);
  const values = sweepCartesian([{ parameter: request.parameter, from: request.from, to: request.to, step: request.step }]).map((row) => row[request.parameter] as number);
  const savedDataset = request.datasetId === undefined ? undefined : loadDatasetSnapshot(request.datasetId);
  if (savedDataset && (savedDataset.symbol !== request.symbol || savedDataset.timeframe !== request.timeframe || (request.exchange !== undefined && savedDataset.exchange !== request.exchange))) throw new Error("Saved dataset does not match the requested exchange, symbol and timeframe.");
  const exchange = savedDataset?.exchange ?? request.exchange ?? getWorkspaceState().state.exchange;
  let candles: readonly Candle[];
  if (savedDataset) {
    candles = savedDataset.candles;
  } else {
    const adapter = dependencies.marketAdapter ?? getExchangeAdapter(exchange);
    const now = dependencies.now?.() ?? Date.now();
    candles = request.startAt === undefined
      ? await fetchLatestCompletedCandles(adapter, request.symbol, request.timeframe, request.limit ?? 600, now)
      : await fetchCompletedCandlesRange(adapter, request.symbol, request.timeframe, request.startAt, request.endAt, now);
  }
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
  const segmentDatasetIds = new Map<string, string>();
  const execute = (start: number, end: number, value: number): BacktestResult => {
    if (end - start < 2) throw new Error("Every sweep segment requires at least two usable candles.");
    const segmentCandles = candles.slice(start, end);
    const segmentInput = { exchange, symbol: request.symbol, timeframe: request.timeframe, candles: segmentCandles };
    let segmentDatasetId = datasetId;
    if (request.mode === "walk-forward") {
      const key = `${start}:${end}`;
      const existing = segmentDatasetIds.get(key);
      if (existing) segmentDatasetId = existing;
      else {
        segmentDatasetId = saveDatasetSnapshot(segmentInput);
        segmentDatasetIds.set(key, segmentDatasetId);
      }
    }
    const run = runBacktest({ ...input, candles: segmentCandles, datasetId: segmentDatasetId, strategy, parameters: { ...parameters, [request.parameter]: value }, config: request.config, resultId: randomUUID() });
    storedResults.push(run);
    segments.push({ start, end });
    return run;
  };
  const selectionMetric = request.selectionMetric ?? "totalReturn";
  let walkForward: BacktestSweepResult["walkForward"];
  if (request.mode === "walk-forward") {
    const select = (end: number) => {
      let best: { value: number; result: BacktestResult; score: number } | undefined;
      let finiteMetricCandidates = 0;
      let drawdownEligibleCandidates = 0;
      for (const value of values) {
        const candidate = execute(0, end, value);
        const score = selectionMetric === "sharpeRatio" ? candidate.metrics.sharpeRatio : candidate.metrics.totalReturn;
        if (score === null || !Number.isFinite(score)) continue;
        finiteMetricCandidates += 1;
        if (request.maxTrainingDrawdown !== undefined && candidate.metrics.maxDrawdown > request.maxTrainingDrawdown) continue;
        drawdownEligibleCandidates += 1;
        if (!best || score > best.score || (score === best.score && value < best.value)) best = { value, result: candidate, score };
      }
      if (!best) {
        if (selectionMetric === "sharpeRatio" && finiteMetricCandidates === 0) {
          throw new ResearchError("No sweep candidate has a finite training Sharpe ratio.", 422, {
            code: "SWEEP_NO_FINITE_TRAINING_SHARPE",
            nextAction: "Choose total_return, use a training range with variable returns, or sweep values that produce training trades; do not treat null Sharpe as zero.",
          });
        }
        if (request.maxTrainingDrawdown !== undefined && drawdownEligibleCandidates === 0) {
          throw new ResearchError(`No sweep candidate meets maxTrainingDrawdown <= ${request.maxTrainingDrawdown}.`, 422, {
            code: "SWEEP_TRAINING_DRAWDOWN_EXCLUDES_ALL",
            nextAction: "Raise max_training_drawdown within [0,1] or remove the cap, then rerun; the limit applies only to training candidate selection.",
          });
        }
        throw new ResearchError("No sweep candidate has a finite eligible training selection metric.", 422, {
          code: "SWEEP_NO_ELIGIBLE_TRAINING_CANDIDATE",
          nextAction: "Check the training metric and candidate range; use total_return if finite training Sharpe is unavailable.",
        });
      }
      return best;
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
      selectionMetric,
      selectionRule: selectionMetric === "sharpeRatio" ? "training-sharpeRatio-desc/parameter-value-asc" : "training-totalReturn-desc/parameter-value-asc",
      ...(request.maxTrainingDrawdown === undefined ? {} : { selectionConstraints: { maxTrainingDrawdown: request.maxTrainingDrawdown } }),
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
    const segmentReproduction = segmentDatasetId === datasetId ? reproduction : { ...reproduction, snapshotId: segmentDatasetId };
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
    const segments = researchSweepRunSegments(saved);
    if (saved.runs.length < segments.size || saved.bars !== snapshot.candles.length || wf.boundaries.total !== snapshot.candles.length || saved.runs.some((run) => !segments.has(run.resultId))) throw new ResearchError("Saved walk-forward bindings mismatch.", 422);
    const idMap = new Map<string, BacktestResult>();
    const segmentInputs = new Map<string, OriginalResearchInput>();
    const legacySegmentDatasetIds = new Map<string, string>();
    const results = saved.runs.map((run, index) => {
      const original = originals[index]!;
      const segment = run.segment ?? segments.get(run.resultId);
      if (!segment || run.value !== original.parameters[saved.parameter] || canonicalJson(run.metrics) !== canonicalJson(original.metrics)) throw new ResearchError("Saved walk-forward bindings mismatch.", 422);
      if (saved.outcomeVersion === 2 && run.outcomeId !== outcomeIdentity(original)) throw new ResearchError("Saved walk-forward outcome mismatch.", 422);
      let segmentCandles: typeof snapshot.candles;
      let segmentDatasetId = original.datasetId;
      if (run.segment) {
        const cached = segmentInputs.get(run.segment.datasetId);
        let segmentInput = cached;
        const reference = run.segment.reproduction;
        if (cached && (cached.reproduction.format !== reference.format || cached.reproduction.snapshotId !== reference.snapshotId || cached.reproduction.implementationHash !== reference.implementationHash)) throw new ResearchError("Saved walk-forward bindings mismatch.", 422);
        if (!segmentInput) {
          segmentInput = originalResearchInput({ ...saved, datasetId: run.segment.datasetId, reproduction: reference }, reproduction.implementationHash);
          segmentInputs.set(run.segment.datasetId, segmentInput);
        }
        segmentCandles = segmentInput.snapshot.candles;
        segmentDatasetId = run.segment.datasetId;
      } else {
        segmentCandles = snapshot.candles.slice(segment.start, segment.end);
        const key = `${segment.start}:${segment.end}`;
        const existing = legacySegmentDatasetIds.get(key);
        if (existing) segmentDatasetId = existing;
        else {
          segmentDatasetId = saveDatasetSnapshot({ exchange: snapshot.exchange, symbol: snapshot.symbol, timeframe: snapshot.timeframe, candles: segmentCandles });
          legacySegmentDatasetIds.set(key, segmentDatasetId);
        }
      }
      const result = runBacktest({ candles: segmentCandles, exchange: snapshot.exchange, symbol: snapshot.symbol, timeframe: snapshot.timeframe, datasetId: original.datasetId, strategy, parameters: { ...saved.parameters, [saved.parameter]: run.value }, config: saved.config, resultId: randomUUID() });
      assertSameOutcome(original, result);
      result.datasetId = segmentDatasetId;
      result.reproduction = { ...(run.segment?.reproduction ?? { ...reproduction, snapshotId: segmentDatasetId }) };
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
    const original = originals[index]!;
    if (run.value !== value || canonicalJson(run.metrics) !== canonicalJson(original.metrics)) throw new ResearchError("Saved sweep bindings mismatch.", 422);
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
