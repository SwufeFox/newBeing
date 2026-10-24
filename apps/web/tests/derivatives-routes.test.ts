import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  workspace: "terminal",
  list: vi.fn(), instrument: vi.fn(), quote: vi.fn(), candles: vi.fn(),
}));
vi.mock("@newbeing/storage", () => ({ getWorkspaceState: () => ({ state: { activeWorkspace: fixture.workspace } }) }));
vi.mock("@newbeing/market-data/derivatives", () => ({
  listDerivativeInstruments: fixture.list,
  getDerivativeInstrument: fixture.instrument,
  getDerivativeQuote: fixture.quote,
  getDerivativeCandles: fixture.candles,
}));
import { GET as markets } from "../src/app/api/derivatives/markets/route.js";
import { GET as market } from "../src/app/api/derivatives/market/route.js";

const id = "okx:perpetual:BTC-USDT-SWAP";
const nativeInstrument = { id, venue: "okx", nativeId: "BTC-USDT-SWAP", kind: "perpetual", source: "native-api" };
const request = (path: string) => new Request(`http://localhost/api/derivatives/${path}`);

beforeEach(() => {
  fixture.workspace = "terminal";
  fixture.list.mockResolvedValue([nativeInstrument]);
  fixture.instrument.mockResolvedValue(nativeInstrument);
  fixture.quote.mockResolvedValue({ instrumentId: id, bid: 79999, ask: 80001, mark: 80000, timestamp: Date.now(), source: "native-api" });
  fixture.candles.mockResolvedValue([{ timestamp: 0, open: 80000, high: 80001, low: 79999, close: 80000, volume: 1 }]);
});
afterEach(() => vi.resetAllMocks());

describe("derivatives public HTTP boundary", () => {
  it("passes an explicit product kind and search without changing the spot workspace", async () => {
    const response = await markets(request("markets?kind=future&query=BTC"));
    expect(response.status).toBe(200);
    expect(fixture.list).toHaveBeenCalledWith("future", "BTC");
    expect(await response.json()).toEqual({ instruments: [nativeInstrument], source: "public" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.workspace).toBe("terminal");
  });

  it("rejects invalid categories, spot identities and unbounded candle requests before network access", async () => {
    expect((await markets(request("markets?kind=spot"))).status).toBe(400);
    expect((await market(request("market?instrumentId=okx:spot:BTC-USDT"))).status).toBe(400);
    expect((await market(request(`market?instrumentId=${id}&limit=100000`))).status).toBe(400);
    expect(fixture.list).not.toHaveBeenCalled();
    expect(fixture.instrument).not.toHaveBeenCalled();
  });

  it("retains the real option quote when a provider cannot supply option candles", async () => {
    fixture.candles.mockRejectedValueOnce(new Error("Sparse option history is unavailable."));
    const response = await market(request(`market?instrumentId=${id}&timeframe=1h&limit=120`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.instrument.id).toBe(id);
    expect(body.quote.bid).toBe(79999);
    expect(body.candles).toEqual([]);
    expect(body.candleError).toBe("Sparse option history is unavailable.");
    expect(fixture.candles).toHaveBeenCalledWith(id, "1h", 120);
  });

  it("identifies synthetic test data instead of labelling it public", async () => {
    fixture.list.mockResolvedValueOnce([{ ...nativeInstrument, source: "fixture" }]);
    expect((await (await markets(request("markets?kind=perpetual"))).json()).source).toBe("fixture");
  });

  it("does not contact live derivatives while a frozen Replay is active", async () => {
    fixture.workspace = "replay";
    expect((await markets(request("markets?kind=option"))).status).toBe(409);
    expect((await market(request(`market?instrumentId=${id}`))).status).toBe(409);
    expect(fixture.list).not.toHaveBeenCalled();
    expect(fixture.instrument).not.toHaveBeenCalled();
    expect(fixture.quote).not.toHaveBeenCalled();
  });

  it("drops a public response if Replay starts while the request is outstanding", async () => {
    fixture.list.mockImplementationOnce(async () => {
      fixture.workspace = "replay";
      return [nativeInstrument];
    });
    const response = await markets(request("markets?kind=perpetual"));
    expect(response.status).toBe(409);
    expect((await response.json()).instruments).toBeUndefined();
  });

  it("drops a market response if Replay starts after native metadata has loaded", async () => {
    fixture.quote.mockImplementationOnce(async () => {
      fixture.workspace = "replay";
      return { instrumentId: id, mark: 80000 };
    });
    const response = await market(request(`market?instrumentId=${id}`));
    expect(response.status).toBe(409);
    expect((await response.json()).quote).toBeUndefined();
  });
});
