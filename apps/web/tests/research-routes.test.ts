import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_STATE, type BacktestResult, type BacktestSweepResult, type Candle } from "@newbeing/core";
import { closeDatabaseForTests, datasetSnapshotPath, getExperiment, saveExperiment, saveWorkspaceState } from "@newbeing/storage";
const fixture = vi.hoisted(() => ({ fetch: vi.fn(), bars: [] as Candle[] }));
vi.mock("@newbeing/market-data", async (importOriginal) => importOriginal<typeof import("@newbeing/market-data")>());
vi.mock("@/lib/market-adapter", () => ({ getWebMarketAdapter: (id: string) => ({ id, fetchOHLCV: fixture.fetch, fetchOHLCVSince: fixture.fetch, searchSymbols: vi.fn(), fetchSummary: vi.fn(), fetchSummaries: vi.fn(), fetchOrderBook: vi.fn(), fetchRecentTrades: vi.fn(), close: vi.fn() }) }));
import { POST as createRun, GET as listRuns } from "../src/app/api/backtests/route.js";
import { GET as getRun } from "../src/app/api/backtests/[id]/route.js";
import { POST as rerun } from "../src/app/api/backtests/[id]/rerun/route.js";
import { POST as createSweep, GET as listSweeps } from "../src/app/api/sweeps/route.js";
import { GET as getSweep } from "../src/app/api/sweeps/[id]/route.js";
import { POST as rerunSweep } from "../src/app/api/sweeps/[id]/rerun/route.js";
const body = { exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", strategyId: "momentum-reversal", parameters: { lookback: 2, thresholdPct: 1 }, config: { initialCapital: 1000, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false }, limit: 50 };
const sweepBody = { ...body, parameter: "thresholdPct", from: 0.05, to: 0.35, step: 0.1 };
const post = (url: string, data: unknown = {}) => new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
let directory: string;
beforeEach(() => {
  closeDatabaseForTests(); directory = mkdtempSync(path.join(tmpdir(), "newbeing-research-routes-")); process.env.NEWBEING_DATA_DIR = directory;
  fixture.bars = Array.from({ length: 50 }, (_, i) => {
    const close = 100 + (i % 7) * 2;
    return { timestamp: i * 60_000, open: close, high: close + 1, low: close - 1, close, volume: i + 1 };
  });
  fixture.fetch.mockImplementation(async () => structuredClone(fixture.bars));
  vi.spyOn(Date, "now").mockReturnValue(50 * 60_000);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); closeDatabaseForTests(); delete process.env.NEWBEING_DATA_DIR; rmSync(directory, { recursive: true, force: true }); });

describe("research HTTP contracts", () => {
  it("creates, lists, retrieves and reruns full saved data without contacting the adapter", async () => {
    const response = await createRun(post("/api/backtests", body));
    expect(response.status).toBe(201); expect(response.headers.get("Cache-Control")).toBe("no-store");
    const original = await response.json() as BacktestResult;
    expect(original.datasetId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await (await listRuns(new Request("http://localhost/api/backtests"))).json()).items).toEqual([original]);
    expect(await (await getRun(new Request("http://localhost"), context(original.resultId))).json()).toEqual(original);
    fixture.bars = []; fixture.fetch.mockRejectedValue(new Error("network disabled")); fixture.fetch.mockClear();
    const replayed = await rerun(post("/api/backtests/id/rerun"), context(original.resultId));
    expect(replayed.status).toBe(201);
    const saved = await replayed.json() as BacktestResult;
    expect(saved.rerunOf).toBe(original.resultId);
    expect(saved.parameters).toEqual(original.parameters); expect(saved.assumptions).toEqual(original.assumptions);
    expect(saved.metrics).toEqual(original.metrics); expect(saved.trades).toEqual(original.trades); expect(saved.signals).toEqual(original.signals); expect(saved.equityCurve).toEqual(original.equityCurve);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("persists sweep values, metrics, and bound full runs and reruns them offline", async () => {
    const response = await createSweep(post("/api/sweeps", sweepBody)); expect(response.status).toBe(201);
    const original = await response.json() as BacktestSweepResult;
    expect(original.values).toEqual([0.05, 0.15, 0.25, 0.35]);
    expect(await (await getSweep(new Request("http://localhost"), context(original.sweepId))).json()).toEqual(original);
    expect((await (await listSweeps(new Request("http://localhost/api/sweeps?limit=1"))).json()).items).toEqual([original]);
    fixture.fetch.mockRejectedValue(new Error("network disabled")); fixture.fetch.mockClear();
    const response2 = await rerunSweep(post("/api/sweeps/id/rerun"), context(original.sweepId)); expect(response2.status).toBe(201);
    const saved = await response2.json() as BacktestSweepResult;
    expect(saved.values).toEqual(original.values); expect(saved.rerunOf).toBe(original.sweepId);
    for (const [i, run] of saved.runs.entries()) {
      expect(run.metrics).toEqual(original.runs[i]!.metrics);
      expect(getExperiment(run.resultId)!.trades).toEqual(getExperiment(original.runs[i]!.resultId)!.trades);
      expect(getExperiment(run.resultId)!.equityCurve).toEqual(getExperiment(original.runs[i]!.resultId)!.equityCurve);
    }
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("uses 400 for malformed bodies/overrides, 404 for unknown IDs, and 422 for unsupported input", async () => {
    expect((await createRun(new Request("http://localhost/api/backtests", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await createSweep(post("/api/sweeps", { ...sweepBody, step: 0 }))).status).toBe(400);
    expect((await createSweep(post("/api/sweeps", { ...sweepBody, to: 100 }))).status).toBe(422);
    expect((await createSweep(post("/api/sweeps", { ...sweepBody, from: 1e16, to: 1e16 + 2, step: 1 }))).status).toBe(422);
    expect((await createRun(post("/api/backtests", { ...body, exchange: "coinbaseexchange", timeframe: "4h" }))).status).toBe(422);
    expect((await rerun(post("/api/backtests/id/rerun", { parameters: {} }), context("missing"))).status).toBe(400);
    expect((await rerun(post("/api/backtests/id/rerun"), context("missing"))).status).toBe(404);
    expect((await getSweep(new Request("http://localhost"), context("missing"))).status).toBe(404);
    expect((await listSweeps(new Request("http://localhost/api/sweeps?limit=0"))).status).toBe(400);
  });
  it("returns 409 for legacy records and replay access; corrupt snapshots return 422", async () => {
    const original = await (await createRun(post("/api/backtests", body))).json() as BacktestResult;
    const { reproduction: _ref, ...legacy } = original;
    saveExperiment({ ...legacy, resultId: "legacy" });
    expect((await rerun(post("/api/backtests/legacy/rerun"), context("legacy"))).status).toBe(409);
    writeFileSync(datasetSnapshotPath(original.datasetId), "{}");
    expect((await rerun(post("/api/backtests/id/rerun"), context(original.resultId))).status).toBe(422);
    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay" });
    expect((await createRun(post("/api/backtests", body))).status).toBe(409);
    expect((await createSweep(post("/api/sweeps", sweepBody))).status).toBe(409);
    expect((await listSweeps(new Request("http://localhost/api/sweeps"))).status).toBe(409);
    expect((await getSweep(new Request("http://localhost"), context("missing"))).status).toBe(409);
    expect((await rerun(post("/api/backtests/id/rerun"), context(original.resultId))).status).toBe(409);
  });
});
