import type { BacktestResult } from "@newbeing/core";

export const RESEARCH_REPORT_SCHEMA_VERSION = 1;

export interface ResearchReportExport {
  schemaVersion: typeof RESEARCH_REPORT_SCHEMA_VERSION;
  kind: "newbeing-research-report";
  exportedAt: string;
  provenance: {
    resultId: string;
    datasetId: string;
    exchange: string;
    symbol: string;
    timeframe: string;
    strategyId: string;
    strategyVersion: string;
    engineVersion: string;
    createdAt: string;
    /** Revealed range of the run, derived from the equity curve. */
    barRange: { startAt: number; endAt: number; bars: number } | null;
    /** Absent on legacy records: those inputs cannot be re-derived. */
    reproduction: BacktestResult["reproduction"];
    executionPolicy: BacktestResult["executionPolicy"] | null;
  };
  /** The immutable saved result: config, metrics, trades, equity curve, signals. */
  result: BacktestResult;
  limitations: string[];
}

/** Build the versioned export envelope around a saved backtest result. */
export function buildResearchReport(result: BacktestResult, exportedAt = new Date().toISOString()): ResearchReportExport {
  const first = result.equityCurve[0];
  const last = result.equityCurve.at(-1);
  const limitations = [
    "Paper-only simulation: orders never reach an exchange; fills are modeled at the next bar open with slippage, fees and deterministic rules.",
    "Results apply only to the saved dataset range identified by datasetId; they describe that past window and are not a forecast.",
    "The candle dataset is not embedded in this file; reproduce it from the same venue and range, or re-run the saved inputs deterministically.",
  ];
  if (!result.reproduction) {
    limitations.push("This result predates reproducible-input metadata (no reproduction block); it cannot be deterministically re-run.");
  }
  return {
    schemaVersion: RESEARCH_REPORT_SCHEMA_VERSION,
    kind: "newbeing-research-report",
    exportedAt,
    provenance: {
      resultId: result.resultId,
      datasetId: result.datasetId,
      exchange: result.exchange,
      symbol: result.symbol,
      timeframe: result.timeframe,
      strategyId: result.strategyId,
      strategyVersion: result.strategyVersion,
      engineVersion: result.engineVersion,
      createdAt: result.createdAt,
      barRange: first && last ? { startAt: first.timestamp, endAt: last.timestamp, bars: result.equityCurve.length } : null,
      reproduction: result.reproduction,
      executionPolicy: result.executionPolicy ?? null,
    },
    result,
    limitations,
  };
}

export function researchReportFilename(result: BacktestResult): string {
  return `research-${result.strategyId}-${result.symbol.replace("/", "")}-${result.createdAt.slice(0, 10)}-${result.resultId.slice(0, 8)}.json`;
}
