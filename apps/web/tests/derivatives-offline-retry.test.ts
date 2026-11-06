import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabaseForTests, getWorkspaceState, saveWorkspaceState } from "@newbeing/storage";
import { executeDerivativesOrder, getDerivativesAccount, openDerivativesAccount, type DerivativesInstrument } from "@newbeing/application/derivatives";

const exchange = vi.hoisted(() => ({ instrument: vi.fn(), quote: vi.fn() }));
vi.mock("@newbeing/market-data/derivatives", () => ({ getDerivativeInstrument: exchange.instrument, getDerivativeQuote: exchange.quote }));
import { GET as getAccount, POST } from "../src/app/api/derivatives/account/route.js";
import { GET as getAccounts } from "../src/app/api/derivatives/accounts/route.js";
import { GET as getOrders } from "../src/app/api/derivatives/orders/route.js";

const instrument: DerivativesInstrument = {
  id: "okx:perpetual:BTC-USDT-SWAP", venue: "okx", nativeId: "BTC-USDT-SWAP", kind: "perpetual",
  base: "BTC", quote: "USDT", settle: "USDT", contractSize: 0.01, linear: true, inverse: false,
  expiry: null, strike: null, optionRight: null, active: true, quantityStep: 0.1, minContracts: 0.1,
  priceTick: 0.1, source: "native-api",
};
const order = {
  venue: "okx" as const, settle: "USDT", instrumentId: instrument.id, clientOrderId: "offline-retry-001",
  action: "open" as const, side: "long" as const, quantity: "2", leverage: 10, reduceOnly: false, maximumPrice: "100",
};
const body = { action: "order", instrumentId: instrument.id, clientOrderId: order.clientOrderId, side: "buy", contracts: "2", leverage: 10, reduceOnly: false, limitPrice: "100" };
const post = (value: unknown, query = "") => POST(new Request(`http://localhost/api/derivatives/account${query}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
}));
let directory = "";
const previousDirectory = process.env.NEWBEING_DATA_DIR;

beforeEach(async () => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-derivatives-offline-"));
  process.env.NEWBEING_DATA_DIR = directory;
  openDerivativesAccount("okx", "USDT", "100");
  await executeDerivativesOrder(order, {
    getDerivativeInstrument: async () => instrument,
    getDerivativeQuote: async () => ({ instrumentId: instrument.id, timestamp: Date.now(), bid: 99, ask: 100, source: "native-api" }),
  });
  exchange.instrument.mockRejectedValue(new Error("Exchange metadata unavailable."));
  exchange.quote.mockReset();
});
afterEach(() => {
  closeDatabaseForTests();
  if (previousDirectory === undefined) delete process.env.NEWBEING_DATA_DIR; else process.env.NEWBEING_DATA_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
  vi.resetAllMocks();
});

describe("derivatives order recovery while the exchange is unavailable", () => {
  it("loads only recent orders while preserving older offline retries and full history", async () => {
    const market = {
      getDerivativeInstrument: async () => instrument,
      getDerivativeQuote: async () => ({ instrumentId: instrument.id, timestamp: Date.now(), bid: 99, ask: 100, source: "native-api" as const }),
    };
    for (let index = 0; index < 21; index++) {
      await executeDerivativesOrder({ ...order, clientOrderId: `later-order-${index}` }, market, undefined, 20);
    }
    const before = getDerivativesAccount("okx", "USDT")!;
    const response = await getAccounts(new Request("http://localhost/api/derivatives/accounts"));
    expect(response.status).toBe(200);
    const snapshot = (await response.json()).accounts[0];
    expect(snapshot.orderCount).toBe(22);
    expect(snapshot.orders).toHaveLength(20);
    expect(snapshot.orders[0].clientOrderId).toBe("later-order-1");
    expect(snapshot.orders[19].clientOrderId).toBe("later-order-20");
    const firstPageResponse = await getOrders(new Request("http://localhost/api/derivatives/orders?venue=okx&settle=USDT"));
    expect(firstPageResponse.status).toBe(200);
    const firstPage = await firstPageResponse.json();
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.orders.map((item: { clientOrderId: string }) => item.clientOrderId)).toEqual(snapshot.orders.map((item: { clientOrderId: string }) => item.clientOrderId).reverse());
    const nextPage = await getOrders(new Request(`http://localhost/api/derivatives/orders?venue=okx&settle=USDT&before=${firstPage.orders[19].clientOrderId}`));
    expect(await nextPage.json()).toMatchObject({ hasMore: false, orders: [{ clientOrderId: "later-order-0" }, { clientOrderId: order.clientOrderId }] });
    expect((await getOrders(new Request("http://localhost/api/derivatives/orders?venue=okx&settle=USDT&before=missing"))).status).toBe(400);
    expect((await getOrders(new Request("http://localhost/api/derivatives/orders?venue=invalid&settle=USDT"))).status).toBe(400);
    expect((await getOrders(new Request("http://localhost/api/derivatives/orders?venue=deribit&settle=USDT"))).status).toBe(400);
    expect((await getOrders(new Request("http://localhost/api/derivatives/orders?venue=okx&settle=USDT&orderLimit=20"))).status).toBe(400);

    const accountResponse = await getAccount(new Request(`http://localhost/api/derivatives/account?instrumentId=${encodeURIComponent(instrument.id)}`));
    expect((await accountResponse.json()).account.orders).toEqual(snapshot.orders);
    const retry = await post(body);
    expect(retry.status).toBe(200);
    const recovered = await retry.json();
    expect(recovered).toMatchObject({ deduplicated: true, order: { clientOrderId: order.clientOrderId }, account: { orderCount: 22 } });
    expect(recovered.account.orders).toEqual(snapshot.orders);
    expect(getDerivativesAccount("okx", "USDT")).toEqual(before);
    expect(exchange.quote).not.toHaveBeenCalled();
  });

  it("rejects the removed history limit before contacting the exchange or mutating accounts", async () => {
    const before = getDerivativesAccount("okx", "USDT");
    const responses = [
      await getAccounts(new Request("http://localhost/api/derivatives/accounts?orderLimit=20")),
      await getAccount(new Request(`http://localhost/api/derivatives/account?instrumentId=${encodeURIComponent(instrument.id)}&orderLimit=20`)),
      await post(body, "?orderLimit=20"),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("orderLimit");
    }
    expect(exchange.instrument).not.toHaveBeenCalled();
    expect(getDerivativesAccount("okx", "USDT")).toEqual(before);
  });

  it("seeds a coin-settled option account in its native currency", async () => {
    const optionId = "deribit:option:BTC-25DEC30-100000-C";
    exchange.instrument.mockResolvedValueOnce({ ...instrument, id: optionId, venue: "deribit", kind: "option", settle: "BTC" });
    const response = await post({ action: "open", instrumentId: optionId });
    expect(response.status).toBe(200);
    expect((await response.json()).account).toMatchObject({ venue: "deribit", settle: "BTC", initialBalance: "1", available: "1", orderCount: 0, orders: [] });
  });

  it("returns the original fill after a lost response and rejects changed intent", async () => {
    const before = getDerivativesAccount("okx", "USDT");
    closeDatabaseForTests();
    const retry = await post(body);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ deduplicated: true, order: { clientOrderId: order.clientOrderId, fillPrice: "100" } });
    expect(getDerivativesAccount("okx", "USDT")).toEqual(before);
    const changed = await post({ ...body, limitPrice: "101" });
    expect(changed.status).toBe(422);
    expect((await changed.json()).error).toMatch(/different parameters/);
    expect(getDerivativesAccount("okx", "USDT")).toEqual(before);
    expect(exchange.quote).not.toHaveBeenCalled();
  });

  it("does not invent an order for an unknown identity and still blocks Replay", async () => {
    const before = getDerivativesAccount("okx", "USDT");
    expect((await post({ ...body, clientOrderId: "unknown-order-001" })).status).toBe(422);
    expect(getDerivativesAccount("okx", "USDT")).toEqual(before);
    saveWorkspaceState({ ...getWorkspaceState().state, activeWorkspace: "replay" });
    const history = await getOrders(new Request("http://localhost/api/derivatives/orders?venue=okx&settle=USDT"));
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ orders: [{ clientOrderId: order.clientOrderId }], hasMore: false });
    exchange.instrument.mockClear();
    expect((await post(body)).status).toBe(409);
    expect(exchange.instrument).not.toHaveBeenCalled();
  });

  it("recovers a sell-to-close option using its stored settlement account", async () => {
    const option: DerivativesInstrument = {
      ...instrument, id: "deribit:option:BTC-25DEC30-100000-C", nativeId: "BTC-25DEC30-100000-C",
      venue: "deribit", kind: "option", quote: "USD", settle: "BTC", contractSize: 1, linear: false,
      expiry: Date.now() + 86_400_000, strike: 100000, optionRight: "call", priceTick: 0.0001,
    };
    const market = {
      getDerivativeInstrument: async () => option,
      getDerivativeQuote: async () => ({ instrumentId: option.id, timestamp: Date.now(), bid: 0.009, ask: 0.01, source: "native-api" as const }),
    };
    openDerivativesAccount("deribit", "BTC", "1");
    const optionOrder = { ...order, venue: "deribit" as const, settle: "BTC", instrumentId: option.id, quantity: "0.1", leverage: 1, maximumPrice: "0.01" };
    await executeDerivativesOrder({ ...optionOrder, clientOrderId: "option-open-001" }, market);
    await executeDerivativesOrder({ ...optionOrder, clientOrderId: "option-close-001", action: "close", reduceOnly: true, maximumPrice: "0.009" }, market);
    const before = getDerivativesAccount("deribit", "BTC");
    const response = await post({ action: "order", instrumentId: option.id, clientOrderId: "option-close-001", side: "sell", contracts: "0.1", leverage: 1, reduceOnly: false, limitPrice: "0.009" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deduplicated: true, order: { action: "close", side: "long" } });
    expect(getDerivativesAccount("deribit", "BTC")).toEqual(before);
  });

  it("rejects a retry if Replay starts while metadata is being fetched", async () => {
    exchange.instrument.mockImplementationOnce(async () => {
      saveWorkspaceState({ ...getWorkspaceState().state, activeWorkspace: "replay" });
      throw new Error("Exchange metadata unavailable.");
    });
    expect((await post(body)).status).toBe(409);
  });
});
