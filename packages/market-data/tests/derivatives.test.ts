import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeDerivativeMarketData } from "../src/derivatives/client.js";
import { normalizeDeribitFuture, normalizeDeribitInstrument, normalizeOkxInstrument } from "../src/derivatives/normalize.js";

const NOW = 1_792_742_400_000;
const okx = { instId: "BTC-USDT-SWAP", instType: "SWAP", ctType: "linear", settleCcy: "USDT", ctValCcy: "BTC", ctVal: "0.01", ctMult: "1", state: "live", lotSz: "0.01", minSz: "0.01", tickSz: "0.1" };
const option = { instrument_name: "AVAX_USDC-25DEC26-20-C", kind: "option", base_currency: "AVAX", counter_currency: "USDC", settlement_currency: "USDC", instrument_type: "linear", contract_size: 100, min_trade_amount: 100, tick_size: 0.0005, expiration_timestamp: NOW + 86_400_000, strike: 20, option_type: "call", is_active: true, tick_size_steps: [{ above_price: 0.1, tick_size: 0.002 }] };
const okxId = "okx:perpetual:BTC-USDT-SWAP";
const optionId = `deribit:option:${option.instrument_name}`;
function mockApi(handler: (url: URL) => unknown) {
  return vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const url = new URL(String(input));
    const data = handler(url);
    return new Response(JSON.stringify(url.hostname.includes("okx") ? { code: "0", data } : { result: data }), { status: 200 });
  });
}
afterEach(() => { vi.unstubAllEnvs(); });

