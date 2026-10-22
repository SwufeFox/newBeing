import { LedgerValidationError, addQuantity, decimal, estimatePaperAmounts, money, quantityUnits, subtractQuantity, validateMoney } from "./ledger.js";
import { fillPaperOrder, type PaperOrder, type PaperPortfolio } from "./paper.js";
import { SPOT_EXECUTION_POLICY } from "./policy.js";
import type { ExchangeId } from "./types.js";

export interface SpotBalance { total: number; reserved: number }
export interface SpotOrder extends PaperOrder { accountId: string; reservedAsset: string; reservedAmount: number; maximumPrice: number }
export interface SpotLedgerEntry { id: string; orderId: string | null; asset: string; delta: number; reason: "initial-capital" | "fill"; timestamp: string }
export interface SpotAccount {
  version: 1;
  id: string;
  exchange: ExchangeId;
  quote: string;
  feeRate: number;
  policy: typeof SPOT_EXECUTION_POLICY;
  balances: Record<string, SpotBalance>;
  positions: Record<string, { costBasis: number; realizedPnl: number }>;
  orders: SpotOrder[];
  fills: Array<{ orderId: string; symbol: string; side: "buy" | "sell"; quantity: number; price: number; fee: number; timestamp: string }>;
  ledger: SpotLedgerEntry[];
}
export function spotAccountId(exchange: ExchangeId, quote: string): string {
  if (!["binance", "coinbaseexchange", "okx", "kraken"].includes(exchange) || !/^[A-Z0-9]{2,20}$/.test(quote)) throw new Error("Invalid shared spot account.");
  return `paper:shared-spot:v1:${exchange}:${quote}`;
}
function assets(account: SpotAccount, symbol: string): [string, string] {
  const match = /^([A-Z0-9]{2,20})\/([A-Z0-9]{2,20})$/.exec(symbol);
  if (!match || match[1] === match[2] || match[2] !== account.quote) throw new Error("Shared spot instrument/quote mismatch; derivatives are unsupported.");
  return [match[1]!, match[2]!];
}
export function createSpotAccount(exchange: ExchangeId, quote: string, initialCapital = 10000, feeRate = 0.001, timestamp = new Date().toISOString()): SpotAccount {
  validateMoney(initialCapital);
  if (initialCapital <= 0 || initialCapital > 1e12 || !Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.05) throw new Error("Invalid shared spot configuration.");
  return { version: 1, id: spotAccountId(exchange, quote), exchange, quote, feeRate, policy: SPOT_EXECUTION_POLICY, balances: { [quote]: { total: initialCapital, reserved: 0 } }, positions: {}, orders: [], fills: [], ledger: [{ id: "initial-capital", orderId: null, asset: quote, delta: initialCapital, reason: "initial-capital", timestamp }] };
}
export function spotPortfolio(account: SpotAccount, symbol: string): PaperPortfolio {
  const [base, quote] = assets(account, symbol);
  const baseBalance = account.balances[base]?.total ?? 0;
  const position = account.positions[symbol] ?? { costBasis: 0, realizedPnl: 0 };
  return { quoteBalance: account.balances[quote]!.total, baseBalance, costBasis: position.costBasis, averageEntryPrice: baseBalance > 0 ? decimal(position.costBasis).div(baseBalance).toNumber() : null, realizedPnl: position.realizedPnl, feeRate: account.feeRate };
}
export function reserveSpotOrder(account: SpotAccount, input: Pick<PaperOrder, "clientOrderId" | "symbol" | "side" | "quantity">, maximumPrice: number, timestamp = new Date().toISOString()): SpotOrder {
  const existing = account.orders.find((order) => order.clientOrderId === input.clientOrderId);
  if (existing) {
    if (existing.symbol !== input.symbol || existing.side !== input.side || existing.quantity !== input.quantity || existing.maximumPrice !== maximumPrice) throw new Error("Client order ID already used with different parameters.");
    return existing;
  }
  const [base, quote] = assets(account, input.symbol);
  quantityUnits(input.quantity);
  if (!input.clientOrderId || input.clientOrderId.length > 160 || !["buy", "sell"].includes(input.side) || input.quantity <= 0) throw new Error("Invalid spot order.");
  const amounts = estimatePaperAmounts(maximumPrice, input.quantity, account.feeRate);
  const reservedAsset = input.side === "buy" ? quote : base;
  const reservedAmount = input.side === "buy" ? money(decimal(amounts.notional).plus(amounts.fee)) : input.quantity;
  const balance = account.balances[reservedAsset] ?? { total: 0, reserved: 0 };
  if (decimal(balance.total).minus(balance.reserved).lessThan(reservedAmount)) throw new Error("Insufficient available spot balance.");
  balance.reserved = input.side === "buy" ? money(decimal(balance.reserved).plus(reservedAmount)) : addQuantity(balance.reserved, reservedAmount);
  account.balances[reservedAsset] = balance;
  const order: SpotOrder = { ...input, accountId: account.id, reservedAsset, reservedAmount, maximumPrice, status: "submitted", fillPrice: null, fee: 0, createdAt: timestamp };
  account.orders.push(order);
  return order;
}
export function releaseSpotOrder(account: SpotAccount, orderId: string, status: "cancelled" | "rejected"): SpotOrder {
  const order = account.orders.find((item) => item.clientOrderId === orderId);
  if (!order) throw new Error("Spot order not found.");
  if (!["submitted", "unknown"].includes(order.status)) return order;
  const balance = account.balances[order.reservedAsset]!;
  balance.reserved = order.side === "buy" ? money(decimal(balance.reserved).minus(order.reservedAmount)) : subtractQuantity(balance.reserved, order.reservedAmount);
  order.status = status;
  return order;
}
export function settleSpotOrder(account: SpotAccount, orderId: string, price: number, timestamp = new Date().toISOString()): SpotOrder {
  const order = account.orders.find((item) => item.clientOrderId === orderId);
  if (!order) throw new Error("Spot order not found.");
  if (order.status !== "submitted") return order;
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid spot fill price.");
  if (order.side === "buy" && price > order.maximumPrice) return releaseSpotOrder(account, orderId, "rejected");
  const [base, quote] = assets(account, order.symbol);
  const before = spotPortfolio(account, order.symbol);
  let fill: ReturnType<typeof fillPaperOrder>;
  try {
    fill = fillPaperOrder(order, before, price);
  } catch (error) {
    // No fill has been applied: local precision/balance rejections are final outcomes.
    if (error instanceof LedgerValidationError || (error instanceof Error && error.message.startsWith("Insufficient paper"))) return releaseSpotOrder(account, orderId, "rejected");
    throw error;
  }
  releaseSpotOrder(account, orderId, "cancelled");
  account.balances[quote]!.total = fill.portfolio.quoteBalance;
  account.balances[base] = { total: fill.portfolio.baseBalance, reserved: account.balances[base]?.reserved ?? 0 };
  account.positions[order.symbol] = { costBasis: fill.portfolio.costBasis!, realizedPnl: fill.portfolio.realizedPnl };
  Object.assign(order, fill.order);
  account.fills.push({ orderId, symbol: order.symbol, side: order.side, quantity: order.quantity, price, fee: order.fee, timestamp });
  for (const [asset, delta] of [[quote, money(decimal(fill.portfolio.quoteBalance).minus(before.quoteBalance))], [base, order.side === "buy" ? order.quantity : -order.quantity]] as const) {
    account.ledger.push({ id: `${orderId}:${asset}`, orderId, asset, delta, reason: "fill", timestamp });
  }
  return order;
}
