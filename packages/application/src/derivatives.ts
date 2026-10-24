import { Decimal } from "decimal.js";
import {
  assertDerivativesPaperWorkspace, derivativesAccountId, getDerivativesAccountRow,
  mutateDerivativesAccountRow, openDerivativesAccountRow,
} from "@newbeing/storage/derivatives";
import {
  DERIVATIVES_POLICY, type DerivativesAccount, type DerivativesKind, type DerivativesOrder,
  type DerivativesOrderRequest, type DerivativesOrderResult, type DerivativesPosition,
  type DerivativesValuation, type DerivativesVenue,
} from "./derivatives-types.js";

const D = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -1000, toExpPos: 1000 });
/** Structural subset of the market-data connector; no storage -> application dependency. */
export interface DerivativesInstrument {
  id: string; venue: DerivativesVenue; nativeId: string; kind: DerivativesKind;
  base: string; quote: string; settle: string; contractSize: number;
  linear: boolean; inverse: boolean; expiry: number | null;
  strike: number | null; optionRight: "call" | "put" | null; active: boolean;
  quantityStep: number | null; minContracts: number | null; priceTick: number | null;
  priceTickSteps?: Array<{ abovePrice: number; tick: number }>;
  source: "native-api" | "fixture";
}
export interface DerivativesQuote {
  instrumentId: string; timestamp: number; bid: number | null; ask: number | null;
  source: "native-api" | "fixture";
}
export interface DerivativesMarketData {
  getDerivativeInstrument(id: string): Promise<DerivativesInstrument>;
  getDerivativeQuote(id: string): Promise<DerivativesQuote>;
}
function decimal(value: string, name: string, allowZero = false): Decimal {
  if (typeof value !== "string" || value.length > 80 || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid ${name}: use a decimal string.`);
  const n = new D(value);
  if (!n.isFinite() || (allowZero ? n.lt(0) : n.lte(0))) throw new Error(`Invalid ${name}.`);
  return n;
}
function positiveNative(value: number | null, name: string): Decimal {
  if (value === null || !Number.isFinite(value) || value <= 0) throw new Error(`Missing or invalid native ${name}.`);
  return new D(value);
}
function validateAccount(venue: DerivativesVenue, settle: string): void {
  if (!["okx", "deribit"].includes(venue) || !/^[A-Z0-9]{1,20}$/.test(settle)) throw new Error("Invalid derivatives venue or settle currency.");
}
export function getDerivativesAccount(venue: DerivativesVenue, settle: string): DerivativesAccount | undefined {
  validateAccount(venue, settle);
  return getDerivativesAccountRow<DerivativesAccount>(derivativesAccountId(venue, settle));
}
/** Explicit local seed denominated in settle currency; reopening never credits again. */
export function openDerivativesAccount(venue: DerivativesVenue, settle: string, initialBalance = "10000", feeRate = "0.001"): DerivativesAccount {
  validateAccount(venue, settle);
  const balance = decimal(initialBalance, "initial balance");
  const fee = decimal(feeRate, "fee rate", true);
  if (fee.gt("0.1")) throw new Error("Fee rate must be at most 0.1.");
  return openDerivativesAccountRow<DerivativesAccount>({
    id: derivativesAccountId(venue, settle), venue, settle, initialBalance: balance.toString(), available: balance.toString(),
    feeRate: fee.toString(), realizedPnl: "0", feesPaid: "0", positions: [], orders: [], policy: { ...DERIVATIVES_POLICY },
  });
}
function validateRequest(r: DerivativesOrderRequest): void {
  validateAccount(r.venue, r.settle);
  if (!r.instrumentId || typeof r.instrumentId !== "string" || typeof r.clientOrderId !== "string" || !r.clientOrderId.trim() || r.clientOrderId.length > 128) throw new Error("Instrument and client order IDs are required.");
  if (!["open", "close"].includes(r.action) || !["long", "short"].includes(r.side) || typeof r.reduceOnly !== "boolean") throw new Error("Invalid order action, side or reduceOnly.");
  if (!Number.isInteger(r.leverage) || r.leverage < 1 || r.leverage > 20) throw new Error("Isolated leverage must be 1–20x.");
  if (r.action === "open" && r.reduceOnly) throw new Error("Reduce-only cannot open a position.");
  decimal(r.quantity, "quantity"); decimal(r.maximumPrice, "maximum price");
}
const requestKeys = ["venue", "settle", "instrumentId", "clientOrderId", "action", "side", "quantity", "leverage", "reduceOnly", "maximumPrice"] as const;
function previousOrder(account: DerivativesAccount, request: DerivativesOrderRequest): DerivativesOrder | undefined {
  const order = account.orders.find((o) => o.clientOrderId === request.clientOrderId);
  if (order && requestKeys.some((key) => order[key] !== request[key])) throw new Error("Client order ID already used with different parameters.");
  return order;
}
function acceptedSource(source: "native-api" | "fixture"): boolean {
  return source === "native-api" || (source === "fixture" && process.env.NEWBEING_E2E_FIXTURES === "1" && process.env.NODE_ENV !== "production");
}
function validateInstrument(i: DerivativesInstrument, r: DerivativesOrderRequest, now: number): void {
  if (!i.active || !acceptedSource(i.source) || i.id !== r.instrumentId || i.venue !== r.venue || !i.nativeId || i.id !== `${i.venue}:${i.kind}:${i.nativeId}` || i.settle !== r.settle) throw new Error("An active matching native instrument and settle account are required.");
  if (!["perpetual", "future", "option"].includes(i.kind)) throw new Error("Unsupported derivative kind.");
  if (i.expiry !== null && (!Number.isFinite(i.expiry) || now >= i.expiry)) throw new Error("Expired instrument: awaiting official settlement; trading is frozen.");
  if (i.kind !== "perpetual" && i.expiry === null) throw new Error("Dated instrument requires an official expiry.");
  if (i.kind === "option") {
    if (r.side !== "long" || r.leverage !== 1 || !["call", "put"].includes(i.optionRight ?? "") || i.strike === null || !Number.isFinite(i.strike) || i.strike <= 0) throw new Error("Options support buy-to-open / sell-to-close long positions only, at 1x.");
  } else if (!i.linear || i.inverse || i.settle !== i.quote) throw new Error("Only linear settle-in-quote isolated contracts are supported.");
  positiveNative(i.contractSize, "contract size");
  const step = positiveNative(i.quantityStep, "quantity step");
  const quantity = decimal(r.quantity, "quantity");
  if (quantity.lt(positiveNative(i.minContracts, "minimum contracts")) || !quantity.mod(step).isZero()) throw new Error("Quantity violates native contract constraints.");
  const protectedPrice = decimal(r.maximumPrice, "maximum price");
  let tick = positiveNative(i.priceTick, "price tick"), appliedThreshold = new D(-1);
  for (const step of i.priceTickSteps ?? []) {
    if (!Number.isFinite(step.abovePrice) || step.abovePrice < 0) throw new Error("Invalid native price tick threshold.");
    const nextTick = positiveNative(step.tick, "price tick step");
    // Deribit: the larger tick applies above (not at) its native threshold.
    if (protectedPrice.gt(step.abovePrice) && appliedThreshold.lt(step.abovePrice)) {
      tick = nextTick; appliedThreshold = new D(step.abovePrice);
    }
  }
  if (!protectedPrice.mod(tick).isZero()) throw new Error("Price protection violates native price tick.");
}
function fillPrice(i: DerivativesInstrument, q: DerivativesQuote, r: DerivativesOrderRequest, now: number): Decimal {
  const bid = positiveNative(q.bid, "bid"), ask = positiveNative(q.ask, "ask");
  const age = now - q.timestamp;
  if (!acceptedSource(q.source) || q.source !== i.source || q.instrumentId !== i.id || !Number.isFinite(age) || age < 0 || age > DERIVATIVES_POLICY.maxQuoteAgeMs || bid.gt(ask)) throw new Error("A fresh, matching two-sided quote is required.");
  const buy = (r.action === "open") === (r.side === "long");
  const price = buy ? ask : bid;
  const limit = decimal(r.maximumPrice, "maximum price");
  if (buy ? price.gt(limit) : price.lt(limit)) throw new Error("Maximum price protection exceeded.");
  return price;
}
function applyFill(account: DerivativesAccount, r: DerivativesOrderRequest, i: DerivativesInstrument, price: Decimal, now: number): DerivativesOrder {
  const qty = decimal(r.quantity, "quantity"), size = positiveNative(i.contractSize, "contract size");
  const notional = qty.mul(size).mul(price), fee = notional.mul(account.feeRate);
  let position = account.positions.find((p) => p.instrumentId === i.id && p.side === r.side);
  let available = new D(account.available), pnl = new D(0);
  if (position && (position.contractSize !== size.toString() || position.kind !== i.kind || position.expiry !== i.expiry || position.leverage !== r.leverage)) throw new Error("Position metadata or leverage changed; use the original position terms.");
  if (r.action === "open") {
    const margin = i.kind === "option" ? notional : notional.div(r.leverage);
    if (available.lt(margin.add(fee))) throw new Error("Insufficient settle balance for isolated margin / premium and fees.");
    available = available.sub(margin).sub(fee);
    if (position) {
      const total = new D(position.quantity).add(qty);
      position.entryPrice = new D(position.entryPrice).mul(position.quantity).add(price.mul(qty)).div(total).toString();
      position.quantity = total.toString(); position.margin = new D(position.margin).add(margin).toString();
    } else {
      position = { instrumentId: i.id, kind: i.kind, side: r.side, quantity: qty.toString(), contractSize: size.toString(), entryPrice: price.toString(), margin: margin.toString(), leverage: r.leverage, expiry: i.expiry };
      account.positions.push(position);
    }
  } else {
    if (!position || qty.gt(position.quantity)) throw new Error("Close / reduce-only exceeds the existing position; naked selling is prohibited.");
    const released = qty.eq(position.quantity) ? new D(position.margin) : new D(position.margin).mul(qty).div(position.quantity);
    pnl = price.sub(position.entryPrice).mul(qty).mul(size).mul(r.side === "long" ? 1 : -1);
    // Local isolated model caps trading loss at allocated collateral; no exchange liquidation is implied.
    if (i.kind !== "option") pnl = D.max(pnl, released.neg());
    const returned = i.kind === "option" ? notional : released.add(pnl);
    available = available.add(returned).sub(fee);
    if (available.lt(0)) throw new Error("Insufficient settle balance to pay close fees.");
    position.quantity = new D(position.quantity).sub(qty).toString();
    position.margin = new D(position.margin).sub(released).toString();
    if (new D(position.quantity).isZero()) account.positions = account.positions.filter((p) => p !== position);
  }
  const order: DerivativesOrder = { ...r, status: "filled", fillPrice: price.toString(), fee: fee.toString(), realizedPnl: pnl.toString(), createdAt: now };
  account.available = available.toString(); account.realizedPnl = new D(account.realizedPnl).add(pnl).toString();
  account.feesPaid = new D(account.feesPaid).add(fee).toString(); account.orders.push(order);
  return order;
}
/** Atomic immediate local fill. No venue order is submitted, and failed validation moves no money. */
export async function executeDerivativesOrder(request: DerivativesOrderRequest, marketData: DerivativesMarketData, now: () => number = Date.now): Promise<DerivativesOrderResult> {
  // Snapshot caller input before awaiting a connector.
  const r = { ...request };
  assertDerivativesPaperWorkspace(); validateRequest(r);
  const account = getDerivativesAccount(r.venue, r.settle);
  if (!account) throw new Error("Explicitly open a derivatives Paper account first.");
  const prior = previousOrder(account, r);
  if (prior) return { account, order: prior, deduplicated: true };
  const instrument = await marketData.getDerivativeInstrument(r.instrumentId);
  assertDerivativesPaperWorkspace(); validateInstrument(instrument, r, now());
  const quote = await marketData.getDerivativeQuote(r.instrumentId);
  assertDerivativesPaperWorkspace();
  const committed = mutateDerivativesAccountRow<DerivativesAccount, { order: DerivativesOrder; deduplicated: boolean }>(account.id, (current) => {
    const existing = previousOrder(current, r);
    if (existing) return { order: existing, deduplicated: true };
    const timestamp = now();
    validateInstrument(instrument, r, timestamp);
    const price = fillPrice(instrument, quote, r, timestamp);
    return { order: applyFill(current, r, instrument, price, timestamp), deduplicated: false };
  });
  return { account: committed.account, ...committed.result };
}
/** Pure mark estimate. Never acts as an expiry settlement or an execution quote. */
export function valueDerivativesPosition(position: DerivativesPosition, mark: string, now = Date.now()): DerivativesValuation {
  if (position.expiry !== null && now >= position.expiry) return { status: "awaiting-official-settlement", unrealizedPnl: null, positionEquity: null };
  const price = decimal(mark, "mark", true);
  const raw = price.sub(position.entryPrice).mul(position.quantity).mul(position.contractSize).mul(position.side === "long" ? 1 : -1);
  const pnl = position.kind === "option" ? raw : D.max(raw, new D(position.margin).neg());
  const equity = new D(position.margin).add(pnl);
  return { status: equity.lte(0) ? "margin-exhausted" : "marked", unrealizedPnl: pnl.toString(), positionEquity: equity.toString() };
}