describe("native derivative metadata and units", () => {
  it("keeps native identity, ctVal/ctMult and fractional contract constraints", () => {
    expect(normalizeOkxInstrument({ ...okx, ctMult: "2" })).toMatchObject({ id: okxId, nativeId: okx.instId, contractSize: 0.02, quantityStep: 0.01, minContracts: 0.01, linear: true, inverse: false, expiry: null });
    expect(normalizeOkxInstrument({ ...okx, ctVal: "" })).toBeNull();
    expect(normalizeOkxInstrument({ ...okx, ctType: "inverse" })).toBeNull();
    expect(normalizeOkxInstrument({ ...okx, instType: "SPOT" })).toBeNull();
    expect(normalizeOkxInstrument({ ...okx, settleCcy: "USDC" })).toBeNull();
  });

  it("retains native dated-future identity and expiry", async () => {
    const future = { ...okx, instType: "FUTURES", instId: "BTC-USDT-261225", expTime: String(NOW + 86400000) };
    const fetcher = mockApi(() => [future]);
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false });
    expect(await client.listDerivativeInstruments("future", "BTC")).toHaveLength(1);
    expect(await client.getDerivativeInstrument("okx:future:BTC-USDT-261225")).toMatchObject({ kind: "future", nativeId: "BTC-USDT-261225", expiry: NOW + 86400000, contractSize: 0.01 });
    expect(normalizeOkxInstrument({ ...future, expTime: "" })).toBeNull();
  });

  it("normalizes Deribit USDC dated futures and rejects perpetuals, coin margin and option rows", () => {
    const future = { kind: "future", instrument_name: "BTC_USDC-25DEC26", base_currency: "BTC", counter_currency: "USDC", settlement_currency: "USDC", instrument_type: "linear", contract_size: 0.0001, min_trade_amount: 0.0001, tick_size: 2.5, expiration_timestamp: NOW + 86400000, is_active: true };
    expect(normalizeDeribitFuture(future)).toMatchObject({ id: "deribit:future:BTC_USDC-25DEC26", kind: "future", venue: "deribit", base: "BTC", quote: "USDC", settle: "USDC", contractSize: 0.0001, linear: true, inverse: false, expiry: NOW + 86400000, quantityStep: 1, minContracts: 1, priceTick: 2.5 });
    expect(normalizeDeribitFuture({ ...future, instrument_name: "BTC_USDC-PERPETUAL", expiration_timestamp: 32503708800000 })).toBeNull();
    expect(normalizeDeribitFuture({ ...future, kind: "option" })).toBeNull();
    expect(normalizeDeribitFuture({ ...future, instrument_type: "reversed", settlement_currency: "BTC" })).toBeNull();
    expect(normalizeDeribitFuture({ ...future, settlement_currency: "USDT" })).toBeNull();
    expect(normalizeDeribitFuture({ ...future, expiration_timestamp: null })).toBeNull();
  });

  it("lists OKX and Deribit futures together while keeping perpetuals on OKX", async () => {
    const deribit = { kind: "future", instrument_name: "BTC_USDC-25DEC26", base_currency: "BTC", counter_currency: "USDC", settlement_currency: "USDC", instrument_type: "linear", contract_size: 0.0001, min_trade_amount: 0.0001, tick_size: 2.5, expiration_timestamp: NOW + 86400000, is_active: true };
    const fetcher = mockApi((url) => {
      if (url.pathname.endsWith("get_instrument")) return deribit;
      return url.hostname.includes("okx") ? [{ ...okx, instType: "FUTURES", instId: "BTC-USDT-261225", expTime: String(NOW + 86400000) }] : [deribit, { ...deribit, instrument_name: "BTC_USDC-PERPETUAL", expiration_timestamp: 32503708800000 }];
    });
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false });
    const futures = await client.listDerivativeInstruments("future", "BTC");
    expect(futures.map((item) => item.id).sort()).toEqual(["deribit:future:BTC_USDC-25DEC26", "okx:future:BTC-USDT-261225"]);
    expect(await client.getDerivativeInstrument("deribit:future:BTC_USDC-25DEC26")).toMatchObject({ kind: "future", settle: "USDC", contractSize: 0.0001 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("quotes and charts a Deribit future from native ticker and trading-view history", async () => {
    const instrument = { kind: "future", instrument_name: "BTC_USDC-25DEC26", base_currency: "BTC", counter_currency: "USDC", settlement_currency: "USDC", instrument_type: "linear", contract_size: 0.0001, min_trade_amount: 0.0001, tick_size: 2.5, expiration_timestamp: NOW + 86400000, is_active: true };
    const fetcher = mockApi((url) => {
      if (url.pathname.endsWith("get_instrument")) return instrument;
      if (url.pathname.endsWith("ticker")) return { instrument_name: instrument.instrument_name, state: "open", timestamp: NOW, best_bid_price: 79999, best_ask_price: 80001, last_price: 80000, mark_price: 80000.5, index_price: 80000, open_interest: 8 };
      return { status: "ok", ticks: [NOW - 3600000, NOW - 1800000], open: [79900, 79950], high: [79960, 80000], low: [79880, 79940], close: [79950, 80000], volume: [0.5, 0.7] };
    });
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false });
    const quote = await client.getDerivativeQuote("deribit:future:BTC_USDC-25DEC26");
    expect(quote).toMatchObject({ bid: 79999, ask: 80001, mark: 80000.5, index: 80000, openInterest: 80000, iv: null, delta: null });
    const candles = await client.getDerivativeCandles("deribit:future:BTC_USDC-25DEC26", "1h", 10);
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ timestamp: NOW - 3600000, volume: 0.5 });
  });

  it("normalizes linear and coin options without converting premium to per-contract prices", () => {
    expect(normalizeDeribitInstrument(option)).toMatchObject({ id: optionId, contractSize: 100, quantityStep: 1, minContracts: 1, priceTick: 0.0005, priceTickSteps: [{ abovePrice: 0.1, tick: 0.002 }], quote: "USDC", settle: "USDC", linear: true, inverse: false });
    expect(normalizeDeribitInstrument({ ...option, base_currency: "BTC", counter_currency: "USD", settlement_currency: "BTC", instrument_type: "reversed", contract_size: 1, min_trade_amount: 0.1 })).toMatchObject({ contractSize: 1, minContracts: 0.1, quote: "USD", settle: "BTC", linear: false, inverse: true });
    expect(normalizeDeribitInstrument({ ...option, kind: "future" })).toBeNull();
    expect(normalizeDeribitInstrument({ ...option, contract_size: null })).toBeNull();
  });

  it("filters by kind, active status, settlement, expiry and query within fixed requests", async () => {
    const fetcher = mockApi((url) => url.hostname.includes("okx") ? [okx, { ...okx, instType: "SPOT" }, { ...okx, instId: "ETH-USDT-SWAP", ctValCcy: "ETH", state: "suspend" }, { ...okx, settleCcy: "BTC" }] : url.searchParams.get("currency") === "USDC" ? [option, { ...option, is_active: false }, { ...option, expiration_timestamp: NOW - 1 }] : []);
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false });
    expect(await client.listDerivativeInstruments("perpetual", "btc")).toHaveLength(1);
    expect(await client.listDerivativeInstruments("perpetual", "eth")).toHaveLength(0);
    expect(await client.listDerivativeInstruments("option", "AVAX")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await expect(client.getDerivativeInstrument("okx:spot:BTC-USDT-SWAP")).rejects.toThrow("identity");
    await expect(client.getDerivativeInstrument("okx:future:BTC-USDT-SWAP")).rejects.toThrow("mismatched");
    await expect(client.getDerivativeInstrument("deribit:perpetual:BTC-PERPETUAL")).rejects.toThrow("identity");
  });

  it("converts IV percent and base-coin open interest, preserving premium per base coin", async () => {
    const fetcher = mockApi((url) => url.pathname.endsWith("get_instrument") ? option : { instrument_name: option.instrument_name, state: "open", timestamp: NOW, best_bid_price: 1.2, best_ask_price: 1.3, last_price: null, mark_price: 1.25, index_price: 20, open_interest: 1200, mark_iv: 65, greeks: { delta: 0.51 } });
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false });
    const [first, second] = await Promise.all([client.getDerivativeQuote(optionId), client.getDerivativeQuote(optionId)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ instrumentId: optionId, bid: 1.2, ask: 1.3, mark: 1.25, last: null, iv: 0.65, openInterest: 12, delta: 0.51, source: "native-api" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps coin-option premium in settlement coins per base coin", async () => {
    const coin = { ...option, instrument_name: "BTC-25DEC26-80000-C", base_currency: "BTC", counter_currency: "USD", settlement_currency: "BTC", instrument_type: "reversed", contract_size: 1, min_trade_amount: 0.1 };
    const fetcher = mockApi((url) => url.pathname.endsWith("get_instrument") ? coin : { instrument_name: coin.instrument_name, state: "open", timestamp: NOW, best_bid_price: 0.024, best_ask_price: 0.026, mark_price: 0.025, index_price: 80000, open_interest: 10, mark_iv: 50 });
    const quote = await new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false }).getDerivativeQuote(`deribit:option:${coin.instrument_name}`);
    expect(quote).toMatchObject({ bid: 0.024, ask: 0.026, mark: 0.025, index: 80000, openInterest: 10, iv: 0.5 });
  });

  it("coalesces pending requests beyond the result TTL and protects cached values", async () => {
    let now = NOW;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>(async () => {
      await gate;
      return new Response(JSON.stringify({ code: "0", data: [okx] }));
    });
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => now, fixture: false });
    const first = client.getDerivativeInstrument(okxId);
    now += 31000;
    const second = client.getDerivativeInstrument(okxId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    release();
    const results = await Promise.all([first, second]);
    results[0]!.contractSize = 999;
    expect((await client.getDerivativeInstrument(okxId)).contractSize).toBe(0.01);
    expect(results[1]!.contractSize).toBe(0.01);
  });

  it("normalizes OKX contract volume, drops forming bars and preserves gaps", async () => {
    const fetcher = mockApi((url) => url.pathname.endsWith("instruments") ? [okx] : [
      [NOW - 60000, "100", "102", "99", "101", "3", "0.03", "3.03", "0"],
      [NOW - 120000, "100", "102", "99", "101", "10", "0.1", "10.1", "1"],
      [NOW - 300000, "100", "102", "99", "101", "20", "0.2", "20.2", "1"],
    ]);
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false });
    const candles = await client.getDerivativeCandles(okxId, "1m", 3);
    expect(candles.map((bar) => bar.timestamp)).toEqual([NOW - 300000, NOW - 120000]);
    expect(candles.map((bar) => bar.volume)).toEqual([0.2, 0.1]);
    await expect(client.getDerivativeCandles(okxId, "1m", 301)).rejects.toThrow("limit");
  });
});

