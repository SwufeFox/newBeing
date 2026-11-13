import { Decimal } from "decimal.js";

/** Client-safe wire types. Decimal quantities, prices and money are JSON strings. */
export type DerivativesVenue = "okx" | "deribit";
export type DerivativesKind = "perpetual" | "future" | "option";
export interface DerivativesPolicy {
  mode: "local-isolated-paper";
  funding: "not-accrued-no-official-ledger";
  expiry: "freeze-awaiting-official-settlement";
  liquidation: "no-exchange-liquidation-simulation";
  losses: "capped-at-allocated-isolated-margin-before-fees";
  realizedPnl: "excludes-fees";
  maxLeverage: 20;
  maxQuoteAgeMs: 15000;
}
export const DERIVATIVES_POLICY: Readonly<DerivativesPolicy> = Object.freeze({
  mode: "local-isolated-paper", funding: "not-accrued-no-official-ledger",
  expiry: "freeze-awaiting-official-settlement", liquidation: "no-exchange-liquidation-simulation",
  losses: "capped-at-allocated-isolated-margin-before-fees", realizedPnl: "excludes-fees",
  maxLeverage: 20, maxQuoteAgeMs: 15000,
});
export interface DerivativesOrderRequest {
  venue: DerivativesVenue;
  settle: string;
  instrumentId: string;
  clientOrderId: string;
  action: "open" | "close";
  side: "long" | "short";
  /** Contracts, not base coins. */
  quantity: string;
  leverage: number;
  reduceOnly: boolean;
  /** Buy ceiling or sell floor in settle currency per base coin. */
  maximumPrice: string;
}
export interface DerivativesPosition {
  instrumentId: string;
  kind: DerivativesKind;
  side: "long" | "short";
  quantity: string;
  contractSize: string;
  entryPrice: string;
  margin: string;
  leverage: number;
  expiry: number | null;
}
export interface DerivativesOrder extends DerivativesOrderRequest {
  status: "filled";
  fillPrice: string;
  fee: string;
  realizedPnl: string;
  createdAt: number;
}
export interface DerivativesAccount {
  id: string;
  venue: DerivativesVenue;
  settle: string;
  available: string;
  initialBalance: string;
  feeRate: string;
  realizedPnl: string;
  feesPaid: string;
  positions: DerivativesPosition[];
  orders: DerivativesOrder[];
  orderCount: number;
  policy: DerivativesPolicy;
}
export interface DerivativesOrderResult {
  account: DerivativesAccount;
  order: DerivativesOrder;
  deduplicated: boolean;
}
export interface DerivativesValuation {
  status: "marked" | "awaiting-official-settlement" | "margin-exhausted";
  unrealizedPnl: string | null;
  positionEquity: string | null;
}

export const DerivativesDecimal = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -1000, toExpPos: 1000 });

/** The exact margin / paid premium and fee charged by a local opening fill. */
export function derivativesOpeningAmounts(notional: Decimal, kind: DerivativesKind, leverage: number, feeRate: string): { margin: Decimal; fee: Decimal; required: Decimal } {
  const margin = kind === "option" ? notional : notional.div(leverage);
  const fee = notional.mul(feeRate);
  return { margin, fee, required: margin.add(fee) };
}

function positiveOrderDecimal(value: string, name: string): Decimal {
  if (typeof value !== "string" || value.length > 80 || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid ${name}: use a decimal string.`);
  const number = new DerivativesDecimal(value);
  if (!number.isFinite() || number.lte(0)) throw new Error(`Invalid ${name}.`);
  return number;
}

function nativeOrderConstraint(value: number | null, name: string): Decimal {
  if (value === null || !Number.isFinite(value) || value <= 0) throw new Error(`Missing or invalid native ${name}.`);
  return new DerivativesDecimal(value);
}

/** Shared native input rules for the Paper engine and its browser ticket. */
export function validateDerivativesQuantity(instrument: { quantityStep: number | null; minContracts: number | null }, value: string): void {
  const step = nativeOrderConstraint(instrument.quantityStep, "quantity step");
  const quantity = positiveOrderDecimal(value, "quantity");
  if (quantity.lt(nativeOrderConstraint(instrument.minContracts, "minimum contracts")) || !quantity.mod(step).isZero()) throw new Error("Quantity violates native contract constraints.");
}

export function validateDerivativesPrice(instrument: { priceTick: number | null; priceTickSteps?: Array<{ abovePrice: number; tick: number }> }, value: string): void {
  const protectedPrice = positiveOrderDecimal(value, "maximum price");
  let tick = nativeOrderConstraint(instrument.priceTick, "price tick"), appliedThreshold = new DerivativesDecimal(-1);
  for (const step of instrument.priceTickSteps ?? []) {
    if (!Number.isFinite(step.abovePrice) || step.abovePrice < 0) throw new Error("Invalid native price tick threshold.");
    const nextTick = nativeOrderConstraint(step.tick, "price tick step");
    // Deribit applies a larger tick above, rather than at, its threshold.
    if (protectedPrice.gt(step.abovePrice) && appliedThreshold.lt(step.abovePrice)) {
      tick = nextTick; appliedThreshold = new DerivativesDecimal(step.abovePrice);
    }
  }
  if (!protectedPrice.mod(tick).isZero()) throw new Error("Price protection violates native price tick.");
}
