import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@newbeing/core", () => import("../../core/src/index.js"));
vi.mock("@newbeing/storage", () => import("../../storage/src/index.js"));
vi.mock("@newbeing/market-data", async (original) => ({
  ...await original<typeof import("@newbeing/market-data")>(),
  getExchangeAdapter: vi.fn(() => { throw new Error("NETWORK FORBIDDEN"); }),
}));
import { DEFAULT_WORKSPACE_STATE, type Candle } from "@newbeing/core";
import { closeDatabaseForTests, datasetSnapshotPath, getDatabase, getExperiment, getWorkspaceState, identifyDataset, listExperiments, loadDatasetSnapshot, saveDatasetSnapshot, saveWorkspaceState } from "@newbeing/storage";
import { getExchangeAdapter } from "@newbeing/market-data";
import { rerunResearchBacktest, runResearchEvaluation, type ResearchEvaluationRequest } from "../src/index.js";
import { outcomeIdentity } from "../src/research-inputs.js";

const candles: Candle[] = Array.from({ length: 24 }, (_, index) => {
  const close = 100 + index * 10;
  return { timestamp: index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 10 };
});
const instrument = { exchange: "binance" as const, symbol: "BTC/USDT", timeframe: "1m" as const };
let directory: string;
let request: ResearchEvaluationRequest;
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-evaluations-"));
  process.env.NEWBEING_DATA_DIR = directory;
  request = {
    datasetId: saveDatasetSnapshot({ ...instrument, candles }), strategyId: "momentum-reversal",
    candidates: [{ lookback: 2, thresholdPct: 1 }, { lookback: 2, thresholdPct: 50 }], splitIndex: 12,
    config: { accountMode: "spot", initialCapital: 1000, positionFraction: 0.8, feeRate: 0.001, slippageRate: 0.002, allowShorts: false },
  };
});
afterEach(() => {
  vi.clearAllMocks(); closeDatabaseForTests(); delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});

describe("persistent single-holdout evaluation", () => {
  it("binds canonical segment hashes and snapshots, saves all full results, and reruns each offline after restart", () => {
    const workspace = getWorkspaceState();
    const report = runResearchEvaluation(request);
    expect(report.datasetId).toBe(request.datasetId);
    expect(report.trainingDatasetId).toBe(identifyDataset({ ...instrument, candles: candles.slice(0, 12) }).datasetId);
    expect(report.holdoutDatasetId).toBe(identifyDataset({ ...instrument, candles: candles.slice(12) }).datasetId);
    expect(new Set([report.datasetId, report.trainingDatasetId, report.holdoutDatasetId]).size).toBe(3);
    expect(loadDatasetSnapshot(report.trainingDatasetId).candles).toEqual(candles.slice(0, 12));
    expect(loadDatasetSnapshot(report.holdoutDatasetId).candles).toEqual(candles.slice(12));
    expect(report.selectedCandidateIndex).toBe(0);
    expect(report.selectedParameters).toEqual(report.training[0]!.parameters);
    expect(report.trainingBoundary.endTimeExclusive).toBe(report.holdoutBoundary.startTime);
    expect(report.evaluation).toBe("single-holdout");
    expect(report.initialization).toBe("cold-start/no-carry-positions");
    expect(report.holdout.equityCurve[0]!.equity).toBe(request.config.initialCapital);
    const results = [...report.training.map((run) => run.result), report.holdout];
    expect(report.resultIds).toEqual({ training: results.slice(0, -1).map((r) => r.resultId), holdout: report.holdout.resultId });
    expect(listExperiments()).toHaveLength(results.length);
    for (const [index, result] of results.entries()) {
      expect(result.datasetId).toBe(index === results.length - 1 ? report.holdoutDatasetId : report.trainingDatasetId);
      expect(result.reproduction).toMatchObject({ format: 1, snapshotId: result.datasetId });
      expect(getExperiment(result.resultId)).toEqual(result);
    }
    // Prove reruns do not depend on the parent snapshot or live/cache candles.
    unlinkSync(datasetSnapshotPath(request.datasetId));
    closeDatabaseForTests();
    for (const original of results) {
      const rerun = rerunResearchBacktest(original.resultId);
      expect(rerun.rerunOf).toBe(original.resultId);
      expect(rerun.resultId).not.toBe(original.resultId);
      expect(outcomeIdentity(rerun)).toBe(outcomeIdentity(original));
      expect(getExperiment(rerun.resultId)).toEqual(rerun);
    }
    expect(getExchangeAdapter).not.toHaveBeenCalled();
    expect(getWorkspaceState()).toEqual(workspace);
  });

  it("keeps training identity and selection unchanged when only holdout candles change", () => {
    const first = runResearchEvaluation(request);
    const changed = candles.map((bar, index) => index < 12 ? bar : { ...bar, open: 100, high: 101, low: 99, close: 100 });
    const second = runResearchEvaluation({ ...request, datasetId: saveDatasetSnapshot({ ...instrument, candles: changed }) });
    expect(second.datasetId).not.toBe(first.datasetId);
    expect(second.trainingDatasetId).toBe(first.trainingDatasetId);
    expect(second.holdoutDatasetId).not.toBe(first.holdoutDatasetId);
    expect(second.training.map((r) => outcomeIdentity(r.result))).toEqual(first.training.map((r) => outcomeIdentity(r.result)));
    expect(second.selectedParameters).toEqual(first.selectedParameters);
  });

  it("rolls back earlier training inserts if the final holdout insert fails", () => {
    getDatabase().run("CREATE TRIGGER interrupt_evaluation BEFORE INSERT ON experiments WHEN (SELECT count(*) FROM experiments) = 2 BEGIN SELECT RAISE(ABORT, 'holdout interrupted'); END");
    expect(() => runResearchEvaluation(request)).toThrow(/holdout interrupted/);
    expect(listExperiments()).toEqual([]);
    getDatabase().run("DROP TRIGGER interrupt_evaluation");
    const report = runResearchEvaluation(request);
    expect(listExperiments()).toHaveLength(3);
    expect(getExperiment(report.resultIds.holdout)).toEqual(report.holdout);
  });

  it("rejects Replay before reading a snapshot or publishing any results", () => {
    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay" });
    const workspace = getWorkspaceState();
    unlinkSync(datasetSnapshotPath(request.datasetId));
    expect(() => runResearchEvaluation(request)).toThrow(/Replay/);
    expect(listExperiments()).toEqual([]);
    expect(getWorkspaceState()).toEqual(workspace);
  });

  it.each(["missing", "corrupt"])("rejects a %s parent snapshot without results", (kind) => {
    if (kind === "missing") unlinkSync(datasetSnapshotPath(request.datasetId));
    else writeFileSync(datasetSnapshotPath(request.datasetId), "{}");
    expect(() => runResearchEvaluation(request)).toThrow(/snapshot|Snapshot/);
    expect(listExperiments()).toEqual([]);
  });

  it.each([
    { splitIndex: 23 }, { candidates: Array.from({ length: 41 }, (_, thresholdPct) => ({ thresholdPct })) },
    { strategyId: "arbitrary-source" }, { config: { initialCapital: 0, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false } },
  ])("does not persist invalid input %j", (change) => {
    expect(() => runResearchEvaluation({ ...request, ...change })).toThrow();
    expect(listExperiments()).toEqual([]);
  });
});