describe("quote validity", () => {
  it.each([null, NOW - 30_001, NOW + 5_001, "", "NaN"])("rejects invalid native timestamp %s", async (timestamp) => {
    const fetcher = mockApi((url) => url.pathname.endsWith("get_instrument") ? option : { instrument_name: option.instrument_name, state: "open", timestamp, mark_price: 1 });
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false });
    await expect(client.getDerivativeQuote(optionId)).rejects.toThrow("timestamp");
  });

  it.each([
    { instrument_name: "wrong", mark_price: 1 },
    { instrument_name: option.instrument_name, best_bid_price: 2, best_ask_price: 1 },
    { instrument_name: option.instrument_name, mark_price: "NaN" },
    { instrument_name: option.instrument_name, mark_price: -1 },
  ])("rejects wrong identity or invalid prices: %j", async (fields) => {
    const fetcher = mockApi((url) => url.pathname.endsWith("get_instrument") ? option : { state: "open", timestamp: NOW, ...fields });
    await expect(new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false }).getDerivativeQuote(optionId)).rejects.toThrow();
  });

  it("discards stale optional OKX fields and uses upcoming fundingTime", async () => {
    const fetcher = mockApi((url) => {
      if (url.pathname.endsWith("instruments")) return [okx];
      const row = { instId: okx.instId, ts: NOW };
      if (url.pathname.endsWith("ticker")) return [{ ...row, bidPx: "100", askPx: "101", last: "100.5" }];
      if (url.pathname.endsWith("funding-rate")) return [{ ...row, fundingRate: "0.0001", fundingTime: NOW + 1000, nextFundingTime: NOW + 2000 }];
      if (url.pathname.endsWith("open-interest")) return [{ ...row, oi: "123" }];
      return [{ ...row, ts: NOW - 30001, markPx: "100" }];
    });
    const quote = await new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false }).getDerivativeQuote(okxId);
    expect(quote).toMatchObject({ mark: null, index: null, openInterest: 123, fundingRate: 0.0001, nextFundingAt: NOW + 1000 });
  });

  it("does not quote inactive or expired instruments", async () => {
    for (const metadata of [{ ...option, is_active: false }, { ...option, expiration_timestamp: NOW - 1 }]) {
      const fetcher = mockApi(() => metadata);
      await expect(new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false }).getDerivativeQuote(optionId)).rejects.toThrow("inactive or expired");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("retries after an API failure rather than caching the error", async () => {
    const fetcher = mockApi(() => [okx]);
    fetcher.mockRejectedValueOnce(new Error("timeout"));
    const client = new NativeDerivativeMarketData({ fetch: fetcher, now: () => NOW, fixture: false });
    await expect(client.getDerivativeInstrument(okxId)).rejects.toThrow("timeout");
    expect((await client.getDerivativeInstrument(okxId)).id).toBe(okxId);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("deterministic fixture environment", () => {
  it.each(["NEWBEING_MARKET_DATA_FIXTURE", "NEWBEING_E2E_FIXTURES"])("supports %s without native calls", async (key) => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEWBEING_MARKET_DATA_FIXTURE", "0");
    vi.stubEnv("NEWBEING_E2E_FIXTURES", "0");
    vi.stubEnv(key, "1");
    const fetcher = vi.fn<typeof fetch>();
    const client = new NativeDerivativeMarketData({ fetch: fetcher });
    for (const kind of ["perpetual", "future", "option"] as const) {
      const list = await client.listDerivativeInstruments(kind);
      expect(list).toHaveLength(kind === "future" ? 2 : 1);
      const instrument = list[0]!;
      expect(instrument.source).toBe("fixture");
      expect(await client.getDerivativeInstrument(instrument.id)).toEqual(instrument);
      const quote = await client.getDerivativeQuote(instrument.id);
      expect(quote.source).toBe("fixture");
      expect(await client.getDerivativeQuote(instrument.id)).toEqual(quote);
      if (kind === "option") await expect(client.getDerivativeCandles(instrument.id, "1m", 10)).rejects.toThrow("unsupported");
      else expect(await client.getDerivativeCandles(instrument.id, "1m", 10)).toEqual(await client.getDerivativeCandles(instrument.id, "1m", 10));
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the legacy E2E fixture disabled in production", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEWBEING_E2E_FIXTURES", "1"); vi.stubEnv("NEWBEING_MARKET_DATA_FIXTURE", "0");
    const fetcher = mockApi(() => [okx]);
    expect((await new NativeDerivativeMarketData({ fetch: fetcher }).getDerivativeInstrument(okxId)).source).toBe("native-api");
  });

  it("keeps the market-data fixture flag disabled in production", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEWBEING_E2E_FIXTURES", "0"); vi.stubEnv("NEWBEING_MARKET_DATA_FIXTURE", "1");
    const fetcher = mockApi(() => [okx]);
    expect((await new NativeDerivativeMarketData({ fetch: fetcher }).getDerivativeInstrument(okxId)).source).toBe("native-api");
    expect(fetcher).toHaveBeenCalled();
  });

  it("stamps fixture quotes at read time so Paper freshness checks can pass", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEWBEING_MARKET_DATA_FIXTURE", "0");
    vi.stubEnv("NEWBEING_E2E_FIXTURES", "1");
    const fetcher = vi.fn<typeof fetch>();
    const now = NOW + 86_400_000;
    const client = new NativeDerivativeMarketData({ fetch, now: () => now });
    const quote = await client.getDerivativeQuote("deribit:future:BTC_USDC-25DEC26");
    expect(quote.timestamp).toBe(now);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
