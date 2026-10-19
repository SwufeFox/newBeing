import { createHash, randomUUID } from "node:crypto";
import { getStrategy, runBacktest, type BacktestConfig, type BacktestResult, type StrategyParameters } from "@newbeing/core";
import { findCandleGaps, getExchangeAdapter, removeFormingCandles, type ExchangeAdapter } from "@newbeing/market-data";
import type { ExchangeId, Timeframe } from "@newbeing/core";
import { getWorkspaceState, saveExperiment, saveWorkspaceState } from "@newbeing/storage";
export * from "./paper.js";
export * from "./replay.js";
export * from "./sweep.js";

export interface ResearchBacktestRequest {
  /** Venue to source candles from. Optional for backwards compatibility;
   *  falls back to the workspace's active exchange. */
  exchange?: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  parameters: StrategyParameters;
  config: BacktestConfig;
  limit?: number;
  openInWorkspace?: boolean;
}

function datasetId(symbol: string, timeframe: Timeframe, candles: readonly { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]): string {
  const digest = createHash("sha256").update(JSON.stringify(candles)).digest("hex").slice(0, 16);
  const first = candles[0]?.timestamp ?? 0;
  const last = candles.at(-1)?.timestamp ?? 0;
  return `${symbol.replaceAll("/", "-")}_${timeframe}_${first}_${last}_${digest}`;
}

export async function runResearchBacktest(
  request: ResearchBacktestRequest,
  dependencies: { marketAdapter?: ExchangeAdapter; candleProvenance?: () => { source: "live" | "local-cache"; cachedAt: string | null; fallback: boolean } | null } = {},
): Promise<BacktestResult> {
  if (getWorkspaceState().state.activeWorkspace === "replay") {
    throw new Error("Backtests are disabled while Replay is active, to avoid exposing future-derived results.");
  }
  const strategy = getStrategy(request.strategyId);
  if (!strategy) throw new Error(`Unknown built-in strategy: ${request.strategyId}`);
  /* One venue for the whole run: sourcing candles from one place and labelling
     the result with another would make the result untraceable. */
  const exchange = request.exchange ?? getWorkspaceState().state.exchange;
  const adapter = dependencies.marketAdapter ?? getExchangeAdapter(exchange);
  const rawCandles = await adapter.fetchOHLCV(request.symbol, request.timeframe, request.limit ?? 600);
  const candles = removeFormingCandles(rawCandles, request.timeframe);
  if (candles.length < 2) throw new Error(`${exchange} returned fewer than two completed bars; no backtest was saved.`);
  const gaps = findCandleGaps(candles, request.timeframe);
  if (gaps.length > 0) {
    throw new Error(`Dataset contains ${gaps.length} missing interval(s). Refresh data or choose another symbol; incomplete data was not backtested.`);
  }
  const result = runBacktest({
    candles,
    symbol: request.symbol,
    timeframe: request.timeframe,
    exchange,
    datasetId: datasetId(request.symbol, request.timeframe, candles),
    strategy,
    parameters: { ...strategy.defaults, ...request.parameters },
    config: request.config,
    resultId: randomUUID(),
  });
  const provenance = dependencies.candleProvenance?.();
  if (provenance) {
    result.candleSource = provenance.source;
    result.candleCache = { fallback: provenance.fallback, cachedAt: provenance.cachedAt };
  }
  saveExperiment(result);
  if (request.openInWorkspace ?? true) {
    const current = getWorkspaceState().state;
    /* Research is the workspace that studies strategies now, so a fresh run
       lands there with its result selected rather than in a retired mode. */
    saveWorkspaceState({ ...current, activeWorkspace: "research", selectedStrategyId: strategy.id, activeBacktestId: result.resultId });
  }
  return result;
}
