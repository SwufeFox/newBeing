import type { DerivativeInstrument, DerivativeQuote } from "@newbeing/market-data/derivatives";

export function derivativeNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 10 }) : "—";
}
export function derivativeDate(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "—";
}
export function derivativeBlockReason(instrument: DerivativeInstrument | null, quote: DerivativeQuote | null, now: number): string | null {
  if (!instrument) return "Select a contract with native metadata.";
  if (!instrument.active) return "This contract is inactive.";
  if (instrument.expiry !== null && instrument.expiry <= now) return "Expired contract: awaiting official settlement. Paper trading is frozen.";
  if (instrument.kind !== "perpetual" && instrument.expiry === null) return "Official expiry is unavailable. Paper trading is disabled.";
  if (instrument.kind !== "option" && (!instrument.linear || instrument.inverse || instrument.settle !== instrument.quote)) return "Only linear contracts settled in quote currency support Paper execution.";
  if ([instrument.contractSize, instrument.quantityStep, instrument.minContracts, instrument.priceTick].some((value) => value === null || !Number.isFinite(value) || value <= 0)) return "Native contract constraints are unavailable. Paper trading is disabled.";
  // Fixture orders are accepted only by the engine in the non-production E2E
  // process, so the ticket must not deadlock there; production never sees them.
  if (!quote || quote.instrumentId !== instrument.id || quote.bid === null || quote.ask === null || quote.bid <= 0 || quote.ask <= 0 || quote.bid > quote.ask) return "A matching two-sided native quote is required for Paper execution.";
  if (!Number.isFinite(quote.timestamp) || now - quote.timestamp > 15000 || now < quote.timestamp) return "Quote is stale or has an invalid native timestamp. Refresh before submitting.";
  return null;
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
