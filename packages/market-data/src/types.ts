import type { Candle, Timeframe } from "@newbeing/core";

export interface MarketSummary {
  symbol: string;
  last: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  quoteVolume24h: number | null;
  bid: number | null;
  ask: number | null;
  timestamp: number | null;
}

export interface OrderBookLevel {
  price: number;
  amount: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  timestamp: number | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface RecentTrade {
  id: string;
  timestamp: number;
  side: "buy" | "sell" | "unknown";
  price: number;
  amount: number;
}

export interface MarketSymbol {
  symbol: string;
  base: string;
  quote: string;
  active: boolean;
}

export interface ExchangeAdapter {
  readonly id: "binance";
  searchSymbols(query: string, limit?: number): Promise<MarketSymbol[]>;
  fetchOHLCV(symbol: string, timeframe: Timeframe, limit?: number): Promise<Candle[]>;
  fetchOHLCVSince(symbol: string, timeframe: Timeframe, since: number, limit?: number): Promise<Candle[]>;
  fetchSummary(symbol: string): Promise<MarketSummary>;
  fetchSummaries(symbols: readonly string[]): Promise<MarketSummary[]>;
  fetchOrderBook(symbol: string, limit?: number): Promise<OrderBookSnapshot>;
  fetchRecentTrades(symbol: string, limit?: number): Promise<RecentTrade[]>;
  close(): Promise<void>;
}
