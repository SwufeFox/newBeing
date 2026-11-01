import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_STATE, type Candle } from "@newbeing/core";
import { canonicalJson, closeDatabaseForTests, datasetSnapshotPath, getDatabase, getExperiment, getSavedSweep, getWorkspaceState, identifyDataset, listExperiments, listSavedSweeps, loadDatasetSnapshot, researchSweepRunSegments, saveResearchResults, saveExperiment, saveWorkspaceState } from "@newbeing/storage";
import type { ExchangeAdapter } from "@newbeing/market-data";
import { outcomeIdentity } from "../src/research-inputs.js";
import { rerunBacktestSweep, rerunResearchBacktest, runBacktestSweep, runResearchBacktest } from "../src/index.js";

const offline = vi.hoisted(() => ({ network: vi.fn(() => { throw new Error("NETWORK FORBIDDEN"); }), cache: vi.fn(() => { throw new Error("CACHE FORBIDDEN"); }) }));
vi.mock("@newbeing/market-data", async (original) => ({ ...await original<typeof import("@newbeing/market-data")>(), getExchangeAdapter: offline.network }));
vi.mock("@newbeing/storage", async (original) => ({ ...await original<typeof import("@newbeing/storage")>(), getCachedCandles: offline.cache }));
let directory: string;
const candles: Candle[] = [100, 101, 104, 102, 106, 109, 108, 112, 105, 103, 106, 110].map((close, i) => ({ timestamp: i * 60_000, open: close, high: close + 1, low: close - 1, close, volume: i + 1 }));
const request = { exchange: "binance" as const, symbol: "BTC/USDT", timeframe: "1m" as const, strategyId: "momentum-reversal", parameters: { lookback: 2, thresholdPct: 1 }, config: { initialCapital: 1000, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false }, limit: candles.length, openInWorkspace: false };
function market(bars = candles): ExchangeAdapter { return { id: "binance", fetchOHLCVSince: vi.fn(async () => structuredClone(bars)) } as unknown as ExchangeAdapter; }
beforeEach(() => { closeDatabaseForTests(); directory = mkdtempSync(path.join(tmpdir(), "newbeing-research-")); process.env.NEWBEING_DATA_DIR = directory; vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(candles.length * 60_000); });
afterEach(() => { vi.restoreAllMocks(); closeDatabaseForTests(); delete process.env.NEWBEING_DATA_DIR; rmSync(directory, { recursive: true, force: true }); });
const computational = (r: NonNullable<ReturnType<typeof getExperiment>>) => ({ datasetId: r.datasetId, exchange: r.exchange, symbol: r.symbol, timeframe: r.timeframe, parameters: r.parameters, assumptions: r.assumptions, execution: r.execution, engineVersion: r.engineVersion, strategyVersion: r.strategyVersion, metrics: r.metrics, trades: r.trades, signals: r.signals, equityCurve: r.equityCurve });

