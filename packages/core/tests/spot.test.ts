import { describe, expect, it } from "vitest";
import { createSpotAccount, reserveSpotOrder, settleSpotOrder, spotBuyQuantity, runBacktest, SPOT_EXECUTION_POLICY, type Candle, type StrategyDefinition } from "../src/index.js";

const bar = (timestamp: number, open: number, high = open, low = open, close = open): Candle => ({ timestamp, open, high, low, close, volume: 1 });
const strategy: StrategyDefinition = { id: "spot-regression", name: "Spot regression", version: "1", description: "Fixture", defaults: {}, signalAt: (_bars, index) => index === 0 ? "long" : "flat" };
const input = { symbol: "BTC/USDT", timeframe: "1m" as const, exchange: "binance" as const, datasetId: "fixture", strategy, parameters: {}, resultId: "fixture", config: { initialCapital: 1000, positionFraction: 1, feeRate: 0.001, slippageRate: 0.002, allowShorts: false } };

describe("spot Backtest settlement and historical model boundary", () => {
  it("agrees exactly with shared-wallet inventory settlement including entry fees and rounded quantities", () => {
    const candles = [bar(0, 100), bar(60000, 100), bar(120000, 120)];
    const result = runBacktest({ ...input, candles });
    const account = createSpotAccount("binance", "USDT", 1000);
    const quantity = spotBuyQuantity(1000, 100.2, 0.001);
    reserveSpotOrder(account, { clientOrderId: "buy", symbol: input.symbol, side: "buy", quantity }, 100.2);
    settleSpotOrder(account, "buy", 100.2);
    reserveSpotOrder(account, { clientOrderId: "sell", symbol: input.symbol, side: "sell", quantity }, 119.76);
    settleSpotOrder(account, "sell", 119.76);
    expect(result.metrics.finalEquity).toBe(account.balances.USDT!.total);
    expect(result.trades[0]!.netPnl).toBe(account.positions[input.symbol]!.realizedPnl);
    expect(result.trades[0]!.quantity).toBe(quantity);
    expect(result.metrics.totalFees).toBeCloseTo(account.fills.reduce((sum, fill) => sum + fill.fee, 0), 8);
    expect(result.executionPolicy).toEqual(SPOT_EXECUTION_POLICY);
  });

  it.each([
    { name: "stop gap before flat signal", open: 80, high: 110, low: 75, exit: 80, reason: "stop-loss" },
    { name: "target gap before flat signal", open: 120, high: 125, low: 80, exit: 120, reason: "take-profit" },
    { name: "flat signal before intrabar stop", open: 100, high: 105, low: 80, exit: 100, reason: "signal" },
  ])("honors $name", ({ open, high, low, exit, reason }) => {
    const result = runBacktest({ ...input, config: { ...input.config, feeRate: 0, slippageRate: 0, stopLossPct: 0.1, takeProfitPct: 0.1 }, candles: [bar(0, 100), bar(60000, 100), bar(120000, open, high, low)] });
    expect(result.trades[0]).toMatchObject({ exitPrice: exit, exitReason: reason });
  });

  it("defers entry-bar targets but executes entry-bar stops", () => {
    const config = { ...input.config, feeRate: 0, slippageRate: 0, stopLossPct: 0.1, takeProfitPct: 0.1 };
    const target = runBacktest({ ...input, config, candles: [bar(0, 100), bar(60000, 100, 120, 95), bar(120000, 100)] });
    expect(target.trades[0]!.exitReason).toBe("signal");
    const stopped = runBacktest({ ...input, config, candles: [bar(0, 100), bar(60000, 100, 120, 80), bar(120000, 100)] });
    expect(stopped.trades[0]).toMatchObject({ exitPrice: 90, exitReason: "stop-loss", exitTime: 60000 });
  });

  it("requires explicit legacy shorts and labels their historical accounting and protection", () => {
    const candles = [bar(0, 100), bar(60000, 100), bar(120000, 120)];
    expect(() => runBacktest({ ...input, candles, config: { ...input.config, allowShorts: true } })).toThrow(/Spot does not support shorts/);
    const legacy = runBacktest({ ...input, candles, config: { ...input.config, accountMode: "legacy-margin", allowShorts: true } });
    expect(legacy.executionPolicy!.id).toBe("legacy-margin/v1");
    expect(legacy.execution.intrabarStops).toContain("Opening signals precede");
    expect(legacy.trades[0]!.quantity).toBe(1000 / 100.2);
  });
});
