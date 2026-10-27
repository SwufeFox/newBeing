import { getExchangeAdapter, type ExchangeAdapter } from "@newbeing/market-data";
import {
  beginPaperIntent,
  claimOrderPreview,
  getPaperOrder,
  finalizePaperFill,
  getPaperPortfolio,
  markPaperIntentSubmitted,
  markPaperIntentUnknown,
  paperAccountId,
} from "@newbeing/storage";
import { SIMULATION_PRECISION, type ExchangeId, type PaperOrder, type PaperOrderSide, type PaperPortfolio } from "@newbeing/core";

export interface ExecutePaperOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
  /** Venue whose prices fill the order and whose namespace holds the account.
   *  Optional so existing callers keep their Binance behaviour. */
  exchange?: ExchangeId;
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

  return settlePaperOrder(request, dependencies);
}

async function settlePaperOrder(request: ExecutePaperOrderRequest, dependencies: PaperExecutionDependencies): Promise<ExecutePaperOrderResult> {
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
  marketAdapter: ExchangeAdapter = getExchangeAdapter(request.exchange ?? "binance"),
): Promise<ExecutePaperOrderResult> {
  if (marketAdapter.id !== (request.exchange ?? "binance")) throw new Error("Paper adapter venue mismatch.");
  return executePaperOrderWithDependencies(request, paperDependencies(request, marketAdapter));
}

function paperDependencies(request: ExecutePaperOrderRequest, marketAdapter: ExchangeAdapter): PaperExecutionDependencies {
  /* Price source and account namespace must name the same venue: filling a
     Kraken order at Binance's price and booking it to Binance's account would
     make the paper book meaningless. */
  const exchange = request.exchange ?? "binance";
  return {
    beginIntent: (order) => beginPaperIntent(order, paperAccountId(order.symbol, exchange)),
    markSubmitted: markPaperIntentSubmitted,
    fetchReferencePrice: async (symbol, side) => {
      const ticker = await marketAdapter.fetchSummary(symbol);
      if (ticker.symbol !== symbol.trim().toUpperCase()) throw new Error("Market quote symbol does not match the paper order.");
      const reference = side === "buy" ? (ticker.ask ?? ticker.last) : (ticker.bid ?? ticker.last);
      if (reference === null || reference <= 0) throw new Error("Ticker did not contain a valid bid, ask or last price.");
      return { price: reference, timestamp: ticker.timestamp };
    },
    now: Date.now,
    maxQuoteAgeMs: PAPER_MAX_QUOTE_AGE_MS,
    /* Every portfolio read and write must name the same account as the intent
       above. Letting these fall back to the default venue meant a non-Binance
       order was booked against a Binance-namespaced account and then read back
       from a different one, which surfaced as "Paper account not found". */
    finalize: (clientOrderId, price) => finalizePaperFill(clientOrderId, price, paperAccountId(request.symbol, exchange)),
    markUnknown: (clientOrderId) => ({
      order: markPaperIntentUnknown(clientOrderId),
      portfolio: getPaperPortfolio(paperAccountId(request.symbol, exchange)),
    }),
    readPortfolio: (symbol) => getPaperPortfolio(paperAccountId(symbol, exchange)),
  };
}

export async function resolvePaperPreview(id: string, action: "confirm" | "dismiss", adapterFor: (exchange: ExchangeId) => ExchangeAdapter = getExchangeAdapter) {
  const claim = claimOrderPreview(id, action);
  const preview = claim.preview;
  if (!claim.claimed) {
    const order = preview.orderId ? getPaperOrder(preview.orderId) : undefined;
    const ambiguous = order && ["created", "submitted", "unknown"].includes(order.status);
    return { preview, order: order ?? null, deduplicated: true, simulationPrecision: SIMULATION_PRECISION,
      ...(ambiguous ? { error: "Saved confirmation is pending or unknown; no second execution was attempted.", retrySafe: false as const } : {}) };
  }
  const request: ExecutePaperOrderRequest = { clientOrderId: preview.orderId!, symbol: preview.symbol, side: preview.side, quantity: preview.quantity, exchange: preview.exchange! };
  try {
    const adapter = adapterFor(preview.exchange!);
    if (adapter.id !== preview.exchange) throw new Error("Paper adapter venue mismatch.");
    const result = await settlePaperOrder(request, paperDependencies(request, adapter));
    return { preview, ...result, simulationPrecision: SIMULATION_PRECISION };
  } catch (error) {
    // The claim is durable even if adapter construction fails. Never reopen it.
    const order = markPaperIntentUnknown(request.clientOrderId);
    return { preview, order, deduplicated: false, error: error instanceof Error ? error.message : "Paper confirmation failed.", retrySafe: false as const, simulationPrecision: SIMULATION_PRECISION };
  }
}
