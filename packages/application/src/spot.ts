import { spotPortfolio, type ExchangeId, type PaperOrderSide } from "@newbeing/core";
import { getExchangeAdapter, type ExchangeAdapter } from "@newbeing/market-data";
import { assertSpotPaperMutationAllowed, beginSpotIntent, cancelSpotIntent, finalizeSpotIntent, getSpotAccount, markSpotIntentUnknown, openSpotAccount } from "@newbeing/storage";
import { PAPER_MAX_QUOTE_AGE_MS } from "./paper.js";
export { SpotReplayBlockedError } from "@newbeing/storage";

export interface SharedSpotOrderRequest { exchange: ExchangeId; symbol: string; clientOrderId: string; side: PaperOrderSide; quantity: number; maximumPrice: number }
export function assertSharedSpotAvailable(): void {
  assertSpotPaperMutationAllowed();
}

export function readSharedSpotAccount(exchange: ExchangeId, quote: string) {
  assertSharedSpotAvailable();
  return getSpotAccount(exchange, quote);
}

export function openSharedSpotAccount(exchange: ExchangeId, quote: string) {
  assertSharedSpotAvailable();
  return openSpotAccount(exchange, quote);
}

export function cancelSharedSpotIntent(exchange: ExchangeId, quote: string, orderId: string) {
  assertSharedSpotAvailable();
  return cancelSpotIntent(exchange, quote, orderId);
}

export async function executeSharedSpotOrder(request: SharedSpotOrderRequest, adapter: ExchangeAdapter = getExchangeAdapter(request.exchange)) {
  assertSharedSpotAvailable();
  if (adapter.id !== request.exchange || !adapter.getInstrument) throw new Error("A matching spot instrument connector is required.");
  const quote = request.symbol.split("/")[1] ?? "";
  const account = getSpotAccount(request.exchange, quote);
  if (!account) throw new Error("Explicitly open a shared spot account first; legacy assets remain separate.");
  const existing = account.orders.find((order) => order.clientOrderId === request.clientOrderId);
  if (existing) {
    if (existing.symbol !== request.symbol || existing.side !== request.side || existing.quantity !== request.quantity || existing.maximumPrice !== request.maximumPrice) throw new Error("Client order ID already used with different parameters.");
    return { account, order: existing, portfolio: spotPortfolio(account, request.symbol), deduplicated: true };
  }
  const instrument = await adapter.getInstrument(request.symbol);
  if (!instrument.active || instrument.marketType !== "spot" || instrument.symbol !== request.symbol || instrument.venue !== request.exchange || !instrument.nativeId || instrument.id !== `${request.exchange}:spot:${encodeURIComponent(instrument.nativeId)}` || `${instrument.base}/${instrument.quote}` !== request.symbol) throw new Error("Only active native spot instruments are supported.");
  assertSharedSpotAvailable();
  const intent = beginSpotIntent(request.exchange, quote, request, request.maximumPrice);
  if (intent.result.deduplicated) return { account: intent.account, order: intent.result.order, portfolio: spotPortfolio(intent.account, request.symbol), deduplicated: true };
  try {
    const ticker = await adapter.fetchSummary(request.symbol);
    const price = request.side === "buy" ? ticker.ask ?? ticker.last : ticker.bid ?? ticker.last;
    const age = Date.now() - (ticker.timestamp ?? NaN);
    if (ticker.symbol !== request.symbol || price === null || !Number.isFinite(price) || price <= 0 || !Number.isFinite(age) || age < 0 || age > PAPER_MAX_QUOTE_AGE_MS) throw new Error("Market quote is stale, mismatched or invalid.");
    assertSharedSpotAvailable();
    const fill = finalizeSpotIntent(request.exchange, quote, request.clientOrderId, price);
    return { account: fill.account, order: fill.result, portfolio: spotPortfolio(fill.account, request.symbol), deduplicated: false };
  } catch (error) {
    const unknown = markSpotIntentUnknown(request.exchange, quote, request.clientOrderId);
    return { account: unknown.account, order: unknown.result, portfolio: spotPortfolio(unknown.account, request.symbol), deduplicated: false, error: error instanceof Error ? error.message : "Shared spot settlement is unknown; reservation retained." };
  }
}
