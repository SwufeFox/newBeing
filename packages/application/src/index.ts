import { randomUUID } from "node:crypto";
import { getStrategy, runBacktest, type BacktestConfig, type BacktestResult, type StrategyParameters } from "@newbeing/core";
import { findCandleGaps, getExchangeAdapter, removeFormingCandles, type ExchangeAdapter } from "@newbeing/market-data";
import type { ExchangeId, Timeframe } from "@newbeing/core";
import { getExperiment, getWorkspaceState, identifyDataset, saveDatasetSnapshot, saveResearchResults, saveWorkspaceState } from "@newbeing/storage";
import { assertResearchAvailable, originalResearchInput, reproductionFor, ResearchError, resolveResearchStrategy } from "./research-inputs.js";
export { ResearchError } from "./research-inputs.js";
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


export async function runResearchBacktest(
  request: ResearchBacktestRequest,
  dependencies: { marketAdapter?: ExchangeAdapter; candleProvenance?: () => { source: "live" | "local-cache"; cachedAt: string | null; fallback: boolean } | null } = {},
): Promise<BacktestResult> {
  assertResearchAvailable();
  const { strategy, parameters } = resolveResearchStrategy(request.strategyId, request.parameters);
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
    datasetId: identifyDataset({ exchange, symbol: request.symbol, timeframe: request.timeframe, candles }).datasetId,
    strategy,
    parameters,
    config: request.config,
    resultId: randomUUID(),
  });
  const provenance = dependencies.candleProvenance?.();
  if (provenance) {
    result.candleSource = provenance.source;
    result.candleCache = { fallback: provenance.fallback, cachedAt: provenance.cachedAt };
  }
  saveDatasetSnapshot({ exchange, symbol: request.symbol, timeframe: request.timeframe, candles });
  result.reproduction = reproductionFor(result.datasetId);
  saveResearchResults([result]);
  if (request.openInWorkspace ?? true) {
    const current = getWorkspaceState().state;
    /* Research is the workspace that studies strategies now, so a fresh run
       lands there with its result selected rather than in a retired mode. */
    saveWorkspaceState({ ...current, activeWorkspace: "research", selectedStrategyId: strategy.id, activeBacktestId: result.resultId });
  }

  return result;
}

/** A new result ID and timestamp; all computational inputs come from the saved record. */
export function rerunResearchBacktest(id: string): BacktestResult {
  assertResearchAvailable();
  const saved = getExperiment(id);
  if (!saved) throw new ResearchError("Backtest result not found.", 404);
  const { strategy, snapshot, reproduction } = originalResearchInput(saved);
  const result = runBacktest({ candles: snapshot.candles, exchange: snapshot.exchange, symbol: snapshot.symbol, timeframe: snapshot.timeframe, datasetId: saved.datasetId, strategy, parameters: saved.parameters, config: saved.assumptions, resultId: randomUUID() });
  result.reproduction = reproduction;
  result.rerunOf = id;
  saveResearchResults([result]);
  return result;
}
