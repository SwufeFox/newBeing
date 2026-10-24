import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabaseForTests, getDatabase, getWorkspaceState, saveWorkspaceState } from "@newbeing/storage";
import { executeDerivativesOrder, getDerivativesAccount, openDerivativesAccount, valueDerivativesPosition, type DerivativesInstrument, type DerivativesMarketData, type DerivativesQuote } from "../src/derivatives.js";
import { DERIVATIVES_POLICY, type DerivativesOrderRequest } from "../src/derivatives-types.js";

let directory: string;
const previousDirectory = process.env.NEWBEING_DATA_DIR;
const timestamp = 1_800_000_000_000;
const clock = () => timestamp;
const instrument = (patch: Partial<DerivativesInstrument> = {}): DerivativesInstrument => ({
  id: "okx:perpetual:BTC-USDT-SWAP", venue: "okx", nativeId: "BTC-USDT-SWAP", kind: "perpetual", base: "BTC", quote: "USDT", settle: "USDT", contractSize: 0.01,
  linear: true, inverse: false, expiry: null, strike: null, optionRight: null, active: true, quantityStep: 0.1, minContracts: 0.1, priceTick: 0.1, source: "native-api", ...patch,
});
const request = (patch: Partial<DerivativesOrderRequest> = {}): DerivativesOrderRequest => ({
  venue: "okx", settle: "USDT", instrumentId: instrument().id, clientOrderId: "open-one", action: "open", side: "long", quantity: "2", leverage: 10, reduceOnly: false, maximumPrice: "100", ...patch,
});
function connector(i = instrument(), bid = 99, ask = 100, patch: Partial<DerivativesQuote> = {}): DerivativesMarketData {
  return { getDerivativeInstrument: vi.fn(async () => i), getDerivativeQuote: vi.fn(async (): Promise<DerivativesQuote> => ({ instrumentId: i.id, timestamp, bid, ask, source: "native-api", ...patch })) };
}
const execute = (r = request(), m = connector()) => executeDerivativesOrder(r, m, clock);
const account = () => getDerivativesAccount("okx", "USDT")!;
beforeEach(() => {
  closeDatabaseForTests(); directory = mkdtempSync(path.join(tmpdir(), "newbeing-derivatives-app-")); process.env.NEWBEING_DATA_DIR = directory;
  openDerivativesAccount("okx", "USDT", "100", "0.001");
});
afterEach(() => {
  closeDatabaseForTests();
  if (previousDirectory === undefined) delete process.env.NEWBEING_DATA_DIR; else process.env.NEWBEING_DATA_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe("linear isolated Paper accounting", () => {
  it("charges exact contract-scaled margin and fees; releases proportional collateral on reduce-only", async () => {
    const opened = await execute();
    expect(opened.account.available).toBe("99.798");
    expect(opened.account.positions[0]).toMatchObject({ quantity: "2", margin: "0.2", entryPrice: "100", contractSize: "0.01" });
    expect(opened.order.fee).toBe("0.002");
    const closed = await execute(request({ action: "close", quantity: "1", reduceOnly: true, clientOrderId: "partial-close", maximumPrice: "110" }), connector(instrument(), 110, 111));
    expect(closed.order.realizedPnl).toBe("0.1");
    expect(closed.order.fee).toBe("0.0011");
    expect(closed.account.available).toBe("99.9969");
    expect(closed.account.positions[0]).toMatchObject({ quantity: "1", margin: "0.1" });
    const final = await execute(request({ action: "close", quantity: "1", clientOrderId: "final-close", maximumPrice: "90" }), connector(instrument(), 90, 91));
    expect(final.account.positions).toEqual([]);
    expect(final.account.available).toBe("99.996");
    expect(final.account.realizedPnl).toBe("0");
    expect(final.account.feesPaid).toBe("0.004");
  });
  it("supports short entry at bid and close at ask with the correct PNL sign", async () => {
    await execute(request({ side: "short", maximumPrice: "99" }));
    const result = await execute(request({ side: "short", action: "close", clientOrderId: "cover", maximumPrice: "91", reduceOnly: true }), connector(instrument(), 90, 91));
    expect(result.order.fillPrice).toBe("91"); expect(result.order.realizedPnl).toBe("0.16");
    expect(result.account.available).toBe("100.1562");
  });
  it("uses Decimal for fractional contracts and tiny settle amounts", async () => {
    const tiny = instrument({ contractSize: 0.00000001, priceTick: 0.00000001 });
    const result = await execute(request({ quantity: "0.3", maximumPrice: "0.00000003", leverage: 1 }), connector(tiny, 0.00000002, 0.00000003));
    expect(result.account.positions[0]?.margin).toBe("0.00000000000000009");
    expect(result.order.fee).toBe("0.00000000000000000009");
    expect(result.account.available).toBe("99.99999999999999990991");
    closeDatabaseForTests(); expect(account()).toEqual(result.account);
  });
  it("maintains weighted entry and margin when adding; supports the leverage endpoints", async () => {
    await execute(request({ leverage: 20 }));
    const added = await execute(request({ leverage: 20, clientOrderId: "add", maximumPrice: "200" }), connector(instrument(), 199, 200));
    expect(added.account.positions[0]).toMatchObject({ quantity: "4", entryPrice: "150", margin: "0.3", leverage: 20 });
    await expect(execute(request({ leverage: 1, clientOrderId: "different-leverage" }))).rejects.toThrow(/leverage changed/);
  });
  it("caps local losses at allocated margin and exposes the model policy", async () => {
    await execute();
    const result = await execute(request({ action: "close", clientOrderId: "loss", maximumPrice: "1" }), connector(instrument(), 1, 2));
    expect(result.order.realizedPnl).toBe("-0.2");
    expect(result.account.available).toBe("99.79798");
    expect(result.account.policy).toEqual(DERIVATIVES_POLICY);
    expect(result.account.policy.funding).toBe("not-accrued-no-official-ledger");
  });
  it("shares settle cash across instruments while keeping positions and namespaces independent", async () => {
    await execute();
    const eth = instrument({ id: "okx:perpetual:ETH-USDT-SWAP", nativeId: "ETH-USDT-SWAP" });
    await execute(request({ instrumentId: eth.id, clientOrderId: "eth" }), connector(eth));
    expect(account().available).toBe("99.596"); expect(account().positions).toHaveLength(2);
    expect(openDerivativesAccount("deribit", "BTC", "1").available).toBe("1");
    expect(openDerivativesAccount("okx", "USDT", "99999").available).toBe("99.596");
  });
});

describe("long options in the official settle currency", () => {
  const option = () => instrument({ id: "deribit:option:BTC-25DEC30-100000-C", nativeId: "BTC-25DEC30-100000-C", venue: "deribit", kind: "option", quote: "USD", settle: "BTC", contractSize: 1, linear: false, inverse: false, expiry: timestamp + 86400000, strike: 100000, optionRight: "call", minContracts: 0.1, quantityStep: 0.1, priceTick: 0.0001 });
  const optionOrder = (patch: Partial<DerivativesOrderRequest> = {}) => request({ venue: "deribit", settle: "BTC", instrumentId: option().id, quantity: "0.3", leverage: 1, maximumPrice: "0.01", ...patch });
  it("pays BTC premium and BTC fees without a USD conversion; sells only owned contracts", async () => {
    openDerivativesAccount("deribit", "BTC", "1", "0.001");
    const opened = await execute(optionOrder(), connector(option(), 0.009, 0.01));
    expect(opened.account.available).toBe("0.996997"); expect(opened.account.positions[0]?.margin).toBe("0.003");
    const closed = await execute(optionOrder({ action: "close", quantity: "0.1", reduceOnly: true, maximumPrice: "0.012", clientOrderId: "option-close" }), connector(option(), 0.012, 0.013));
    expect(closed.order.realizedPnl).toBe("0.0002"); expect(closed.account.available).toBe("0.9981958");
    expect(closed.account.positions[0]).toMatchObject({ quantity: "0.2", margin: "0.002" });
    await expect(execute(optionOrder({ action: "close", quantity: "0.3", clientOrderId: "oversell" }), connector(option(), 0.012, 0.013))).rejects.toThrow(/exceeds/);
  });
  it("rejects naked shorts, naked closes, leverage and incorrect settle currency", async () => {
    openDerivativesAccount("deribit", "BTC", "1");
    for (const patch of [{ side: "short" as const }, { leverage: 2 }, { action: "close" as const }]) {
      await expect(execute(optionOrder(patch), connector(option(), 0.009, 0.01))).rejects.toThrow();
    }
    openDerivativesAccount("deribit", "USD", "10000");
    await expect(execute(optionOrder({ settle: "USD" }), connector(option(), 0.009, 0.01))).rejects.toThrow(/settle/);
    expect(getDerivativesAccount("deribit", "BTC")?.available).toBe("1");
  });
});

describe("execution validation and atomic idempotency", () => {
  it("prevents competing instruments from spending the same settle cash", async () => {
    const eth = instrument({ id: "okx:perpetual:ETH-USDT-SWAP", nativeId: "ETH-USDT-SWAP" });
    const results = await Promise.allSettled([
      execute(request({ quantity: "600" })),
      execute(request({ quantity: "600", instrumentId: eth.id, clientOrderId: "competing-eth" }), connector(eth)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(account().available).toBe("39.4"); expect(account().orders).toHaveLength(1);
  });
  it("gates fixture execution behind explicit nonproduction fixture mode", async () => {
    const fixture = instrument({ source: "fixture" });
    const data = connector(fixture, 99, 100, { source: "fixture" });
    vi.stubEnv("NEWBEING_E2E_FIXTURES", "0");
    await expect(execute(request(), data)).rejects.toThrow(/native instrument/);
    vi.stubEnv("NEWBEING_E2E_FIXTURES", "1"); vi.stubEnv("NODE_ENV", "production");
    await expect(execute(request(), data)).rejects.toThrow(/native instrument/);
    vi.stubEnv("NODE_ENV", "test");
    expect((await execute(request(), data)).order.status).toBe("filled");
  });
  it("applies native option premium tick bands above their thresholds", async () => {
    const banded = instrument({ priceTick: 0.0001, priceTickSteps: [{ abovePrice: 0.005, tick: 0.0005 }] });
    await expect(execute(request({ maximumPrice: "0.0051" }), connector(banded, 0.005, 0.0051))).rejects.toThrow(/price tick/);
    expect((await execute(request({ maximumPrice: "0.0055" }), connector(banded, 0.005, 0.0055))).order.fillPrice).toBe("0.0055");
  });
  it("deduplicates concurrent fills and survives process reopen without refetch", async () => {
    const m = connector();
    const results = await Promise.all([execute(request(), m), execute(request(), m)]);
    expect(results.filter((r) => r.deduplicated)).toHaveLength(1); expect(account().orders).toHaveLength(1);
    closeDatabaseForTests(); const offline = connector();
    expect((await execute(request(), offline)).deduplicated).toBe(true);
    expect(offline.getDerivativeInstrument).not.toHaveBeenCalled();
    await expect(execute(request({ maximumPrice: "101" }), offline)).rejects.toThrow(/different parameters/);
    expect(offline.getDerivativeQuote).not.toHaveBeenCalled();
  });
  it("rolls back both balance and order ledger when the final write fails", async () => {
    const before = account();
    getDatabase().run("CREATE TRIGGER fail_derivatives BEFORE UPDATE ON derivatives_accounts BEGIN SELECT RAISE(ABORT, 'failed commit'); END");
    await expect(execute()).rejects.toThrow(/failed commit/); expect(account()).toEqual(before);
  });
  it.each([0, 21, 1.5])("rejects invalid leverage %s", async (leverage) => {
    await expect(execute(request({ leverage }))).rejects.toThrow(/leverage/); expect(account().orders).toEqual([]);
  });
  it.each(["0", "-1", "NaN", "Infinity", "1e3", "0.15"])("rejects invalid or off-step quantity %s", async (quantity) => {
    await expect(execute(request({ quantity }))).rejects.toThrow(); expect(account().available).toBe("100");
  });
  it.each([
    { bid: null }, { ask: null }, { bid: 0 }, { bid: 101 }, { ask: NaN },
    { timestamp: timestamp - 15001 }, { timestamp: timestamp + 1 }, { timestamp: NaN }, { instrumentId: "wrong" },
  ])("rejects unusable bid/ask quotes without last or mark fallback: %j", async (patch) => {
    await expect(execute(request(), connector(instrument(), 99, 100, patch))).rejects.toThrow(); expect(account().orders).toEqual([]);
  });
  it("enforces buy ceiling, sell floor, margin availability and reduce-only", async () => {
    await expect(execute(request({ maximumPrice: "99" }))).rejects.toThrow(/protection/);
    await expect(execute(request({ side: "short", maximumPrice: "100" }))).rejects.toThrow(/protection/);
    await expect(execute(request({ quantity: "100000" }))).rejects.toThrow(/Insufficient/);
    await expect(execute(request({ reduceOnly: true }))).rejects.toThrow(/Reduce-only/);
    await expect(execute(request({ action: "close", maximumPrice: "99" }))).rejects.toThrow(/exceeds/);
    expect(account().available).toBe("100");
  });
  it.each([
    { active: false }, { inverse: true }, { linear: false }, { settle: "BTC" }, { venue: "deribit" as const },
    { id: "wrong" }, { contractSize: 0 }, { quantityStep: null }, { minContracts: null }, { priceTick: null },
    { kind: "future" as const, expiry: null }, { expiry: timestamp },
  ])("rejects inactive, unsupported or incomplete metadata: %j", async (patch) => {
    await expect(execute(request(), connector(instrument(patch)))).rejects.toThrow(); expect(account().orders).toEqual([]);
  });
  it("rechecks expiry after network waits and freezes even closes without official settlement", async () => {
    const future = instrument({ id: "okx:future:BTC-USDT-301225", nativeId: "BTC-USDT-301225", kind: "future", expiry: timestamp + 10 });
    await execute(request({ instrumentId: future.id }), connector(future));
    await expect(executeDerivativesOrder(request({ instrumentId: future.id, clientOrderId: "expired-close", action: "close" }), connector(future), () => timestamp + 10)).rejects.toThrow(/Expired/);
    let time = timestamp;
    const m = connector(future);
    m.getDerivativeQuote = async () => { time += 10; return { instrumentId: future.id, timestamp: time, bid: 99, ask: 100, source: "native-api" }; };
    await expect(executeDerivativesOrder(request({ instrumentId: future.id, clientOrderId: "expired-open" }), m, () => time)).rejects.toThrow(/Expired/);
    expect(account().orders).toHaveLength(1);
  });
  it.each(["instrument", "quote"])("blocks Replay activated during the %s await", async (stage) => {
    const m = connector(); const replay = () => saveWorkspaceState({ ...getWorkspaceState().state, activeWorkspace: "replay" });
    if (stage === "instrument") m.getDerivativeInstrument = async () => { replay(); return instrument(); };
    else m.getDerivativeQuote = async () => { replay(); return { instrumentId: instrument().id, timestamp, bid: 99, ask: 100, source: "native-api" }; };
    await expect(execute(request(), m)).rejects.toThrow(/Replay/); expect(account().available).toBe("100");
    await expect(execute()).rejects.toThrow(/Replay/);
  });
  it("checks Replay inside the transaction even after the last async check", async () => {
    let calls = 0;
    await expect(executeDerivativesOrder(request(), connector(), () => {
      calls++;
      if (calls === 2) saveWorkspaceState({ ...getWorkspaceState().state, activeWorkspace: "replay" });
      return timestamp;
    })).rejects.toThrow(/Replay/);
    expect(account().orders).toEqual([]); expect(account().available).toBe("100");
  });
});

describe("pure valuation is not settlement", () => {
  it("marks local equity, reports exhausted collateral, and leaves expired PNL unknown", async () => {
    const result = await execute(); const position = result.account.positions[0]!;
    expect(valueDerivativesPosition(position, "105", timestamp)).toEqual({ status: "marked", unrealizedPnl: "0.1", positionEquity: "0.3" });
    expect(valueDerivativesPosition(position, "0", timestamp)).toEqual({ status: "margin-exhausted", unrealizedPnl: "-0.2", positionEquity: "0" });
    expect(valueDerivativesPosition({ ...position, expiry: timestamp }, "999999", timestamp)).toEqual({ status: "awaiting-official-settlement", unrealizedPnl: null, positionEquity: null });
    expect(account()).toEqual(result.account);
  });
});
