import process from "node:process";
import type { Candle, Timeframe } from "@newbeing/core";
import { timeframeMilliseconds } from "../utils.js";
import { fixtureInstruments, fixtureQuote, FIXTURE_TIME } from "./fixtures.js";
import { normalizeDeribitFuture, normalizeDeribitInstrument, normalizeOkxInstrument, numberOrNull as n, type NativeRow } from "./normalize.js";
import type { DerivativeInstrument, DerivativeKind, DerivativeMarketData, DerivativeQuote } from "./types.js";

const OKX = "https://www.okx.com/api/v5";
const DERIBIT = "https://www.deribit.com/api/v2/public";
const KINDS: readonly DerivativeKind[] = ["perpetual", "future", "option"];
const BARS: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1Dutc" };

export interface DerivativeMarketDataOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Explicit override for tests; env switches are otherwise read at construction. */
  fixture?: boolean;
}

/** Public read-only native APIs. No credentials, market-wide CCXT load, or pagination. */
export class NativeDerivativeMarketData implements DerivativeMarketData {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly fixture: boolean;
  private readonly reads = new Map<string, { until: number; value: Promise<unknown> }>();

  constructor(options: DerivativeMarketDataOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.fixture = options.fixture ?? ((process.env.NEWBEING_MARKET_DATA_FIXTURE === "1" && process.env.NODE_ENV !== "production") || (process.env.NEWBEING_E2E_FIXTURES === "1" && process.env.NODE_ENV !== "production"));
  }

  private read<T>(key: string, ttl: number, request: () => Promise<T>): Promise<T> {
    const now = this.now();
    const existing = this.reads.get(key);
    if (existing && existing.until > now) return existing.value as Promise<T>;
    // Both successful and in-flight caching have a bounded key count and lifetime.
    for (const [id, entry] of this.reads) if (entry.until <= now) this.reads.delete(id);
    if (this.reads.size >= 256) this.reads.delete(this.reads.keys().next().value!);
    const value = request().then((result) => {
      if (this.reads.get(key)?.value === value) this.reads.set(key, { until: this.now() + ttl, value });
      return result;
    }).catch((error: unknown) => { if (this.reads.get(key)?.value === value) this.reads.delete(key); throw error; });
    this.reads.set(key, { until: Infinity, value });
    return value;
  }

