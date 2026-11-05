import type { DerivativeInstrument, DerivativeQuote } from "@newbeing/market-data/derivatives";

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
  if (!quote || quote.instrumentId !== instrument.id || quote.bid === null || quote.ask === null || quote.bid <= 0 || quote.ask <= 0 || quote.bid > quote.ask) return "needsQuote";
  if (!Number.isFinite(quote.timestamp) || now - quote.timestamp > 15000 || now < quote.timestamp) return "staleQuote";
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
