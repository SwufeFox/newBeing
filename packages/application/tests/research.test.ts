import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_STATE, type Candle } from "@newbeing/core";
import { canonicalJson, closeDatabaseForTests, datasetSnapshotPath, getDatabase, getExperiment, getSavedSweep, getWorkspaceState, listExperiments, listSavedSweeps, loadDatasetSnapshot, saveExperiment, saveWorkspaceState } from "@newbeing/storage";
import type { ExchangeAdapter } from "@newbeing/market-data";
import { rerunBacktestSweep, rerunResearchBacktest, runBacktestSweep, runResearchBacktest } from "../src/index.js";

const offline = vi.hoisted(() => ({ network: vi.fn(() => { throw new Error("NETWORK FORBIDDEN"); }), cache: vi.fn(() => { throw new Error("CACHE FORBIDDEN"); }) }));
vi.mock("@newbeing/market-data", async () => ({ ...await import("@newbeing/market-data/utils"), getExchangeAdapter: offline.network }));
vi.mock("@newbeing/storage", async (original) => ({ ...await original<typeof import("@newbeing/storage")>(), getCachedCandles: offline.cache }));
let directory: string;
const candles: Candle[] = [100, 101, 104, 102, 106, 109, 108, 112, 105, 103, 106, 110].map((close, i) => ({ timestamp: i * 60_000, open: close, high: close + 1, low: close - 1, close, volume: i + 1 }));
const request = { exchange: "binance" as const, symbol: "BTC/USDT", timeframe: "1m" as const, strategyId: "momentum-reversal", parameters: { lookback: 2, thresholdPct: 1 }, config: { initialCapital: 1000, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false }, openInWorkspace: false };
function market(bars = candles): ExchangeAdapter { return { id: "binance", fetchOHLCV: vi.fn(async () => structuredClone(bars)) } as unknown as ExchangeAdapter; }
beforeEach(() => { closeDatabaseForTests(); directory = mkdtempSync(path.join(tmpdir(), "newbeing-research-")); process.env.NEWBEING_DATA_DIR = directory; vi.clearAllMocks(); });
afterEach(() => { closeDatabaseForTests(); delete process.env.NEWBEING_DATA_DIR; rmSync(directory, { recursive: true, force: true }); });
const computational = (r: NonNullable<ReturnType<typeof getExperiment>>) => ({ datasetId: r.datasetId, exchange: r.exchange, symbol: r.symbol, timeframe: r.timeframe, parameters: r.parameters, assumptions: r.assumptions, execution: r.execution, engineVersion: r.engineVersion, strategyVersion: r.strategyVersion, metrics: r.metrics, trades: r.trades, signals: r.signals, equityCurve: r.equityCurve });

describe("saved research inputs", () => {
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
    expect(adapter.fetchOHLCV).toHaveBeenCalledTimes(1);
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