  private async api(url: string, timeoutMs = 8_000): Promise<unknown> {
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) throw new Error(`Derivative API HTTP ${response.status}.`);
    const payload = await response.json() as NativeRow;
    if (url.startsWith(OKX)) {
      if (payload.code !== "0" || !Array.isArray(payload.data)) throw new Error("Invalid OKX derivative response.");
      return payload.data;
    }
    if (payload.error || payload.result === undefined) throw new Error("Invalid Deribit derivative response.");
    return payload.result;
  }

  private rows(url: string, timeoutMs?: number): Promise<NativeRow[]> {
    return this.api(url, timeoutMs).then((value) => {
      if (!Array.isArray(value) || value.length > 20_000 || value.some((row: unknown) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Invalid derivative metadata rows.");
      return value as NativeRow[];
    });
  }

  async listDerivativeInstruments(kind: DerivativeKind, query = ""): Promise<DerivativeInstrument[]> {
    if (!KINDS.includes(kind)) throw new Error("Unsupported derivative kind.");
    if (query.length > 100) throw new Error("Derivative query is too long.");
    const needle = query.trim().toUpperCase();
    const instruments = this.fixture ? fixtureInstruments() : await this.read(`list:${kind}`, 30_000, async () => {
      // Fixed request sets: OKX perpetuals, OKX futures plus Deribit USDC dated
      // futures, or three fixed Deribit option currencies. No expiry pagination.
      if (kind === "option") {
        const batches = await Promise.all(["USDC", "BTC", "ETH"].map((currency) => this.rows(`${DERIBIT}/get_instruments?currency=${currency}&kind=option&expired=false`)));
        return batches.flat().flatMap((row) => {
          const instrument = normalizeDeribitInstrument(row);
          return instrument ? [instrument] : [];
        });
      }
      if (kind === "future") {
        const [okxRows, deribitRows] = await Promise.all([
          this.rows(`${OKX}/public/instruments?instType=FUTURES`, 15_000),
          this.rows(`${DERIBIT}/get_instruments?currency=USDC&kind=future&expired=false`, 15_000),
        ]);
        return [
          ...okxRows.flatMap((row) => {
            const instrument = normalizeOkxInstrument(row);
            return instrument ? [instrument] : [];
          }),
          ...deribitRows.flatMap((row) => {
            const instrument = normalizeDeribitFuture(row);
            return instrument ? [instrument] : [];
          }),
        ];
      }
      return (await this.rows(`${OKX}/public/instruments?instType=SWAP`, 15_000)).flatMap((row) => {
        const instrument = normalizeOkxInstrument(row);
        return instrument ? [instrument] : [];
      });
    });
    return structuredClone(instruments.filter((item) => item.kind === kind && item.active && (this.fixture || item.expiry === null || item.expiry > this.now()) && (!needle || [item.id, item.symbol, item.base, item.quote, item.settle].some((value) => value.toUpperCase().includes(needle))))
      .sort((a, b) => Number(b.linear) - Number(a.linear) || a.id.localeCompare(b.id)).slice(0, 100));
  }

  async getDerivativeInstrument(id: string): Promise<DerivativeInstrument> {
    const match = /^(okx|deribit):(perpetual|future|option):([A-Za-z0-9_-]{1,100})$/.exec(id);
    if (!match || (match[1] === "okx" ? (match[2] !== "perpetual" && match[2] !== "future") : (match[2] !== "option" && match[2] !== "future"))) throw new Error("Invalid derivative identity.");
    if (this.fixture) {
      const item = fixtureInstruments().find((instrument) => instrument.id === id);
      if (!item) throw new Error("Unknown derivative fixture instrument.");
      return item;
    }
    return structuredClone(await this.read(`instrument:${id}`, 30_000, async () => {
      const nativeId = encodeURIComponent(match[3]!);
      let item: DerivativeInstrument | null;
      if (match[1] === "okx") {
        const rows = await this.rows(`${OKX}/public/instruments?instType=${match[2] === "perpetual" ? "SWAP" : "FUTURES"}&instId=${nativeId}`, 15_000);
        item = rows.length === 1 ? normalizeOkxInstrument(rows[0]!) : null;
      } else if (match[2] === "option") {
        const row = await this.api(`${DERIBIT}/get_instrument?instrument_name=${nativeId}`);
        item = row && typeof row === "object" ? normalizeDeribitInstrument(row as NativeRow) : null;
      } else {
        const row = await this.api(`${DERIBIT}/get_instrument?instrument_name=${nativeId}`);
        item = row && typeof row === "object" ? normalizeDeribitFuture(row as NativeRow) : null;
      }
      if (!item || item.id !== id) throw new Error("Unsupported or mismatched native derivative instrument.");
      return item;
    }));
  }

  private fresh(timestamp: unknown): number {
    const value = n(timestamp);
    if (value === null || value <= 0 || this.now() - value > 30_000 || value - this.now() > 5_000) throw new Error("Derivative quote is stale or has an invalid native timestamp.");
    return value;
  }

  private liveRow(rows: NativeRow[], instrument: DerivativeInstrument): NativeRow {
    const row = rows.find((item) => item.instId === instrument.nativeId);
    if (!row) throw new Error("Mismatched derivative quote identity.");
    this.fresh(row.ts);
    return row;
  }

  async getDerivativeQuote(id: string): Promise<DerivativeQuote> {
    const instrument = await this.getDerivativeInstrument(id);
    if (!instrument.active || (!this.fixture && instrument.expiry !== null && instrument.expiry <= this.now())) throw new Error("Derivative instrument is inactive or expired.");
    if (this.fixture) return this.read(`quote:${id}`, 1_000, async () => fixtureQuote(instrument, this.now()));
    const quote = await this.read(`quote:${id}`, 1_000, async (): Promise<DerivativeQuote> => {
      const native = encodeURIComponent(instrument.nativeId);
      const quote: DerivativeQuote = { instrumentId: id, timestamp: 0, bid: null, ask: null, last: null, mark: null, index: null, fundingRate: null, nextFundingAt: null, openInterest: null, iv: null, delta: null, source: "native-api" };
      if (instrument.venue === "deribit") {
        const row = await this.api(`${DERIBIT}/ticker?instrument_name=${native}`) as NativeRow;
        if (row.instrument_name !== instrument.nativeId || row.state !== "open") throw new Error("Mismatched or closed Deribit quote.");
        quote.timestamp = this.fresh(row.timestamp);
        quote.bid = n(row.best_bid_price); quote.ask = n(row.best_ask_price); quote.last = n(row.last_price);
        quote.mark = n(row.mark_price); quote.index = n(row.index_price);
        const interest = n(row.open_interest), iv = n(row.mark_iv);
        quote.openInterest = interest === null ? null : interest / instrument.contractSize;
        quote.iv = iv === null ? null : iv / 100;
        quote.delta = n((row.greeks as NativeRow | undefined)?.delta);
      } else {
        const optional = async (path: string) => {
          try { return this.liveRow(await this.rows(`${OKX}${path}`), instrument); } catch { return null; }
        };
        const [tickers, mark, oi, funding] = await Promise.all([
          this.rows(`${OKX}/market/ticker?instId=${native}`),
          optional(`/public/mark-price?instType=${instrument.kind === "perpetual" ? "SWAP" : "FUTURES"}&instId=${native}`),
          optional(`/public/open-interest?instType=${instrument.kind === "perpetual" ? "SWAP" : "FUTURES"}&instId=${native}`),
          instrument.kind === "perpetual" ? optional(`/public/funding-rate?instId=${native}`) : Promise.resolve(null),
        ]);
        const row = this.liveRow(tickers, instrument);
        quote.timestamp = this.fresh(row.ts);
        quote.bid = n(row.bidPx); quote.ask = n(row.askPx); quote.last = n(row.last);
        quote.mark = n(mark?.markPx); quote.openInterest = n(oi?.oi);
        quote.fundingRate = n(funding?.fundingRate);
        // OKX fundingTime is the upcoming settlement; nextFundingTime is the following interval.
        quote.nextFundingAt = n(funding?.fundingTime);
        // OKX ticker has no index. Keep null rather than mislabel mark as index.
      }
      for (const key of ["bid", "ask", "last", "mark", "index"] as const) {
        const value = quote[key];
        if (value !== null && value <= 0) quote[key] = null;
      }
      if ((quote.bid !== null && quote.ask !== null && quote.bid > quote.ask) || [quote.bid, quote.ask, quote.last, quote.mark].every((value) => value === null)) throw new Error("Invalid derivative quote prices.");
      if (quote.openInterest !== null && quote.openInterest < 0) quote.openInterest = null;
      if (quote.iv !== null && quote.iv < 0) quote.iv = null;
      return quote;
    });
    this.fresh(quote.timestamp);
    return structuredClone(quote);
  }

  async getDerivativeOptionQuotes(ids: string[]): Promise<DerivativeQuote[]> {
    if (!Array.isArray(ids) || ids.length > 100) throw new Error("Derivative option quote batch must contain at most 100 IDs.");
    const requested = new Map<string, { nativeId: string; currency: "USDC" | "BTC" | "ETH" }>();
    for (const id of ids) {
      const match = /^deribit:option:([A-Z0-9]+(?:_USDC)?-[A-Z0-9][A-Z0-9.-]{1,99})$/.exec(id);
      if (!match) throw new Error("Invalid Deribit option identity.");
      const nativeId = match[1]!;
      const base = /^([A-Z0-9]+)(?:_USDC)?-/.exec(nativeId)?.[1];
      const linear = !!base && nativeId.startsWith(`${base}_USDC-`);
      const currency = linear ? "USDC" : base === "BTC" || base === "ETH" ? base : null;
      if (!currency) throw new Error("Unsupported Deribit option settlement identity.");
      requested.set(id, { nativeId, currency });
    }
    if (!requested.size) return [];

    if (this.fixture) {
      const fixtures = fixtureInstruments();
      return [...requested.entries()].flatMap(([id]) => {
        const instrument = fixtures.find((item) => item.id === id && item.kind === "option");
        return instrument ? [{ ...fixtureQuote(instrument, this.now()), instrumentId: id }] : [];
      });
    }

    const currencies = [...new Set([...requested.values()].map((item) => item.currency))];
    const snapshots = await Promise.all(currencies.map(async (currency) => {
      const rows = await this.read(`option-summary:${currency}`, 2_000, () =>
        this.rows(`${DERIBIT}/get_book_summary_by_currency?currency=${currency}&kind=option`));
      return [currency, rows] as const;
    }));
    const summaryById = new Map<string, NativeRow>();
    for (const [currency, rows] of snapshots) {
      for (const row of rows) {
        if (typeof row.instrument_name === "string") summaryById.set(`${currency}:${row.instrument_name}`, row);
      }
    }
    const positiveOrNull = (...values: unknown[]): number | null => {
      for (const value of values) {
        const parsed = n(value);
        if (parsed !== null && parsed > 0) return parsed;
      }
      return null;
    };
    return [...requested.entries()].flatMap(([id, identity]) => {
      const row = summaryById.get(`${identity.currency}:${identity.nativeId}`);
      if (!row) return [];
      let bid = positiveOrNull(row.best_bid_price, row.bid_price);
      let ask = positiveOrNull(row.best_ask_price, row.ask_price);
      if (bid !== null && ask !== null && bid > ask) { bid = null; ask = null; }
      return [{
        instrumentId: id,
        timestamp: n(row.timestamp) ?? n(row.creation_timestamp) ?? 0,
        bid,
        ask,
        last: positiveOrNull(row.last_price, row.last),
        mark: positiveOrNull(row.mark_price),
        index: positiveOrNull(row.index_price),
        fundingRate: null,
        nextFundingAt: null,
        openInterest: null,
        iv: null,
        delta: null,
        source: "native-api" as const,
      }];
    });
  }

  async getDerivativeCandles(id: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    if (!Object.hasOwn(BARS, timeframe)) throw new Error("Unsupported derivative timeframe.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error("Derivative candle limit must be an integer in [1, 300].");
    const instrument = await this.getDerivativeInstrument(id);
    if (instrument.kind === "option") throw new Error("Option candles are unsupported; sparse option trades are not filled into continuous candles.");
    const interval = timeframeMilliseconds(timeframe);
    if (this.fixture) return Array.from({ length: limit }, (_, i) => ({ timestamp: Math.floor(FIXTURE_TIME / interval) * interval - (limit - i) * interval, open: 80000 + i, high: 80002 + i, low: 79999 + i, close: 80001 + i, volume: 0.01 * (i + 1) }));
    const candles = await this.read(`candles:${id}:${timeframe}:${limit}`, 1_000, async () => {
      if (instrument.venue === "deribit") {
        const resolution = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "1D" }[timeframe];
        const end = this.now();
        const start = end - limit * interval - interval;
        const chart = await this.api(`${DERIBIT}/get_tradingview_chart_data?instrument_name=${encodeURIComponent(instrument.nativeId)}&start_timestamp=${start}&end_timestamp=${end}&resolution=${resolution}`) as NativeRow;
        if (chart.status !== "ok" || !Array.isArray(chart.ticks)) throw new Error("Invalid Deribit candle response.");
        const series = (key: string): unknown[] => (Array.isArray(chart[key]) ? chart[key] : []);
        const count = chart.ticks.length;
        const opens = series("open"), highs = series("high"), lows = series("low"), closes = series("close"), volumes = series("volume");
        const bars = [];
        for (let i = 0; i < count; i += 1) {
          const timestamp = n(chart.ticks[i]);
          const open = n(opens[i]);
          const high = n(highs[i]);
          const low = n(lows[i]);
          const close = n(closes[i]);
          const volume = n(volumes[i]);
          if (timestamp === null || open === null || high === null || low === null || close === null || volume === null) throw new Error("Invalid Deribit candle values.");
          if (timestamp <= 0 || Math.min(open, high, low, close) <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close) || volume < 0) throw new Error("Invalid Deribit candle range.");
          bars.push({ timestamp, open, high, low, close, volume });
        }
        bars.sort((a, b) => a.timestamp - b.timestamp);
        // The last bucket can still be forming; drop it rather than filling gaps.
        if (bars.length > 1 && end - bars[bars.length - 1]!.timestamp < interval) bars.pop();
        return bars.slice(-limit);
      }
      const rows = await this.api(`${OKX}/market/candles?instId=${encodeURIComponent(instrument.nativeId)}&bar=${BARS[timeframe]}&limit=${limit}`);
      if (!Array.isArray(rows)) throw new Error("Invalid derivative candles.");
      const byTime = new Map<number, Candle>();
      for (const row of rows as unknown[][]) {
        if (!Array.isArray(row)) throw new Error("Invalid derivative candle row.");
        if (row[8] !== "1") continue; // Closed bars only; no gap filling.
        const values = row.slice(0, 6).map(n);
        if (values.length !== 6 || values.some((value) => value === null)) throw new Error("Invalid derivative candle values.");
        const [timestamp, open, high, low, close, contracts] = values as [number, number, number, number, number, number];
        if (timestamp <= 0 || Math.min(open, high, low, close) <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close) || contracts < 0) throw new Error("Invalid derivative candle range.");
        byTime.set(timestamp, { timestamp, open, high, low, close, volume: contracts * instrument.contractSize });
      }
      return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
    });
    return structuredClone(candles);
  }
}

let defaultMarketData: NativeDerivativeMarketData | undefined;
function marketData(): NativeDerivativeMarketData { return defaultMarketData ??= new NativeDerivativeMarketData(); }
export const listDerivativeInstruments: DerivativeMarketData["listDerivativeInstruments"] = (kind, query) => marketData().listDerivativeInstruments(kind, query);
export const getDerivativeInstrument: DerivativeMarketData["getDerivativeInstrument"] = (id) => marketData().getDerivativeInstrument(id);
export const getDerivativeQuote: DerivativeMarketData["getDerivativeQuote"] = (id) => marketData().getDerivativeQuote(id);
export const getDerivativeOptionQuotes: DerivativeMarketData["getDerivativeOptionQuotes"] = (ids) => marketData().getDerivativeOptionQuotes(ids);
export const getDerivativeCandles: DerivativeMarketData["getDerivativeCandles"] = (id, timeframe, limit) => marketData().getDerivativeCandles(id, timeframe, limit);
