import process from "node:process";
import { describe, expect, it } from "vitest";
import { NativeDerivativeMarketData } from "../src/derivatives/client.js";

/** Opt in only: network availability must not change deterministic unit tests. */
describe.skipIf(process.env.NEWBEING_DERIVATIVES_LIVE !== "1")("native derivatives public API smoke", () => {
  it("reads OKX USDT perpetuals and dated linear futures when native listings exist", async () => {
    const client = new NativeDerivativeMarketData({ fixture: false });
    const perpetuals = await client.listDerivativeInstruments("perpetual", "BTC");
    expect(perpetuals.length).toBeGreaterThan(0);
    const perpetual = await client.getDerivativeInstrument(perpetuals[0]!.id);
    expect(perpetual).toMatchObject({ venue: "okx", kind: "perpetual", settle: "USDT", linear: true, source: "native-api" });
    expect((await client.getDerivativeQuote(perpetual.id)).mark).not.toBeNull();
    expect((await client.getDerivativeCandles(perpetual.id, "1m", 5)).length).toBeGreaterThan(0);

    // OKX currently lists no active USDT linear FUTURES, so dated-future live
    // coverage runs against Deribit USDC linear futures instead.
    const futures = await client.listDerivativeInstruments("future", "BTC_USDC");
    expect(futures.length).toBeGreaterThan(0);
    const future = await client.getDerivativeInstrument(futures.find((item) => item.venue === "deribit")?.id ?? futures[0]!.id);
    expect(future).toMatchObject({ kind: "future", linear: true, source: "native-api" });
    expect(future.contractSize).toBeGreaterThan(0);
    const quote = await client.getDerivativeQuote(future.id);
    expect(quote.instrumentId).toBe(future.id);
    expect(quote.mark).not.toBeNull();
    const candles = await client.getDerivativeCandles(future.id, "1h", 5);
    expect(candles.length).toBeGreaterThan(0);
    expect(candles.length).toBeLessThanOrEqual(5);
  }, 60_000);

  it("reads an actually listed Deribit BTC USDC linear option", async () => {
    const client = new NativeDerivativeMarketData({ fixture: false });
    const listed = await client.listDerivativeInstruments("option", "BTC_USDC");
    expect(listed.length).toBeGreaterThan(0);
    const instrument = await client.getDerivativeInstrument(listed[0]!.id);
    expect(instrument).toMatchObject({ venue: "deribit", kind: "option", settle: "USDC", linear: true, source: "native-api" });
    expect(instrument.contractSize).toBeGreaterThan(0);
    const quote = await client.getDerivativeQuote(instrument.id);
    expect(quote.mark).not.toBeNull();
    expect(quote.iv).not.toBeNull();
    await expect(client.getDerivativeCandles(instrument.id, "1m", 5)).rejects.toThrow("unsupported");
  }, 45_000);
});
