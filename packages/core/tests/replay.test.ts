import { describe, expect, it } from "vitest";
import { matchReplayBar, replayReport, submitReplayOrder, type ReplayExecution } from "../src/replay.js";
import type { Candle } from "../src/types.js";

function state(): ReplayExecution {
  return { version: 1, revision: 0, account: { id: "replay-test", venue: "binance", mode: "replay", quote: "USDT" }, instrument: { id: "binance:spot:BTCUSDT", venue: "binance", nativeId: "BTCUSDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", marketType: "spot" }, config: { initialCapital: 1000, feeRate: 0.001, slippageRate: 0.01 }, portfolio: { quoteBalance: 1000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: 0.001 }, orders: [], fills: [], brackets: [], equity: [], notes: "", tags: [] };
}
const bar = (timestamp: number, open = 100, high = 110, low = 90, close = 100): Candle => ({ timestamp, open, high, low, close, volume: 10 });

describe("Replay execution policy", () => {
  it("keeps market intent pending until the next bar and charges adverse slippage and fees", () => {
    const s = state();
    submitReplayOrder(s, { clientOrderId: "market", type: "market", side: "buy", quantity: 2 }, 60_000);
    matchReplayBar(s, bar(60_000));
    expect(s.fills).toHaveLength(0);
    matchReplayBar(s, bar(120_000));
    expect(s.fills[0]).toMatchObject({ price: 101, fee: 0.202, quantity: 2 });
    expect(s.portfolio.quoteBalance).toBeCloseTo(797.798);
    expect(s.orders[0]?.status).toBe("filled");
  });

  it("keeps untouched limit/stop orders pending and caps limit slippage", () => {
    const s = state();
    submitReplayOrder(s, { clientOrderId: "limit", type: "limit", price: 80, side: "buy", quantity: 1 }, 0);
    submitReplayOrder(s, { clientOrderId: "stop", type: "stop", price: 120, side: "buy", quantity: 1 }, 0);
    matchReplayBar(s, bar(60_000));
    expect(s.orders.map((o) => o.status)).toEqual(["submitted", "submitted"]);
    matchReplayBar(s, bar(120_000, 75, 125, 70));
    expect(s.fills.map((f) => f.price)).toEqual([80, 121.2]);
  });

  it("fills stop entry gaps at the adverse open", () => {
    const s = state();
    submitReplayOrder(s, { clientOrderId: "stop-gap", type: "stop", price: 110, side: "buy", quantity: 1 }, 0);
    matchReplayBar(s, bar(60_000, 120, 125, 115, 120));
    expect(s.fills[0]?.price).toBeCloseTo(121.2);
  });

  it("uses stop-first on ambiguous bars and stop gaps include sell slippage", () => {
    const s = state();
    submitReplayOrder(s, { clientOrderId: "bracket", type: "market", side: "buy", quantity: 2, stopLoss: 90, takeProfit: 110 }, 0);
    matchReplayBar(s, bar(60_000, 100, 105, 95));
    matchReplayBar(s, bar(120_000, 80, 120, 75));
    expect(s.fills[1]).toMatchObject({ reason: "stop-loss", quantity: 2, price: 79.2 });
    expect(s.portfolio.baseBalance).toBe(0);
    expect(s.brackets).toEqual([]);
  });

  it("can stop on the entry bar but defers targets until the following bar", () => {
    const s = state();
    submitReplayOrder(s, { clientOrderId: "target", type: "market", side: "buy", quantity: 1, takeProfit: 105 }, 0);
    matchReplayBar(s, bar(60_000));
    expect(s.fills).toHaveLength(1);
    matchReplayBar(s, bar(120_000, 115, 120, 110, 115));
    expect(s.fills[1]).toMatchObject({ reason: "take-profit", price: 113.85 });
    const stopped = state();
    submitReplayOrder(stopped, { clientOrderId: "stop", type: "market", side: "buy", quantity: 1, stopLoss: 95 }, 0);
    matchReplayBar(stopped, bar(60_000));
    expect(stopped.fills.map((f) => f.reason)).toEqual(["order", "stop-loss"]);
  });

  it("reduces protected lots on partial closes without overselling later", () => {
    const s = state();
    submitReplayOrder(s, { clientOrderId: "entry", type: "market", side: "buy", quantity: 3, stopLoss: 80 }, 0);
    matchReplayBar(s, bar(60_000));
    submitReplayOrder(s, { clientOrderId: "partial", type: "market", side: "sell", quantity: 1 }, 60_000);
    matchReplayBar(s, bar(120_000));
    expect(s.brackets[0]?.quantity).toBe(2);
    expect(s.portfolio.baseBalance).toBe(2);
    matchReplayBar(s, bar(180_000, 70, 90, 60, 75));
    expect(s.fills.at(-1)).toMatchObject({ quantity: 2, reason: "stop-loss" });
    expect(s.portfolio.baseBalance).toBe(0);
    expect(replayReport(s, 75).fees).toBeCloseTo(s.fills.reduce((sum, f) => sum + f.fee, 0));
  });

  it("deduplicates exact intent and rejects conflicting parameters", () => {
    const s = state();
    const input = { clientOrderId: "once", type: "limit" as const, side: "buy" as const, quantity: 1, price: 90 };
    submitReplayOrder(s, input, 0);
    submitReplayOrder(s, input, 60_000);
    expect(s.orders).toHaveLength(1);
    expect(() => submitReplayOrder(s, { ...input, price: 91 }, 0)).toThrow(/different parameters/);
  });

  it.each([
    { type: "limit" as const, price: 90, stopLoss: 95, candle: bar(60_000, 100, 100, 89, 96) },
    { type: "market" as const, stopLoss: 95, candle: bar(60_000, 90, 100, 85, 96) },
    { type: "stop" as const, price: 110, takeProfit: 120, candle: bar(60_000, 125, 130, 120, 125) },
  ])("rejects brackets invalid at the actual entry without fees or fills ($type)", ({ candle, ...input }) => {
    const s = state();
    submitReplayOrder(s, { ...input, clientOrderId: "invalid-bracket", side: "buy", quantity: 1 }, 0);
    matchReplayBar(s, candle);
    expect(s.orders[0]).toMatchObject({ status: "rejected", fee: 0, fillPrice: null });
    expect(s.fills).toEqual([]);
    expect(s.brackets).toEqual([]);
    expect(s.portfolio.quoteBalance).toBe(1000);
    expect(s.portfolio.baseBalance).toBe(0);
  });

  it("rejects unaffordable orders without changing inventory", () => {
    const s = state();
    submitReplayOrder(s, { clientOrderId: "too-large", type: "market", side: "buy", quantity: 100 }, 0);
    matchReplayBar(s, bar(60_000));
    expect(s.orders[0]?.status).toBe("rejected");
    expect(s.fills).toEqual([]);
    expect(s.portfolio.quoteBalance).toBe(1000);
  });
});
