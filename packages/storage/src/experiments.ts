import { desc, eq, sql } from "drizzle-orm";
import type { BacktestResult } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { experiments } from "./schema.js";

export function saveExperiment(result: BacktestResult): void {
  getDatabase().insert(experiments).values({
    resultId: result.resultId,
    datasetId: result.datasetId,
    symbol: result.symbol,
    timeframe: result.timeframe,
    strategyId: result.strategyId,
    strategyVersion: result.strategyVersion,
    assumptions: JSON.stringify(result.assumptions),
    result: JSON.stringify(result),
    createdAt: Date.parse(result.createdAt),
  }).run();
}

export function getExperiment(resultId: string): BacktestResult | undefined {
  const row = getDatabase().select({ result: experiments.result }).from(experiments)
    .where(eq(experiments.resultId, resultId)).get();
  if (!row?.result) return undefined;
  try {
    return JSON.parse(row.result) as BacktestResult;
  } catch {
    return undefined;
  }
}

export interface ExperimentSummary {
  resultId: string;
  strategyId: string;
  createdAt: string;
  symbol: string;
  timeframe: string;
  metrics: {
    totalReturn: number | null;
    maxDrawdown: number | null;
    tradeCount: number | null;
    sharpeRatio: number | null;
    winRate: number | null;
  };
}

export function listExperimentSummaries(limit = 20): ExperimentSummary[] {
  const rows = getDatabase().select({
    resultId: experiments.resultId,
    strategyId: experiments.strategyId,
    createdAt: experiments.createdAt,
    symbol: experiments.symbol,
    timeframe: experiments.timeframe,
    totalReturn: sql<number | null>`CASE WHEN json_valid(${experiments.result}) THEN json_extract(${experiments.result}, '$.metrics.totalReturn') END`,
    maxDrawdown: sql<number | null>`CASE WHEN json_valid(${experiments.result}) THEN json_extract(${experiments.result}, '$.metrics.maxDrawdown') END`,
    tradeCount: sql<number | null>`CASE WHEN json_valid(${experiments.result}) THEN json_extract(${experiments.result}, '$.metrics.tradeCount') END`,
    sharpeRatio: sql<number | null>`CASE WHEN json_valid(${experiments.result}) THEN json_extract(${experiments.result}, '$.metrics.sharpeRatio') END`,
    winRate: sql<number | null>`CASE WHEN json_valid(${experiments.result}) THEN json_extract(${experiments.result}, '$.metrics.winRate') END`,
  }).from(experiments).where(sql`json_valid(${experiments.result})`)
    .orderBy(desc(experiments.createdAt)).limit(Math.max(1, Math.min(100, limit))).all();

  return rows.map(({ resultId, strategyId, createdAt, symbol, timeframe, totalReturn, maxDrawdown, tradeCount, sharpeRatio, winRate }) => ({
    resultId,
    strategyId,
    createdAt: new Date(createdAt).toISOString(),
    symbol,
    timeframe,
    metrics: { totalReturn, maxDrawdown, tradeCount, sharpeRatio, winRate },
  }));
}

export function listExperiments(limit = 20): BacktestResult[] {
  return getDatabase().select({ result: experiments.result }).from(experiments)
    .orderBy(desc(experiments.createdAt)).limit(Math.max(1, Math.min(100, limit))).all()
    .flatMap((row) => {
      try {
        return row.result ? [JSON.parse(row.result) as BacktestResult] : [];
      } catch {
        return [];
      }
    });
}
