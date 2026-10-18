import type { ExchangeId } from "@newbeing/core";

/**
 * Human-readable venue names.
 *
 * Deliberately its own module with no imports beyond a type: the market adapter
 * module pulls in CCXT, which is server-only, so a client component importing
 * the labels from there drags the whole exchange library into the browser
 * bundle and fails the build. Labels are presentation, so they live apart.
 */
export const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  binance: "Binance Spot",
  coinbaseexchange: "Coinbase Exchange",
  okx: "OKX Spot",
  kraken: "Kraken Spot",
};

/** Every venue the app can source market data from. */
export const EXCHANGE_IDS: readonly ExchangeId[] = ["binance", "coinbaseexchange", "okx", "kraken"];

/**
 * The quote currency each venue actually lists against.
 *
 * Coinbase and Kraken pair against USD; Binance and OKX against USDT. Carrying
 * a BTC/USDT symbol onto Kraken asks for a market that does not exist there, so
 * both the symbol search and the workspace state use this one map to agree on
 * what a venue can serve.
 */
export const EXCHANGE_QUOTE: Record<ExchangeId, string> = {
  binance: "USDT",
  okx: "USDT",
  coinbaseexchange: "USD",
  kraken: "USD",
};

/** Re-denominate a BASE/QUOTE symbol for a venue, keeping the base asset. */
export function symbolForExchange(symbol: string, exchange: ExchangeId): string {
  const [base] = symbol.split("/");
  if (!base) return symbol;
  return `${base}/${EXCHANGE_QUOTE[exchange]}`;
}
