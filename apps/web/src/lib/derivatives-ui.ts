import type { DerivativeInstrument, DerivativeQuote } from "@newbeing/market-data/derivatives";
import { DERIVATIVES_POLICY, DerivativesDecimal, derivativesOpeningAmounts, validateDerivativesQuantity, validateDerivativesPrice, type DerivativesAccount } from "@newbeing/application/derivatives-types";

type Decimal = InstanceType<typeof DerivativesDecimal>;

export function derivativeInputErrors(instrument: DerivativeInstrument | null, quantity: string, maximumPrice: string): { quantity: string | null; maximumPrice: string | null } {
  const errors: { quantity: string | null; maximumPrice: string | null } = { quantity: null, maximumPrice: null };
  if (!instrument) return errors;
  try { validateDerivativesQuantity(instrument, quantity); }
  catch (error) { errors.quantity = error instanceof Error ? error.message : "Invalid quantity."; }
  try { validateDerivativesPrice(instrument, maximumPrice); }
  catch (error) { errors.maximumPrice = error instanceof Error ? error.message : "Invalid price protection."; }
  return errors;
}

/** An HTTP rejection is distinct from a lost response to a local mutation. */
export class DerivativeRequestError extends Error {
  constructor(message: string, readonly status: number, readonly intentRecorded?: boolean) {
    super(message);
    this.name = "DerivativeRequestError";
  }
}

export function derivativeCommandWasRejected(error: unknown): boolean {
  if (!(error instanceof DerivativeRequestError) || error.intentRecorded === true) return false;
  return error.status === 400 || error.status === 403 || error.status === 409 || (error.status === 422 && error.intentRecorded === false);
}

/** Seed only the matching fresh book side; marks are never execution quotes. */
export function derivativeProtectionSeed(
  instrument: DerivativeInstrument | null,
  quote: DerivativeQuote | null,
  action: "open" | "close",
  side: "long" | "short",
  now: number,
): string | null {
  if (derivativeBlockCode(instrument, quote, now) !== null || !quote) return null;
  const price = (action === "open") === (side === "long") ? quote.ask : quote.bid;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? String(price) : null;
}

/** Size the selected intent; zero exposes a below-minimum result without rounding up. */
export function derivativeSizedQuantity(
  instrument: DerivativeInstrument | null,
  quote: DerivativeQuote | null,
  account: Pick<DerivativesAccount, "venue" | "settle" | "available" | "feeRate" | "positions"> | null,
  action: "open" | "close",
  side: "long" | "short",
  leverage: number,
  fraction: number,
  now: number,
): string | null {
  if (!instrument || !account || account.venue !== instrument.venue || account.settle !== instrument.settle
    || !Number.isFinite(fraction) || fraction <= 0 || fraction > 1) return null;
  const price = derivativeProtectionSeed(instrument, quote, action, side, now);
  if (price === null) return null;
  const step = new DerivativesDecimal(instrument.quantityStep!);
  let quantity: Decimal;
  if (action === "close") {
    const position = account.positions.find((item) => item.instrumentId === instrument.id && item.side === side);
    quantity = new DerivativesDecimal(position?.quantity ?? "0").mul(fraction).div(step).floor().mul(step);
  } else {
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > DERIVATIVES_POLICY.maxLeverage
      || (instrument.kind === "option" && (side !== "long" || leverage !== 1))) return null;
    const available = new DerivativesDecimal(account.available), feeRate = new DerivativesDecimal(account.feeRate);
    if (!available.isFinite() || available.lt(0) || !feeRate.isFinite() || feeRate.lt(0) || feeRate.gt("0.1")) return null;
    const budget = available.mul(fraction);
    const cost = (contracts: Decimal): Decimal => {
      const notional = contracts.mul(instrument.contractSize).mul(price);
      return derivativesOpeningAmounts(notional, instrument.kind, leverage, account.feeRate).required;
    };
    quantity = budget.div(cost(new DerivativesDecimal(1))).div(step).floor().mul(step);
    // Check the engine's operation order at rounding boundaries, including the next native step.
    while (quantity.gt(0) && cost(quantity).gt(budget)) quantity = quantity.sub(step);
    while (cost(quantity.add(step)).lte(budget)) quantity = quantity.add(step);
  }
  if (quantity.lte(0) || quantity.lt(instrument.minContracts!)) return "0";
  const result = quantity.toString();
  try { validateDerivativesQuantity(instrument, result); }
  catch { return "0"; }
  return result;
}

export function derivativeNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 10 }) : "—";
}
export function derivativeDate(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "—";
}
/** Why a Paper order cannot be submitted yet, as a code the UI can localise. */
export type DerivativeBlockCode =
  | "selectContract"
  | "inactive"
  | "expired"
  | "missingExpiry"
  | "notLinear"
  | "missingConstraints"
  | "needsQuote"
  | "staleQuote";