describe("saved research inputs", () => {
  it.each(["backtest", "sweep"] as const)("rejects a delayed %s when Replay becomes current", async (kind) => {
    let release!: (bars: Candle[]) => void;
    const adapter = { id: "binance", fetchOHLCVSince: () => new Promise<Candle[]>((resolve) => { release = resolve; }) } as unknown as ExchangeAdapter;
    const pending = kind === "backtest" ? runResearchBacktest({ ...request, openInWorkspace: true }, { marketAdapter: adapter }) : runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1 }, { marketAdapter: adapter });
    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay", activeReplayId: "new-session" });
    const navigated = getWorkspaceState();
    release(candles);
    await expect(pending).rejects.toThrow(/Replay/);
    expect(getWorkspaceState()).toEqual(navigated);
    expect(listExperiments()).toEqual([]);
    expect(listSavedSweeps()).toEqual([]);
  });
  it.each(["market", "away-and-back"])("saves delayed results without stealing %s navigation", async (navigation) => {
    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "research" });
    const start = getWorkspaceState().state;
    let release!: (bars: Candle[]) => void;
    const adapter = { id: "binance", fetchOHLCVSince: () => new Promise<Candle[]>((resolve) => { release = resolve; }) } as unknown as ExchangeAdapter;
    const pending = runResearchBacktest({ ...request, openInWorkspace: true }, { marketAdapter: adapter });
    saveWorkspaceState({ ...start, activeWorkspace: "terminal", symbol: "ETH/USDT" });
    if (navigation === "away-and-back") saveWorkspaceState(start);
    const navigated = getWorkspaceState();
    release(candles);
    const result = await pending;
    expect(getExperiment(result.resultId)).toEqual(result);
    expect(getWorkspaceState()).toEqual(navigated);
  });
  it.each(["INSERT", "UPDATE"])("rolls back the result when workspace %s fails", async (operation) => {
    if (operation === "UPDATE") saveWorkspaceState(DEFAULT_WORKSPACE_STATE);
    const before = getWorkspaceState();
    getDatabase().run(`CREATE TRIGGER interrupt_workspace BEFORE ${operation} ON workspace_states BEGIN SELECT RAISE(ABORT, 'workspace interrupted'); END`);
    await expect(runResearchBacktest({ ...request, openInWorkspace: true }, { marketAdapter: market() })).rejects.toThrow(/workspace interrupted/);
    expect(listExperiments()).toEqual([]);
    expect(getWorkspaceState()).toEqual(before);
  });
  it("atomically selects a result when no navigation intervenes", async () => {
    const result = await runResearchBacktest({ ...request, openInWorkspace: true }, { marketAdapter: market() });
    expect(getWorkspaceState().state).toMatchObject({ activeWorkspace: "research", activeBacktestId: result.resultId });
    expect(getExperiment(result.resultId)).toEqual(result);
  });
  it.each(["metrics", "signals", "trades", "equityCurve", "execution", "parameters", "assumptions", "symbol", "timeframe", "strategyId"] as const)("outcome covers %s while ignoring run and provenance metadata", async (field) => {
    const result = await runResearchBacktest(request, { marketAdapter: market() });
    const metadata = { ...result, resultId: "other", createdAt: "later", rerunOf: "parent", candleSource: "local-cache" as const, candleCache: { fallback: true, cachedAt: "now" } };
    expect(outcomeIdentity(metadata)).toBe(outcomeIdentity(result));
    const changed = { ...result, [field]: null } as unknown as typeof result;
    expect(outcomeIdentity(changed)).not.toBe(outcomeIdentity(result));
  });
  it.each(["metrics", "signals", "trades", "equityCurve"] as const)("rejects saved %s output drift before publishing rerun", async (field) => {
    const result = await runResearchBacktest(request, { marketAdapter: market() });
    if (field === "metrics") result.metrics.finalEquity += 1;
    else if (field === "signals") result.signals[0]!.side = "short";
    else if (field === "trades") result.trades[0]!.exitPrice += 1;
    else result.equityCurve[0]!.equity += 1;
    getDatabase().run(`UPDATE experiments SET result = '${canonicalJson(result).replaceAll("'", "''")}'`);
    expect(() => rerunResearchBacktest(result.resultId)).toThrow(/drift/);
    expect(listExperiments()).toHaveLength(1);
  });
  it.each(["metrics", "value", "config", "parameters", "missing-run", "outcome"])("rejects contradictory sweep %s without saving any reruns", async (field) => {
    const saved = await runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1 }, { marketAdapter: market() });
    if (field === "metrics") saved.runs[0]!.metrics.finalEquity += 1;
    if (field === "value") saved.runs[0]!.value += 1;
    if (field === "config") saved.config.feeRate = 0.1;
    if (field === "parameters") saved.parameters.lookback = 3;
    if (field === "missing-run") saved.runs[0]!.resultId = "missing";
    if (field === "outcome") saved.runs[0]!.outcomeId = "invalid";
    getDatabase().run(`UPDATE saved_sweeps SET result = '${canonicalJson(saved).replaceAll("'", "''")}'`);
    expect(() => rerunBacktestSweep(saved.sweepId)).toThrow(/mismatch|drift/);
    expect(listExperiments()).toHaveLength(2);
    expect(listSavedSweeps()).toHaveLength(1);
  });
  it("compares full legacy sweep outputs rather than treating input hashes as verification", async () => {
    const saved = await runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1 }, { marketAdapter: market() });
    delete saved.outcomeVersion;
    saved.runs.forEach((run) => { run.outcomeId = "legacy-input-only"; });
    getDatabase().run(`UPDATE saved_sweeps SET result = '${canonicalJson(saved).replaceAll("'", "''")}'`);
    const rerun = rerunBacktestSweep(saved.sweepId);
    expect(rerun.outcomeVersion).toBe(2);
    expect(rerun.runs[0]!.outcomeId).not.toBe("legacy-input-only");
    const original = getExperiment(saved.runs[0]!.resultId)!;
    original.signals[0]!.side = "short";
    getDatabase().run(`UPDATE experiments SET result = '${canonicalJson(original).replaceAll("'", "''")}' WHERE result_id = '${original.resultId}'`);
    expect(() => rerunBacktestSweep(saved.sweepId)).toThrow(/drift/);
    expect(listSavedSweeps()).toHaveLength(2);
  });
  it("shares walk-forward run mapping and reruns current saved sweeps", async () => {
    const bars: Candle[] = Array.from({ length: 50 }, (_, index) => {
      const close = 100 + Math.sin(index / 3) * 5 + index / 10;
      return { timestamp: index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: index + 1 };
    });
    const saved = await runBacktestSweep({ ...request, limit: bars.length, parameter: "thresholdPct", from: 1, to: 2, step: 1, mode: "walk-forward" }, { marketAdapter: market(bars), now: () => bars.length * 60_000 });
    const expected = saved.runs.map((run) => ({ start: run.segment!.start, end: run.segment!.end }));
    const legacyShape = structuredClone(saved);
    for (const run of legacyShape.runs) delete run.segment;
    delete legacyShape.outcomeVersion;
    const recovered = researchSweepRunSegments(legacyShape);
    expect(legacyShape.runs.map((run) => recovered.get(run.resultId))).toEqual(expected);

    const rerun = rerunBacktestSweep(saved.sweepId);
    expect(rerun.runs.map((run) => ({ start: run.segment!.start, end: run.segment!.end }))).toEqual(expected);
  });

  it("runs sweeps from saved snapshots without refetching or relabeling data", async () => {
    const source = await runResearchBacktest(request, { marketAdapter: market() });
    const { limit: _limit, ...baseRequest } = request;
    const adapter = market();
    const datasetRequest = { ...baseRequest, datasetId: source.datasetId, parameter: "thresholdPct", from: 1, to: 2, step: 1, mode: "full-sample" as const };
    const sweep = await runBacktestSweep(datasetRequest, { marketAdapter: adapter });
    expect(sweep.datasetId).toBe(source.datasetId);
    expect(sweep.exchange).toBe(source.exchange);
    expect(sweep.symbol).toBe(source.symbol);
    expect(sweep.timeframe).toBe(source.timeframe);
    expect(adapter.fetchOHLCVSince).not.toHaveBeenCalled();
    await expect(runBacktestSweep({ ...datasetRequest, symbol: "ETH/USDT" }, { marketAdapter: adapter })).rejects.toThrow(/does not match/);
    await expect(runBacktestSweep({ ...datasetRequest, startAt: 0 }, { marketAdapter: adapter })).rejects.toThrow(/cannot be combined/);
  });

  it("filters walk-forward training winners by max drawdown and preserves the constraint on rerun", async () => {
    const bars: Candle[] = Array.from({ length: 50 }, (_, index) => {
      const close = 100 + Math.sin(index / 3) * 5 + index / 10;
      return { timestamp: index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: index + 1 };
    });
    const sweepRequest = { ...request, limit: bars.length, parameter: "thresholdPct", from: 1, to: 2, step: 1, mode: "walk-forward" as const };
    const dependencies = { marketAdapter: market(bars), now: () => bars.length * 60_000 };
    const unconstrained = await runBacktestSweep(sweepRequest, dependencies);
    const trainingEnds = [25, 30, 35, 40];
    const minimumDrawdowns = trainingEnds.map((end) => Math.min(...unconstrained.runs
      .filter((run) => run.segment?.start === 0 && run.segment.end === end)
      .map((run) => run.metrics.maxDrawdown)));
    const maxTrainingDrawdown = Math.max(...minimumDrawdowns);
    const constrained = await runBacktestSweep({ ...sweepRequest, maxTrainingDrawdown }, dependencies);
    const report = constrained.walkForward!;
    const expectedWinner = (end: number) => {
      const eligible = constrained.runs
        .filter((run) => run.segment?.start === 0 && run.segment.end === end)
        .filter((run) => run.metrics.maxDrawdown <= maxTrainingDrawdown);
      return eligible.sort((a, b) => b.metrics.totalReturn - a.metrics.totalReturn || a.value - b.value)[0]!;
    };

    for (let index = 0; index < 3; index += 1) expect(report.folds[index]!.candidateValue).toBe(expectedWinner(trainingEnds[index]!).value);
    expect(report.finalCandidateValue).toBe(expectedWinner(40).value);
    expect(report.selectionConstraints).toEqual({ maxTrainingDrawdown });
    const rerun = rerunBacktestSweep(constrained.sweepId);
    expect(rerun.walkForward?.selectionConstraints).toEqual({ maxTrainingDrawdown });
    expect(rerun.walkForward?.finalCandidateValue).toBe(report.finalCandidateValue);
    if (Math.min(...minimumDrawdowns) > 0) {
      await expect(runBacktestSweep({ ...sweepRequest, maxTrainingDrawdown: Math.min(...minimumDrawdowns) / 2 }, dependencies)).rejects.toMatchObject({
        code: "SWEEP_TRAINING_DRAWDOWN_EXCLUDES_ALL",
        status: 422,
        nextAction: expect.stringContaining("max_training_drawdown"),
      });
    }
    await expect(runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1, mode: "full-sample", maxTrainingDrawdown: 0.4 }, dependencies)).rejects.toThrow(/only in walk-forward mode/);
    await expect(runBacktestSweep({ ...sweepRequest, maxTrainingDrawdown: 1.01 }, dependencies)).rejects.toThrow(/between 0 and 1/);
    await expect(runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1, mode: "full-sample", selectionMetric: "sharpeRatio" }, dependencies)).rejects.toThrow(/only in walk-forward mode/);
  });
  it("selects finite training Sharpe when requested and preserves the rule on rerun", async () => {
    const bars: Candle[] = Array.from({ length: 80 }, (_, index) => {
      const close = 100 + Math.sin(index / 2.7) * 8 + Math.sin(index / 7) * 3 + index * 0.03;
      return { timestamp: index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: index + 1 };
    });
    const maxTrainingDrawdown = 0.9;
    const sweepRequest = { ...request, limit: bars.length, parameter: "thresholdPct", from: 0.5, to: 5, step: 0.5, mode: "walk-forward" as const, selectionMetric: "sharpeRatio" as const, maxTrainingDrawdown };
    const dependencies = { marketAdapter: market(bars), now: () => bars.length * 60_000 };
    const sweep = await runBacktestSweep(sweepRequest, dependencies);
    const report = sweep.walkForward!;
    const candidates = sweep.runs.filter((run) => run.segment?.start === 0 && run.segment.end === report.boundaries.train80);
    const winner = (metric: "totalReturn" | "sharpeRatio") => [...candidates]
      .filter((run) => run.metrics.maxDrawdown <= maxTrainingDrawdown && (metric === "totalReturn" || run.metrics.sharpeRatio !== null))
      .sort((a, b) => {
        const aScore = metric === "sharpeRatio" ? a.metrics.sharpeRatio! : a.metrics.totalReturn;
        const bScore = metric === "sharpeRatio" ? b.metrics.sharpeRatio! : b.metrics.totalReturn;
        return bScore - aScore || a.value - b.value;
      })[0]!;
    const sharpeWinner = winner("sharpeRatio");
    const returnWinner = winner("totalReturn");
    expect(report.selectionMetric).toBe("sharpeRatio");
    expect(report.selectionRule).toBe("training-sharpeRatio-desc/parameter-value-asc");
    expect(report.finalCandidateValue).toBe(sharpeWinner.value);
    expect(sharpeWinner.value).not.toBe(returnWinner.value);
    const rerun = rerunBacktestSweep(sweep.sweepId);
    expect(rerun.walkForward?.selectionMetric).toBe("sharpeRatio");
    expect(rerun.walkForward?.selectionRule).toBe(report.selectionRule);
    expect(rerun.walkForward?.finalCandidateValue).toBe(report.finalCandidateValue);

    const constantBars = bars.map((bar) => ({ ...bar, open: 100, high: 101, low: 99, close: 100 }));
    const experimentCount = listExperiments().length;
    const savedSweepCount = listSavedSweeps().length;
    await expect(runBacktestSweep(sweepRequest, { ...dependencies, marketAdapter: market(constantBars) })).rejects.toMatchObject({
      code: "SWEEP_NO_FINITE_TRAINING_SHARPE",
      status: 422,
      nextAction: expect.stringContaining("total_return"),
    });
    expect(listExperiments()).toHaveLength(experimentCount);
    expect(listSavedSweeps()).toHaveLength(savedSweepCount);
  });
  it.each(["venue", "instrument", "timeframe", "strategy", "strategyVersion", "engineVersion", "config", "parameters", "values", "metrics", "outcome", "provenance", "bars", "duplicate-run", "legacy"])("rejects inconsistent %s at publication without inserting any rows", async (field) => {
    const sweep = await runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1 }, { marketAdapter: market() });
    const results = sweep.runs.map((run) => getExperiment(run.resultId)!);
    results.forEach((result, index) => { result.resultId = `candidate-${index}`; sweep.runs[index]!.resultId = result.resultId; });
    sweep.sweepId = "candidate-sweep";
    if (field === "venue") sweep.exchange = "kraken";
    if (field === "instrument") sweep.symbol = "ETH/USDT";
    if (field === "timeframe") sweep.timeframe = "5m";
    if (field === "strategy") sweep.strategyId = "other";
    if (field === "strategyVersion") sweep.strategyVersion = "other";
    if (field === "engineVersion") sweep.engineVersion = "other";
    if (field === "config") sweep.config.feeRate = 0.1;
    if (field === "parameters") sweep.parameters.lookback = 3;
    if (field === "values") sweep.values[0] = 9;
    if (field === "metrics") sweep.runs[0]!.metrics.finalEquity += 1;
    if (field === "outcome") sweep.runs[0]!.outcomeId = "wrong";
    if (field === "provenance") results[0]!.reproduction!.implementationHash = "wrong";
    if (field === "bars") sweep.bars -= 1;
    if (field === "duplicate-run") { results[1]!.resultId = results[0]!.resultId; sweep.runs[1]!.resultId = results[0]!.resultId; }
    if (field === "legacy") delete sweep.outcomeVersion;
    expect(() => saveResearchResults(results, sweep)).toThrow(/mismatch/);
    expect(listExperiments()).toHaveLength(2);
    expect(listSavedSweeps()).toHaveLength(1);
    expect(getExperiment("candidate-0")).toBeUndefined();
    expect(getSavedSweep("candidate-sweep")).toBeUndefined();
  });
  it("keeps a run selected while another request awaits candles", async () => {
    let release!: (bars: Candle[]) => void;
    const pending = runResearchBacktest({ ...request, openInWorkspace: true }, { marketAdapter: { fetchOHLCVSince: () => new Promise<Candle[]>((resolve) => { release = resolve; }) } as unknown as ExchangeAdapter });
    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "research", activeBacktestId: "user-selected" });
    const selected = getWorkspaceState();
    release(candles);
    await pending;
    expect(getWorkspaceState()).toEqual(selected);
  });
  it.each(["backtest", "sweep"] as const)("uses an injected clock for %s completion boundaries", async (kind) => {
    vi.mocked(Date.now).mockReturnValue(9_000_000);
    const dependencies = { marketAdapter: market(), now: () => candles.length * 60_000 };
    const result = kind === "backtest" ? await runResearchBacktest(request, dependencies) : await runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1 }, dependencies);
    expect(loadDatasetSnapshot(result.datasetId).candles).toEqual(candles);
  });
  it("reruns a saved run from exact original candles after restart, without network/cache", async () => {
    const result = await runResearchBacktest(request, { marketAdapter: market() });
    expect(loadDatasetSnapshot(result.datasetId).candles).toEqual(candles);
    expect(result.parameters).toEqual({ lookback: 2, thresholdPct: 1, reversal: false, allowShorts: false });
    expect(result.signals.slice(0, 5)).toEqual([{ timestamp: 0, side: "flat" }, { timestamp: 60_000, side: "flat" }, { timestamp: 120_000, side: "long" }, { timestamp: 180_000, side: "flat" }, { timestamp: 240_000, side: "long" }]);
    closeDatabaseForTests();
    const rerun = rerunResearchBacktest(result.resultId);
    expect(rerun.resultId).not.toBe(result.resultId);
    expect(rerun.rerunOf).toBe(result.resultId);
    expect(computational(rerun)).toEqual(computational(result));
    expect(getExperiment(rerun.resultId)).toEqual(rerun);
    expect(offline.network).not.toHaveBeenCalled(); expect(offline.cache).not.toHaveBeenCalled();
  });
  it("saves every sweep result on the same snapshot and reruns the original values", async () => {
    const adapter = market();
    const sweep = await runBacktestSweep({ ...request, parameter: "thresholdPct", from: 0.05, to: 0.35, step: 0.1 }, { marketAdapter: adapter });
    expect(adapter.fetchOHLCVSince).toHaveBeenCalledTimes(1);
    expect(sweep.values).toEqual([0.05, 0.15, 0.25, 0.35]);
    expect(getSavedSweep(sweep.sweepId)).toEqual(sweep);
    expect(listSavedSweeps()).toEqual([sweep]);
    for (const run of sweep.runs) {
      const saved = getExperiment(run.resultId)!;
      expect(saved.parameters.thresholdPct).toBe(run.value);
      expect(saved.datasetId).toBe(sweep.datasetId);
      expect(saved.metrics).toEqual(run.metrics);
      expect(saved.equityCurve.map((p) => p.timestamp)).toEqual(candles.map((c) => c.timestamp));
    }
    closeDatabaseForTests();
    const rerun = rerunBacktestSweep(sweep.sweepId);
    expect(rerun.rerunOf).toBe(sweep.sweepId);
    expect(rerun.values).toEqual(sweep.values);
    rerun.runs.forEach((run, i) => expect(computational(getExperiment(run.resultId)!)).toEqual(computational(getExperiment(sweep.runs[i]!.resultId)!)));
    expect(offline.network).not.toHaveBeenCalled(); expect(offline.cache).not.toHaveBeenCalled();
  });
  it.each(["engineVersion", "strategyVersion", "implementationHash"])("rejects incompatible saved %s", async (field) => {
    const result = await runResearchBacktest(request, { marketAdapter: market() });
    if (field === "implementationHash") result.reproduction!.implementationHash = "different-artifact";
    else result[field as "engineVersion" | "strategyVersion"] = "unsupported";
    getDatabase().run(`UPDATE experiments SET result = '${canonicalJson(result).replaceAll("'", "''")}'`);
    expect(() => rerunResearchBacktest(result.resultId)).toThrow(/incompatible/);
    expect(listExperiments()).toEqual([result]);
  });
  it("does not label or rerun legacy inputs as reproducible", async () => {
    const result = await runResearchBacktest(request, { marketAdapter: market() });
    const { reproduction: _ref, ...legacy } = result;
    saveExperiment({ ...legacy, resultId: "legacy" });
    expect(getExperiment("legacy")!.reproduction).toBeUndefined();
    expect(() => rerunResearchBacktest("legacy")).toThrow(/Legacy/);
  });
  it("rejects corrupt snapshots, missing IDs, bad parameters, and replay access without publishing results", async () => {
    expect(() => rerunResearchBacktest("missing")).toThrow(/not found/);
    await expect(runBacktestSweep({ ...request, parameter: "allowShorts", from: 0, to: 1, step: 1 }, { marketAdapter: market() })).rejects.toThrow(/numeric/);
    await expect(runResearchBacktest({ ...request, parameters: { typo: 1 } }, { marketAdapter: market() })).rejects.toThrow(/parameter/);
    const result = await runResearchBacktest(request, { marketAdapter: market() });
    writeFileSync(datasetSnapshotPath(result.datasetId), "{}");
    expect(() => rerunResearchBacktest(result.resultId)).toThrow();
    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay" });
    expect(() => rerunResearchBacktest(result.resultId)).toThrow(/Replay/);
    expect(listExperiments()).toHaveLength(1);
  });
  it("rolls back every run if sweep metadata publication is interrupted", async () => {
    getDatabase().run("CREATE TRIGGER interrupt_sweep BEFORE INSERT ON saved_sweeps BEGIN SELECT RAISE(ABORT, 'simulated metadata interruption'); END");
    await expect(runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1 }, { marketAdapter: market() })).rejects.toThrow(/simulated metadata interruption/);
    expect(listExperiments()).toEqual([]); expect(listSavedSweeps()).toEqual([]);
    expect(getWorkspaceState().state.activeBacktestId).toBe(DEFAULT_WORKSPACE_STATE.activeBacktestId);
    getDatabase().run("DROP TRIGGER interrupt_sweep");
    const saved = await runBacktestSweep({ ...request, parameter: "thresholdPct", from: 1, to: 2, step: 1 }, { marketAdapter: market() });
    expect(loadDatasetSnapshot(saved.datasetId).candles).toEqual(candles);
    expect(saved.runs.map((r) => getExperiment(r.resultId)!.parameters.thresholdPct)).toEqual([1, 2]);
  });
});
