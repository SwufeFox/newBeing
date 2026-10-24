import type { Candle, Timeframe } from "@newbeing/core";

export type DerivativeKind = "perpetual" | "future" | "option";
export type DerivativeVenue = "okx" | "deribit";
export type DerivativeSource = "native-api" | "fixture";

/** Native OKX public instruments / Deribit public get_instruments metadata.
 * IDs are venue:kind:nativeId; never identify a derivative by its display symbol.
 * Prices (including option premium) are settle currency per ONE base coin,
 * not per contract. contractSize is base coins/contract for supported OKX
 * linear perpetuals, Deribit USDC linear futures and Deribit linear/coin
 * options. Order quantities, steps and minima are contracts.
 * Expiry is UTC epoch milliseconds; strike is quote currency/base coin.
 * Unknown native constraints remain null; they are never inferred from symbols.
 */
export interface DerivativeInstrument {
  id: string;
  venue: DerivativeVenue;
  nativeId: string;
  symbol: string;
  kind: DerivativeKind;
  base: string;
  quote: string;
  settle: string;
  contractSize: number;
  linear: boolean;
  inverse: boolean;
  expiry: number | null;
  strike: number | null;
  optionRight: "call" | "put" | null;
  active: boolean;
  quantityStep: number | null;
  minContracts: number | null;
  priceTick: number | null;
  /** Native variable ticks: threshold and tick both settle/base. */
  priceTickSteps: { abovePrice: number; tick: number }[];
  source: DerivativeSource;
}

/** Native ticker timestamp (UTC ms), never local receipt time.
 * bid/ask/last/mark: settle/base, index: quote/base. fundingRate: fraction per
 * native funding interval; nextFundingAt: UTC ms. openInterest: contracts.
 * iv: annualized fraction (Deribit percent / 100); delta: dimensionless native
 * delta. Unavailable values are null. Old/malformed quotes are rejected.
 */
export interface DerivativeQuote {
  instrumentId: string;
  timestamp: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  index: number | null;
  fundingRate: number | null;
  nextFundingAt: number | null;
  openInterest: number | null;
  iv: number | null;
  delta: number | null;
  source: DerivativeSource;
}

/** Candles reuse core Candle: UTC ms, OHLC settle/base, volume base coins.
 * Options candles are explicitly unsupported; sparse series are never filled.
 */
export interface DerivativeMarketData {
  listDerivativeInstruments(kind: DerivativeKind, query?: string): Promise<DerivativeInstrument[]>;
  getDerivativeInstrument(id: string): Promise<DerivativeInstrument>;
  getDerivativeQuote(id: string): Promise<DerivativeQuote>;
  getDerivativeCandles(id: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;
}
