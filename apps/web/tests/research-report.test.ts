import { describe, expect, it } from "vitest";
import type { BacktestResult } from "@newbeing/core";
import { buildResearchReport, researchReportFilename } from "../src/lib/research-report.js";

const result: BacktestResult = {
  resultId: "11111111-2222-3333-4444-555555555555",
  datasetId: "sha256:" + "a".repeat(64),
  exchange: "binance",
  symbol: "BTC/USDT",
  timeframe: "1h",
  strategyId: "sma-crossover",
  strategyVersion: "1.0.0",
  parameters: { fastPeriod: 5, slowPeriod: 15 },
  assumptions: { initialCapital: 10_000, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false },
  execution: { fillTiming: "next-bar-open" } as BacktestResult["execution"],
  engineVersion: "test-engine",
  createdAt: "2026-11-03T10:00:00.000Z",
  metrics: { totalReturn: 0.12, maxDrawdown: 0.05, tradeCount: 2 },
  equityCurve: [
    { timestamp: 1_000, equity: 10_000 },
    { timestamp: 2_000, equity: 10_500 },
    { timestamp: 3_000, equity: 11_200 },
  ],
  trades: [],
  signals: [],
  reproduction: { format: 1, snapshotId: "sha256:" + "b".repeat(64), implementationHash: "abc" },
};

describe("research report export", () => {
  it("wraps a saved result in a versioned envelope with provenance and limitations", () => {
    const report = buildResearchReport(result, "2026-11-03T12:00:00.000Z");
    expect(report.schemaVersion).toBe(1);
    expect(report.kind).toBe("newbeing-research-report");
    expect(report.exportedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(report.provenance).toMatchObject({
      resultId: result.resultId,
      datasetId: result.datasetId,
      exchange: "binance",
      symbol: "BTC/USDT",
      timeframe: "1h",
      barRange: { startAt: 1_000, endAt: 3_000, bars: 3 },
      reproduction: result.reproduction,
    });
    expect(report.result).toBe(result);
    expect(report.limitations).toHaveLength(3);
  });

  it("flags legacy results without reproducible inputs", () => {
    const legacy = buildResearchReport({ ...result, reproduction: undefined });
    expect(legacy.provenance.reproduction).toBeUndefined();
    expect(legacy.limitations.some((line) => line.includes("cannot be deterministically re-run"))).toBe(true);
  });

  it("derives a stable download filename", () => {
    expect(researchReportFilename(result)).toBe("research-sma-crossover-BTCUSDT-2026-11-03-11111111.json");
  });
});
