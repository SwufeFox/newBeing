import { getBinanceAdapter, type ExchangeAdapter } from "@newbeing/market-data";
import {
  beginPaperIntent,
  finalizePaperFill,
  getPaperPortfolio,
  markPaperIntentSubmitted,
  markPaperIntentUnknown,
  paperAccountId,
} from "@newbeing/storage";
import type { PaperOrder, PaperOrderSide, PaperPortfolio } from "@newbeing/core";

export interface ExecutePaperOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
}

export interface ExecutePaperOrderResult {
  order: PaperOrder;
  portfolio: PaperPortfolio;
  deduplicated: boolean;
  error?: string;
  retrySafe?: false;
}

export const PAPER_MAX_QUOTE_AGE_MS = 30_000;

export interface PaperExecutionDependencies {
  beginIntent: (request: ExecutePaperOrderRequest) => { order: PaperOrder; portfolio: PaperPortfolio; deduplicated: boolean };
  markSubmitted: (clientOrderId: string) => PaperOrder;
  fetchReferencePrice: (symbol: string, side: PaperOrderSide) => Promise<{ price: number; timestamp: number | null }>;
  now: () => number;
  maxQuoteAgeMs: number;
  finalize: (clientOrderId: string, price: number, symbol: string) => { order: PaperOrder; portfolio: PaperPortfolio; deduplicated: boolean; error?: string };
  markUnknown: (clientOrderId: string, symbol: string) => { order: PaperOrder; portfolio: PaperPortfolio };
  readPortfolio: (symbol: string) => PaperPortfolio;
}

export async function executePaperOrderWithDependencies(
  request: ExecutePaperOrderRequest,
  dependencies: PaperExecutionDependencies,
): Promise<ExecutePaperOrderResult> {
  const intent = dependencies.beginIntent(request);
  if (intent.deduplicated) {
    const ambiguous = intent.order.status === "unknown" || intent.order.status === "submitted" || intent.order.status === "created";
    return {
      order: intent.order,
      portfolio: intent.portfolio,
      deduplicated: true,
      ...(ambiguous ? { error: "Existing order intent was not retried; inspect its saved status.", retrySafe: false as const } : {}),
    };
  }

  const submitted = dependencies.markSubmitted(request.clientOrderId);
  if (submitted.status !== "submitted") {
    return { order: submitted, portfolio: dependencies.readPortfolio(request.symbol), deduplicated: true };
  }

  try {
    const quote = await dependencies.fetchReferencePrice(request.symbol, request.side);
    const ageMs = dependencies.now() - (quote.timestamp ?? Number.NaN);
    if (!Number.isFinite(quote.timestamp) || ageMs < 0 || ageMs > dependencies.maxQuoteAgeMs) {
      throw new Error("Market quote is stale or has an invalid timestamp.");
    }
    const result = dependencies.finalize(request.clientOrderId, quote.price, request.symbol);
    return { ...result, ...(result.error ? { retrySafe: false as const } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper fill could not be established.";
    const marked = dependencies.markUnknown(request.clientOrderId, request.symbol);
    return { ...marked, deduplicated: false, error: message, retrySafe: false };
  }
}

export async function executePaperOrder(
  request: ExecutePaperOrderRequest,
  marketAdapter: ExchangeAdapter = getBinanceAdapter(),
): Promise<ExecutePaperOrderResult> {
  return executePaperOrderWithDependencies(request, {
    beginIntent: (order) => beginPaperIntent(order, paperAccountId(order.symbol)),
    markSubmitted: markPaperIntentSubmitted,
    fetchReferencePrice: async (symbol, side) => {
      const ticker = await marketAdapter.fetchSummary(symbol);
      const reference = side === "buy" ? (ticker.ask ?? ticker.last) : (ticker.bid ?? ticker.last);
      if (reference === null || reference <= 0) throw new Error("Ticker did not contain a valid bid, ask or last price.");
      return { price: reference, timestamp: ticker.timestamp };
    },
    now: Date.now,
    maxQuoteAgeMs: PAPER_MAX_QUOTE_AGE_MS,
    finalize: (clientOrderId, price) => finalizePaperFill(clientOrderId, price),
    markUnknown: (clientOrderId) => ({
      order: markPaperIntentUnknown(clientOrderId),
      portfolio: getPaperPortfolio(paperAccountId(request.symbol)),
    }),
    readPortfolio: (symbol) => getPaperPortfolio(paperAccountId(symbol)),
  });
}
