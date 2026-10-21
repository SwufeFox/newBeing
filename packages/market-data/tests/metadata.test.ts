import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ precisionMode: undefined as number | undefined }));
vi.mock("ccxt", () => {
  class FixtureExchange {
    name = undefined;
    has = { fetchOHLCV: true, fetchTicker: "emulated" };
    timeframes = { "1m": "1m", "1h": "1h" };
    get precisionMode() { return fixture.precisionMode; }
    async loadMarkets() { return {}; }
    market() {
      return { id: "XXBTZUSD", symbol: "BTC/USD", base: "BTC", quote: "USD", spot: true, active: true, precision: {}, limits: {} };
    }
  }
  return { default: { kraken: FixtureExchange } };
});
import { CcxtSpotAdapter } from "../src/binance.js";

describe("native connector metadata", () => {
  it("preserves native venue identity and represents missing precision as unknown", async () => {
    fixture.precisionMode = undefined;
    const adapter = new CcxtSpotAdapter("kraken");
    const instrument = await adapter.getInstrument("BTC/USD");
    expect(instrument).toMatchObject({ id: "kraken:spot:XXBTZUSD", nativeId: "XXBTZUSD", symbol: "BTC/USD", precision: { amount: null, price: null, mode: null }, limits: { amount: { min: null, max: null }, cost: { min: null, max: null } } });
    fixture.precisionMode = 4;
    expect((await adapter.getInstrument("BTC/USD")).precision.mode).toBe(4);
    expect(adapter.getConnectorMetadata()).toMatchObject({ id: "kraken", name: "kraken", capabilities: { fetchOHLCV: true, fetchTicker: "emulated", fetchTrades: false }, realExecution: false });
  });
});
