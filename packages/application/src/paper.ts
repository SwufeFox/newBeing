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

export interface PaperExecutionDependencies {
  beginIntent: (request: ExecutePaperOrderRequest) => { order: PaperOrder; portfolio: PaperPortfolio; deduplicated: boolean };
  markSubmitted: (clientOrderId: string) => PaperOrder;
  fetchReferencePrice: (symbol: string, side: PaperOrderSide) => Promise<number>;
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
    const referencePrice = await dependencies.fetchReferencePrice(request.symbol, request.side);
    const result = dependencies.finalize(request.clientOrderId, referencePrice, request.symbol);
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
      return reference;
    },
    finalize: (clientOrderId, price) => finalizePaperFill(clientOrderId, price),
    markUnknown: (clientOrderId) => ({
      order: markPaperIntentUnknown(clientOrderId),
      portfolio: getPaperPortfolio(paperAccountId(request.symbol)),
    }),
    readPortfolio: (symbol) => getPaperPortfolio(paperAccountId(symbol)),
  });
}
