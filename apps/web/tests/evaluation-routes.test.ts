import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@newbeing/core", () => import("../../../packages/core/src/index.js"));
vi.mock("@newbeing/storage", () => import("../../../packages/storage/src/index.js"));
vi.mock("@newbeing/application", () => import("../../../packages/application/src/index.js"));
import { DEFAULT_WORKSPACE_STATE, type BacktestResult } from "@newbeing/core";
import { closeDatabaseForTests, datasetSnapshotPath, getExperiment, listExperiments, loadDatasetSnapshot, saveDatasetSnapshot, saveWorkspaceState } from "@newbeing/storage";
import type { ResearchEvaluationResult } from "@newbeing/application";
import { POST } from "../src/app/api/evaluations/route.js";
import { POST as rerun } from "../src/app/api/backtests/[id]/rerun/route.js";

let directory: string;
let body: { datasetId: string; strategyId: string; candidates: Record<string, number>[]; splitIndex: number; config: { initialCapital: number; positionFraction: number; feeRate: number; slippageRate: number; allowShorts: false } };
const post = (data: unknown) => new Request("http://localhost/api/evaluations", { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  closeDatabaseForTests(); directory = mkdtempSync(path.join(tmpdir(), "newbeing-evaluation-routes-")); process.env.NEWBEING_DATA_DIR = directory;
  const candles = Array.from({ length: 24 }, (_, index) => {
    const close = 100 + index * 10;
    return { timestamp: index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 10 };
  });
  body = {
    datasetId: saveDatasetSnapshot({ exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", candles }),
    strategyId: "momentum-reversal", candidates: [{ lookback: 2, thresholdPct: 1 }, { lookback: 2, thresholdPct: 50 }], splitIndex: 12,
    config: { initialCapital: 1000, positionFraction: 0.8, feeRate: 0.001, slippageRate: 0.002, allowShorts: false },
  };
});
afterEach(() => { closeDatabaseForTests(); delete process.env.NEWBEING_DATA_DIR; rmSync(directory, { recursive: true, force: true }); });

describe("POST /api/evaluations", () => {
  it("returns the complete saved single-holdout report and exposes resultIds usable by the existing rerun route", async () => {
    const response = await POST(post(body));
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const report = await response.json() as ResearchEvaluationResult;
    expect(report.datasetId).toBe(body.datasetId);
    expect(report.selectedParameters).toEqual(report.training[report.selectedCandidateIndex]!.parameters);
    expect(report.evaluation).toBe("single-holdout");
    expect(report.initialization).toBe("cold-start/no-carry-positions");
    expect(report.trainingBoundary).toMatchObject({ startIndex: 0, endIndexExclusive: 12, bars: 12 });
    expect(report.holdoutBoundary).toMatchObject({ startIndex: 12, endIndexExclusive: 24, bars: 12 });
    expect(loadDatasetSnapshot(report.trainingDatasetId).candles).toHaveLength(12);
    expect(loadDatasetSnapshot(report.holdoutDatasetId).candles[0]!.timestamp).toBe(12 * 60_000);
    expect(listExperiments()).toHaveLength(3);
    closeDatabaseForTests();
    for (const id of [...report.resultIds.training, report.resultIds.holdout]) {
      const original = getExperiment(id)!;
      const response = await rerun(post({}), { params: Promise.resolve({ id }) });
      expect(response.status).toBe(201);
      const saved = await response.json() as BacktestResult;
      expect(saved.rerunOf).toBe(id);
      expect(saved.datasetId).toBe(original.datasetId);
      expect(saved.metrics).toEqual(original.metrics);
      expect(saved.signals).toEqual(original.signals);
      expect(saved.trades).toEqual(original.trades);
      expect(saved.equityCurve).toEqual(original.equityCurve);
    }
  });

  it("accepts exactly 40 candidates", async () => {
    const response = await POST(post({ ...body, candidates: Array.from({ length: 40 }, (_, thresholdPct) => ({ lookback: 2, thresholdPct })) }));
    expect(response.status).toBe(201);
    const report = await response.json() as ResearchEvaluationResult;
    expect(report.resultIds.training).toHaveLength(40);
    expect(listExperiments(100)).toHaveLength(41);
  });

  it.each([
    { candles: [] }, { source: "return []" }, { strategy: { source: "return []" } }, { exchange: "okx" },
    { datasetId: "../snapshot" }, { candidates: [] },
    { candidates: Array.from({ length: 41 }, (_, thresholdPct) => ({ thresholdPct })) },
    { splitIndex: 2.5 }, { config: { allowShorts: false } },
    { config: { initialCapital: 1000, positionFraction: 1, feeRate: 0.051, slippageRate: 0, allowShorts: false } },
    { config: { initialCapital: 1000, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: true } },
    { config: { initialCapital: 1000, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false, accountMode: "legacy-margin" } },
    { config: { initialCapital: 1000, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false, source: "code" } },
  ])("rejects invalid or additional request fields %j", async (change) => {
    expect((await POST(post({ ...body, ...change }))).status).toBe(400);
    expect(listExperiments()).toEqual([]);
  });

  it.each([{ splitIndex: 23 }, { strategyId: "custom-code" }, { candidates: [{ lookback: 1 }] }, { candidates: [{}, {}] },
    { config: { initialCapital: 1000.000000001, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false } },
  ])("returns 422 for semantically invalid input %j", async (change) => {
    expect((await POST(post({ ...body, ...change }))).status).toBe(422);
    expect(listExperiments()).toEqual([]);
  });

  it("returns 400 for malformed JSON, 404 for a missing snapshot, 422 for corruption and 409 during Replay", async () => {
    expect((await POST(new Request("http://localhost/api/evaluations", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await POST(post({ ...body, datasetId: `sha256:${"0".repeat(64)}` }))).status).toBe(404);
    writeFileSync(datasetSnapshotPath(body.datasetId), "{}");
    expect((await POST(post(body))).status).toBe(422);
    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay" });
    expect((await POST(post(body))).status).toBe(409);
    expect(listExperiments()).toEqual([]);
  });
});
