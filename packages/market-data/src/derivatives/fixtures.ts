import type { DerivativeInstrument, DerivativeQuote } from "./types.js";
import { normalizeDeribitFuture, normalizeDeribitInstrument, normalizeOkxInstrument } from "./normalize.js";

/** Deterministic synthetic snapshots shaped like native metadata; NOT live listings. */
export const FIXTURE_TIME = 1_792_742_400_000;
export function fixtureInstruments(): DerivativeInstrument[] {
  const okx = { ctType: "linear", settleCcy: "USDT", ctValCcy: "BTC", ctVal: "0.01", ctMult: "1", lotSz: "0.01", minSz: "0.01", tickSz: "0.1", state: "live" };
  const instruments = [
    normalizeOkxInstrument({ ...okx, instType: "SWAP", instId: "BTC-USDT-SWAP" }),
    normalizeOkxInstrument({ ...okx, instType: "FUTURES", instId: "BTC-USDT-261225", expTime: "1798185600000" }),
    normalizeDeribitFuture({ kind: "future", instrument_name: "BTC_USDC-25DEC26", base_currency: "BTC", counter_currency: "USDC", settlement_currency: "USDC", instrument_type: "linear", contract_size: 0.0001, min_trade_amount: 0.0001, tick_size: 2.5, expiration_timestamp: 1798185600000, is_active: true }),
    normalizeDeribitInstrument({ kind: "option", instrument_name: "BTC_USDC-25DEC26-80000-C", base_currency: "BTC", counter_currency: "USDC", settlement_currency: "USDC", instrument_type: "linear", contract_size: 1, min_trade_amount: 0.01, tick_size: 1, expiration_timestamp: 1798185600000, strike: 80000, option_type: "call", is_active: true }),
  ];
  return instruments.map((item) => {
    if (!item) throw new Error("Invalid derivative fixture metadata.");
    return { ...item, source: "fixture" };
  });
}
export function fixtureQuote(instrument: DerivativeInstrument, now: number = Date.now()): DerivativeQuote {
  const option = instrument.kind === "option";
  return {
    instrumentId: instrument.id, timestamp: now,
    bid: option ? 4999 : 79999, ask: option ? 5001 : 80001, last: option ? 5000 : 80000,
    mark: option ? 5000 : 80000, index: 80000,
    fundingRate: instrument.kind === "perpetual" ? 0.0001 : null,
    nextFundingAt: instrument.kind === "perpetual" ? FIXTURE_TIME + 28_800_000 : null,
    openInterest: 100, iv: option ? 0.5 : null, delta: option ? 0.55 : null, source: "fixture",
  };
}
