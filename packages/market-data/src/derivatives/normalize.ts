import type { DerivativeInstrument, DerivativeKind } from "./types.js";

export type NativeRow = Record<string, unknown>;
export function numberOrNull(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
const positive = (value: unknown) => { const n = numberOrNull(value); return n !== null && n > 0 ? n : null; };

export function normalizeOkxInstrument(row: NativeRow): DerivativeInstrument | null {
  const kind: DerivativeKind | null = row.instType === "SWAP" ? "perpetual" : row.instType === "FUTURES" ? "future" : null;
  // ctValCcy is authoritative base; instFamily is native metadata, not an ID parse.
  const base = row.ctValCcy;
  const size = positive(row.ctVal);
  const multiplier = positive(row.ctMult);
  if (!kind || row.ctType !== "linear" || row.settleCcy !== "USDT" || typeof base !== "string" || !base || base === "USDT" || !size || !multiplier || typeof row.instId !== "string") return null;
  const expiry = kind === "future" ? positive(row.expTime) : null;
  if (kind === "future" && expiry === null) return null;
  return {
    id: `okx:${kind}:${row.instId}`, venue: "okx", nativeId: row.instId,
    symbol: row.instId, kind, base, quote: "USDT", settle: "USDT",
    contractSize: size * multiplier, linear: true, inverse: false, expiry,
    strike: null, optionRight: null, active: row.state === "live",
    quantityStep: positive(row.lotSz), minContracts: positive(row.minSz), priceTick: positive(row.tickSz),
    priceTickSteps: [], source: "native-api",
  };
}

export function normalizeDeribitFuture(row: NativeRow): DerivativeInstrument | null {
  const base = row.base_currency;
  const size = positive(row.contract_size);
  // Only linear USDC-settled dated futures. Coin-margined (reversed) contracts and
  // perpetuals surfacing under kind=future are viewable nowhere here: the local
  // isolated engine only supports linear settle-in-quote products.
  if (row.kind !== "future" || row.instrument_type !== "linear" || row.settlement_currency !== "USDC") return null;
  if (typeof row.instrument_name !== "string" || row.instrument_name.endsWith("-PERPETUAL")) return null;
  if (typeof row.counter_currency !== "string" || !row.counter_currency || typeof base !== "string" || !base) return null;
  const expiry = positive(row.expiration_timestamp);
  if (expiry === null || expiry > 4102444800000) return null;
  if (!size) return null;
  const minimum = positive(row.min_trade_amount);
  return {
    id: `deribit:future:${row.instrument_name}`, venue: "deribit", nativeId: row.instrument_name,
    symbol: row.instrument_name, kind: "future", base,
    quote: String(row.counter_currency), settle: "USDC",
    contractSize: size, linear: true, inverse: false, expiry,
    strike: null, optionRight: null,
    active: row.is_active === true,
    quantityStep: minimum === null ? null : minimum / size,
    minContracts: minimum === null ? null : minimum / size,
    priceTick: positive(row.tick_size),
    priceTickSteps: [], source: "native-api",
  };
}

export function normalizeDeribitInstrument(row: NativeRow): DerivativeInstrument | null {
  const base = row.base_currency;
  const size = positive(row.contract_size);
  const linear = row.instrument_type === "linear" && row.settlement_currency === "USDC";
  const coin = row.instrument_type === "reversed" && (base === "BTC" || base === "ETH") && row.settlement_currency === base;
  const expiry = positive(row.expiration_timestamp);
  const strike = positive(row.strike);
  const right = row.option_type;
  if (row.kind !== "option" || (!linear && !coin) || typeof row.counter_currency !== "string" || !row.counter_currency || typeof base !== "string" || !base || !size || !expiry || !strike || (right !== "call" && right !== "put") || typeof row.instrument_name !== "string") return null;
  const minimum = positive(row.min_trade_amount);
  const steps = Array.isArray(row.tick_size_steps) ? row.tick_size_steps as NativeRow[] : [];
  return {
    id: `deribit:option:${row.instrument_name}`, venue: "deribit", nativeId: row.instrument_name,
    symbol: row.instrument_name, kind: "option", base,
    quote: String(row.counter_currency), settle: String(row.settlement_currency),
    contractSize: size, linear, inverse: coin, expiry, strike, optionRight: right,
    active: row.is_active === true,
    quantityStep: minimum === null ? null : minimum / size,
    minContracts: minimum === null ? null : minimum / size,
    priceTick: positive(row.tick_size),
    priceTickSteps: steps.flatMap((step) => {
      const abovePrice = numberOrNull(step.above_price), tick = positive(step.tick_size);
      return abovePrice !== null && tick !== null ? [{ abovePrice, tick }] : [];
    }), source: "native-api",
  };
}