export function derivativeBlockCode(instrument: DerivativeInstrument | null, quote: DerivativeQuote | null, now: number): DerivativeBlockCode | null {
  if (!instrument) return "selectContract";
  if (!instrument.active) return "inactive";
  if (instrument.expiry !== null && instrument.expiry <= now) return "expired";
  if (instrument.kind !== "perpetual" && instrument.expiry === null) return "missingExpiry";
  if (instrument.kind !== "option" && (!instrument.linear || instrument.inverse || instrument.settle !== instrument.quote)) return "notLinear";
  if ([instrument.contractSize, instrument.quantityStep, instrument.minContracts, instrument.priceTick].some((value) => value === null || !Number.isFinite(value) || value <= 0)) return "missingConstraints";
  // Fixture orders are accepted only by the engine in the non-production E2E
  // process, so the ticket must not deadlock there; production never sees them.
  if (!quote || quote.instrumentId !== instrument.id || quote.source !== instrument.source || quote.bid === null || quote.ask === null || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) || quote.bid <= 0 || quote.ask <= 0 || quote.bid > quote.ask) return "needsQuote";
  if (!Number.isFinite(quote.timestamp) || now - quote.timestamp > DERIVATIVES_POLICY.maxQuoteAgeMs || now < quote.timestamp) return "staleQuote";
  return null;
}

/** An expired position is frozen awaiting official settlement, never closed or priced. */
export function derivativePositionIsExpired(
  position: { expiry: number | null },
  now: number,
): boolean {
  return position.expiry !== null && Number.isFinite(position.expiry) && Number.isFinite(now) && position.expiry <= now;
}

/** Display-only mark estimate with the engine's loss-cap semantics; never settlement. */
export function derivativeUnrealized(
  position: { kind: string; side: string; quantity: string; contractSize: string; entryPrice: string; margin: string; expiry: number | null },
  mark: number | null,
  now: number,
): number | null {
  if (mark === null || !Number.isFinite(mark) || mark <= 0) return null;
  if (position.expiry !== null && position.expiry <= now) return null;
  const raw = (mark - Number(position.entryPrice)) * Number(position.quantity) * Number(position.contractSize) * (position.side === "long" ? 1 : -1);
  if (!Number.isFinite(raw)) return null;
  return position.kind === "option" ? raw : Math.max(raw, -Number(position.margin));
}

export interface OptionChainRow {
  strike: number;
  call: DerivativeInstrument | null;
  put: DerivativeInstrument | null;
}

export interface OptionChainExpiry {
  /** Distinguishes contracts that share an expiry but use different underlyings or settlement currencies. */
  key: string;
  expiry: number;
  base: string;
  settle: string;
  rows: OptionChainRow[];
}

/**
 * Group native option metadata by expiry, underlying and settlement, then pair
 * calls/puts by strike. Different settlement products never collapse together.
 */
export function derivativeOptionChain(instruments: DerivativeInstrument[]): OptionChainExpiry[] {
  const groups = new Map<string, { expiry: number; base: string; settle: string; rows: Map<number, OptionChainRow> }>();
  for (const instrument of instruments) {
    if (instrument.kind !== "option" || instrument.expiry === null || instrument.strike === null) continue;
    const key = `${instrument.expiry}:${instrument.base}:${instrument.settle}`;
    let group = groups.get(key);
    if (!group) {
      group = { expiry: instrument.expiry, base: instrument.base, settle: instrument.settle, rows: new Map() };
      groups.set(key, group);
    }
    let row = group.rows.get(instrument.strike);
    if (!row) { row = { strike: instrument.strike, call: null, put: null }; group.rows.set(instrument.strike, row); }
    if (instrument.optionRight === "call" && !row.call) row.call = instrument;
    if (instrument.optionRight === "put" && !row.put) row.put = instrument;
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.expiry - b.expiry || a.base.localeCompare(b.base) || a.settle.localeCompare(b.settle))
    .map(([key, group]) => ({
      key,
      expiry: group.expiry,
      base: group.base,
      settle: group.settle,
      rows: [...group.rows.values()].sort((a, b) => a.strike - b.strike),
    }));
}

export function derivativeExpiryLabel(expiry: number): string {
  if (!Number.isFinite(expiry) || expiry <= 0) return "—";
  return new Date(expiry).toISOString().slice(0, 10);
}

/** Bulk snapshot timestamps outside the direct quote freshness window are display-only stale. */
export function derivativeQuoteSnapshotIsStale(quote: Pick<DerivativeQuote, "timestamp"> | null, asOf: number): boolean {
  if (!quote || !Number.isFinite(asOf) || !Number.isFinite(quote.timestamp) || quote.timestamp <= 0) return true;
  return quote.timestamp > asOf + 5_000 || asOf - quote.timestamp > 30_000;
}
