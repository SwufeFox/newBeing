import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ workspace: "terminal", instrument: vi.fn(), quote: vi.fn(), read: vi.fn(), open: vi.fn(), execute: vi.fn() }));
vi.mock("@newbeing/storage", () => ({ getWorkspaceState: () => ({ state: { activeWorkspace: fixture.workspace } }) }));
vi.mock("@newbeing/market-data/derivatives", () => ({ getDerivativeInstrument: fixture.instrument, getDerivativeQuote: fixture.quote }));
vi.mock("@newbeing/application/derivatives", () => ({ getDerivativesAccount: fixture.read, openDerivativesAccount: fixture.open, executeDerivativesOrder: fixture.execute }));
import { GET, POST } from "../src/app/api/derivatives/account/route.js";

const id = "okx:perpetual:BTC-USDT-SWAP";
const optionId = "deribit:option:BTC-25DEC26-80000-C";
const native = { id, venue: "okx", settle: "USDT", kind: "perpetual", source: "native-api" };
const order = { action: "order", instrumentId: id, clientOrderId: "derivative-test-once", side: "buy", contracts: 1, leverage: 5, reduceOnly: false, limitPrice: 80001 };
const request = (body: unknown) => new Request("http://localhost/api/derivatives/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  fixture.workspace = "terminal";
  fixture.instrument.mockResolvedValue(native);
  fixture.read.mockReturnValue(undefined);
  fixture.open.mockReturnValue({ id: "derivatives:okx:USDT" });
  fixture.execute.mockImplementation(async (input: unknown) => ({ account: { id: "derivatives:okx:USDT" }, order: input, deduplicated: false }));
});
afterEach(() => vi.resetAllMocks());

describe("derivatives Paper HTTP intent mapping", () => {
  it("reading never seeds and explicit open takes settlement currency from native metadata", async () => {
    const read = await GET(new Request(`http://localhost/api/derivatives/account?instrumentId=${id}`));
    expect(read.status).toBe(200);
    expect((await read.json()).account).toBeNull();
    expect(fixture.open).not.toHaveBeenCalled();
    expect((await POST(request({ action: "open", instrumentId: id }))).status).toBe(200);
    expect(fixture.open).toHaveBeenCalledWith("okx", "USDT", "10000");
    expect((await POST(request({ action: "open", instrumentId: id, initialBalance: "100000000" }))).status).toBe(400);
  });

  it("uses a coin-denominated seed for a coin-settled option account", async () => {
    fixture.instrument.mockResolvedValueOnce({ ...native, id: optionId, venue: "deribit", kind: "option", settle: "BTC" });
    expect((await POST(request({ action: "open", instrumentId: optionId }))).status).toBe(200);
    expect(fixture.open).toHaveBeenCalledWith("deribit", "BTC", "1");
  });

  it("separates opening a short contract from buying to close it", async () => {
    expect((await POST(request({ ...order, side: "sell" }))).status).toBe(200);
    expect(fixture.execute.mock.calls[0]![0]).toMatchObject({ action: "open", side: "short", reduceOnly: false, quantity: "1", maximumPrice: "80001", leverage: 5 });
    expect((await POST(request({ ...order, reduceOnly: true }))).status).toBe(200);
    expect(fixture.execute.mock.calls[1]![0]).toMatchObject({ action: "close", side: "short", reduceOnly: true });
  });

  it("maps option sells exclusively to closing longs and preserves small decimal premiums", async () => {
    fixture.instrument.mockResolvedValueOnce({ ...native, id: optionId, venue: "deribit", kind: "option", settle: "BTC" });
    const response = await POST(request({ ...order, instrumentId: optionId, side: "sell", leverage: 1, contracts: "0.1", limitPrice: 0.00000001 }));
    expect(response.status).toBe(200);
    expect(fixture.execute.mock.calls[0]![0]).toMatchObject({ instrumentId: optionId, action: "close", side: "long", reduceOnly: true, quantity: "0.1", maximumPrice: "0.00000001" });
  });

  it("rejects malformed and unsupported commands before contacting a provider", async () => {
    expect((await POST(request({ ...order, leverage: 21 }))).status).toBe(400);
    expect((await POST(request({ ...order, action: "live" }))).status).toBe(400);
    expect((await POST(request({ ...order, instrumentId: "okx:spot:BTC-USDT" }))).status).toBe(400);
    expect(fixture.instrument).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it("blocks commands both before a live read and after a metadata wait when Replay starts", async () => {
    fixture.workspace = "replay";
    expect((await POST(request(order))).status).toBe(409);
    expect(fixture.instrument).not.toHaveBeenCalled();
    fixture.workspace = "terminal";
    fixture.instrument.mockImplementationOnce(async () => { fixture.workspace = "replay"; return native; });
    expect((await POST(request(order))).status).toBe(409);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it("reports a persisted outcome when an acknowledgement fails instead of suggesting a new intent", async () => {
    fixture.execute.mockRejectedValueOnce(new Error("Acknowledgement unavailable."));
    fixture.read.mockReturnValueOnce({ id: "derivatives:okx:USDT", orders: [{ clientOrderId: order.clientOrderId, status: "filled" }] });
    const response = await POST(request(order));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("Acknowledgement unavailable.");
    expect(body.intentRecorded).toBe(true);
    expect(body.order.clientOrderId).toBe(order.clientOrderId);
  });
});
