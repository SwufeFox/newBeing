import { LedgerValidationError, quantityUnits, subtractQuantity, validateMoney, decimal, money } from "./ledger.js";
import type { Candle, ExchangeId } from "./types.js";
import { fillPaperOrder, type PaperPortfolio } from "./paper.js";

export interface InstrumentIdentity {
  id: string;
  venue: ExchangeId;
  nativeId: string;
  symbol: string;
  base: string;
  quote: string;
  marketType: "spot";
}
export function instrumentId(venue: ExchangeId, nativeId: string): string {
  if (!nativeId) throw new Error("A venue native instrument ID is required.");
  return `${venue}:spot:${encodeURIComponent(nativeId)}`;
}
export interface AccountIdentity {
  id: string;
  venue: ExchangeId;
  mode: "paper" | "replay";
  quote: string;
}
export interface ReplayConfig {
  initialCapital: number;
  feeRate: number;
  slippageRate: number;
}
export interface ReplayOrderInput {
  clientOrderId: string;
  side: "buy" | "sell";
  quantity: number;
  type: "market" | "limit" | "stop";
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
}
export interface ReplayOrder extends ReplayOrderInput {
  accountId: string;
  instrumentId: string;
  submittedAt: number;
  status: "submitted" | "filled" | "cancelled" | "rejected";
  fillPrice: number | null;
  fee: number;
  createdAt: string;
  error?: string;
}
export interface ReplayFill {
  id: string;
  orderId: string;
  accountId: string;
  instrumentId: string;
  timestamp: number;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  reason: "order" | "stop-loss" | "take-profit";
}
export interface ReplayExecution {
  version: 1;
  simulationPrecision?: typeof import("./ledger.js").SIMULATION_PRECISION;
  revision: number;
  account: AccountIdentity;
  instrument: InstrumentIdentity;
  config: ReplayConfig;
  portfolio: PaperPortfolio;
  orders: ReplayOrder[];
  fills: ReplayFill[];
  brackets: Array<{ orderId: string; quantity: number; stopLoss?: number; takeProfit?: number; openedAt: number }>;
  equity: Array<{ timestamp: number; equity: number }>;
  notes: string;
  tags: string[];
}
export const REPLAY_FILL_POLICY = "Orders become eligible on the next bar only. Market fills at open; limits require a touch and receive no better than the limit; stop gaps fill at the adverse open. Adverse slippage and quote fees apply, with limit prices capped. FIFO, full fills or balance rejection; no volume/liquidity model. Long spot only. Brackets use stop-first and adverse gap opens. Gaps that place SL at/above or TP at/below the actual entry fill reject the entry without a fill. New entries can stop out on their entry bar; targets activate on the following bar. Finish cancels pending orders and marks open inventory, without forced liquidation.";
export function validateReplayConfig(config: ReplayConfig): void {
  validateMoney(config.initialCapital);
  if (!Number.isFinite(config.initialCapital) || config.initialCapital <= 0 || config.initialCapital > 1e12
    || !Number.isFinite(config.feeRate) || config.feeRate < 0 || config.feeRate > 0.05
    || !Number.isFinite(config.slippageRate) || config.slippageRate < 0 || config.slippageRate > 0.05) throw new Error("Invalid Replay configuration.");
}
export function submitReplayOrder(state: ReplayExecution, input: ReplayOrderInput, cursor: number): void {
  const existing = state.orders.find((order) => order.clientOrderId === input.clientOrderId);
  if (existing) {
    const original = { clientOrderId: existing.clientOrderId, side: existing.side, quantity: existing.quantity, type: existing.type, price: existing.price, stopLoss: existing.stopLoss, takeProfit: existing.takeProfit };
    if (JSON.stringify(original) !== JSON.stringify({ clientOrderId: input.clientOrderId, side: input.side, quantity: input.quantity, type: input.type, price: input.price, stopLoss: input.stopLoss, takeProfit: input.takeProfit })) throw new Error("Client order ID already used with different parameters.");
    return;
  }
  if (!input.clientOrderId || input.clientOrderId.length > 160 || !["buy", "sell"].includes(input.side) || !["market", "limit", "stop"].includes(input.type)
    || !Number.isFinite(input.quantity) || input.quantity <= 0 || input.quantity > 1e6) throw new Error("Invalid Replay order.");
  for (const value of [input.price, input.stopLoss, input.takeProfit]) if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error("Order prices must be positive and finite.");
  if (input.type !== "market" && input.price === undefined) throw new Error("Limit/stop price is required.");
  if (input.type === "market" && input.price !== undefined) throw new Error("Market orders cannot specify a price.");
  if (input.side === "sell" && (input.stopLoss !== undefined || input.takeProfit !== undefined)) throw new Error("SL/TP are supported on long entries only.");
  if (input.stopLoss !== undefined && input.takeProfit !== undefined && input.stopLoss >= input.takeProfit) throw new Error("SL must be below TP.");
  quantityUnits(input.quantity);
  state.orders.push({ ...input, accountId: state.account.id, instrumentId: state.instrument.id, submittedAt: cursor, status: "submitted", fillPrice: null, fee: 0, createdAt: new Date(cursor).toISOString() });
}
function reduceBrackets(state: ReplayExecution, quantity: number): void {
  for (const bracket of state.brackets) {
    const used = Math.min(quantity, bracket.quantity);
    bracket.quantity = subtractQuantity(bracket.quantity, used);
    quantity = subtractQuantity(quantity, used);
  }
  state.brackets = state.brackets.filter((bracket) => bracket.quantity > 0);
}
function fillPrice(state: ReplayExecution, side: "buy" | "sell", rawPrice: number, limit?: number): number {
  const price = rawPrice * (1 + (side === "buy" ? 1 : -1) * state.config.slippageRate);
  return limit === undefined ? price : side === "buy" ? Math.min(price, limit) : Math.max(price, limit);
}
function applyFill(state: ReplayExecution, orderId: string, side: "buy" | "sell", quantity: number, rawPrice: number, bar: Candle, reason: ReplayFill["reason"], limit?: number): { price: number; fee: number } {
  const price = fillPrice(state, side, rawPrice, limit);
  const result = fillPaperOrder({ clientOrderId: orderId, symbol: state.instrument.symbol, side, quantity, status: "submitted", fillPrice: null, fee: 0, createdAt: new Date(bar.timestamp).toISOString() }, state.portfolio, price);
  state.portfolio = result.portfolio;
  state.fills.push({ id: `${orderId}:${bar.timestamp}:${reason}`, orderId, accountId: state.account.id, instrumentId: state.instrument.id, timestamp: bar.timestamp, side, quantity, price, fee: result.order.fee, reason });
  return { price, fee: result.order.fee };
}
function runBrackets(state: ReplayExecution, bar: Candle): void {
  for (const bracket of [...state.brackets]) {
    const stop = bracket.stopLoss !== undefined && bar.low <= bracket.stopLoss;
    const target = bracket.openedAt < bar.timestamp && bracket.takeProfit !== undefined && bar.high >= bracket.takeProfit;
    if (!stop && !target) continue;
    const price = stop ? Math.min(bar.open, bracket.stopLoss!) : Math.max(bar.open, bracket.takeProfit!);
    applyFill(state, bracket.orderId, "sell", bracket.quantity, price, bar, stop ? "stop-loss" : "take-profit");
    bracket.quantity = 0;
  }
  state.brackets = state.brackets.filter((bracket) => bracket.quantity > 0);
}
export function matchReplayBar(state: ReplayExecution, bar: Candle): void {
  if (![bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || bar.low <= 0 || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) || bar.volume < 0) throw new Error("Invalid Replay OHLCV bar.");
  runBrackets(state, bar);
  for (const order of state.orders) {
    if (order.status !== "submitted" || order.submittedAt >= bar.timestamp) continue;
    const buy = order.side === "buy";
    if (order.type === "limit" && !(buy ? bar.low <= order.price! : bar.high >= order.price!)) continue;
    if (order.type === "stop" && !(buy ? bar.high >= order.price! : bar.low <= order.price!)) continue;
    let raw = order.type === "limit" ? order.price! : bar.open;
    if (order.type === "stop") raw = buy ? Math.max(bar.open, order.price!) : Math.min(bar.open, order.price!);
    const entryPrice = fillPrice(state, order.side, raw, order.type === "limit" ? order.price : undefined);
    if (buy && ((order.stopLoss !== undefined && order.stopLoss >= entryPrice) || (order.takeProfit !== undefined && order.takeProfit <= entryPrice))) {
      order.status = "rejected";
      order.error = "Bracket prices must surround the actual entry fill; gaps can invalidate an entry.";
      continue;
    }
    let fill: { price: number; fee: number };
    try {
      fill = applyFill(state, order.clientOrderId, order.side, order.quantity, raw, bar, "order", order.type === "limit" ? order.price : undefined);
    } catch (error) {
      if (!(error instanceof LedgerValidationError) && (!(error instanceof Error) || !error.message.startsWith("Insufficient paper"))) throw error;
      order.status = "rejected";
      order.error = error.message;
      continue;
    }
    order.status = "filled";
    order.fillPrice = fill.price;
    order.fee = fill.fee;
    if (buy) {
      // Track all inventory lots so manual partial closes reduce protected lots correctly.
      state.brackets.push({ orderId: order.clientOrderId, quantity: order.quantity, openedAt: bar.timestamp, ...(order.stopLoss !== undefined ? { stopLoss: order.stopLoss } : {}), ...(order.takeProfit !== undefined ? { takeProfit: order.takeProfit } : {}) });
      runBrackets(state, bar);
    } else reduceBrackets(state, order.quantity);
  }
  state.equity.push({ timestamp: bar.timestamp, equity: money(decimal(state.portfolio.quoteBalance).plus(decimal(state.portfolio.baseBalance).times(bar.close))) });
}
export function replayReport(state: ReplayExecution, mark: number) {
  const equity = money(decimal(state.portfolio.quoteBalance).plus(decimal(state.portfolio.baseBalance).times(mark)));
  let peak = state.config.initialCapital;
  let maxDrawdown = 0;
  for (const point of state.equity) { peak = Math.max(peak, point.equity); maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak); }
  return { initialCapital: state.config.initialCapital, equity, netPnl: money(decimal(equity).minus(state.config.initialCapital)), realizedPnl: state.portfolio.realizedPnl, unrealizedPnl: money(decimal(state.portfolio.baseBalance).times(mark).minus(state.portfolio.costBasis ?? decimal(state.portfolio.baseBalance).times(state.portfolio.averageEntryPrice ?? mark))), fees: money(state.fills.reduce((sum, fill) => sum.plus(fill.fee), decimal(0))), fillCount: state.fills.length, maxDrawdown, notes: state.notes, tags: state.tags, policy: REPLAY_FILL_POLICY };
}
