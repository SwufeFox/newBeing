import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/backtest.js";
import { getStrategy, strategySignalSides, strategySignals } from "../src/strategies.js";
import type { Candle, StrategyParameters } from "../src/types.js";

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/backtest-golden.json", import.meta.url), "utf8"),
) as {
  fixture: string;
  candleCount: number;
  config: {
    initialCapital: number;
    positionFraction: number;
    feeRate: number;
    slippageRate: number;
    allowShorts: boolean;
  };
  results: Record<string, {
    strategyVersion: string;
    parameters: StrategyParameters;
    signalSha256: string;
    tradeSha256: string;
    equitySha256: string;
    signalCount: number;
    tradeCount: number;
    equityCount: number;
  }>;
};

const cases: Array<[string, StrategyParameters]> = [
  ["sma-crossover", { fastPeriod: 4, slowPeriod: 9, allowShorts: true }],
  ["rsi-mean-reversion", { period: 5, oversold: 36, exitLong: 53, overbought: 64, exitShort: 47, allowShorts: true }],
  ["momentum-reversal", { lookback: 6, thresholdPct: 2.1, reversal: true, allowShorts: true }],
];

function createCandles(): Candle[] {
  return Array.from({ length: golden.candleCount }, (_, index) => {
    const close = 100 + Math.sin(index / 5) * 5 + Math.sin(index / 11) * 3 + index * 0.01;
    const open = close + Math.sin(index * 1.7) * 0.3;
    return {
      timestamp: 1_700_000_000_000 + index * 60_000,
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.8,
      close,
      volume: 50 + (index % 17),
    };
  });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireStrategy(id: string) {
  const strategy = getStrategy(id);
  if (!strategy) throw new Error(`Missing built-in strategy: ${id}`);
  return strategy;
}

describe("streaming strategy execution", () => {
  it("matches each executable strategy's safe-prefix reference output at every bar", () => {
    const candles = createCandles();
    for (const [id, parameters] of cases) {
      const strategy = requireStrategy(id);
      const streamed = strategySignalSides(strategy, candles, parameters);
      const reference = candles.map((_, index) =>
        strategy.signalAt(candles.slice(0, index + 1), index, parameters),
      );
      expect(streamed, id).toEqual(reference);
    }
  });

  it("keeps custom strategies bounded to the current history prefix", () => {
    const candles = createCandles();
    const seenLengths: number[] = [];
    const custom = {
      id: "test-prefix-contract",
      name: "Prefix contract",
      version: "test",
      description: "Test-only strategy",
      defaults: {},
      signalAt(prefix: readonly Candle[], index: number) {
        seenLengths.push(prefix.length);
        expect(prefix.length).toBe(index + 1);
        return "flat" as const;
      },
    };

    expect(strategySignalSides(custom, candles, {})).toHaveLength(candles.length);
    expect(seenLengths).toEqual(candles.map((_, index) => index + 1));
  });

  it("preserves baseline signals, trades, equity and executed strategy metadata", () => {
    const candles = createCandles();
    const config = { ...golden.config };
    for (const [id, parameters] of cases) {
      const strategy = requireStrategy(id);
      const result = runBacktest({
        candles,
        symbol: "BTC/USDT",
        timeframe: "1m",
        datasetId: golden.fixture,
        strategy,
        parameters,
        config,
        resultId: `golden-${id}`,
        createdAt: "2026-10-09T00:00:00.000Z",
      });
      const signals = strategySignals(strategy, candles, parameters).map(({ timestamp, side }) => [timestamp, side]);
      const expected = golden.results[id];
      if (!expected) throw new Error(`Missing golden result for ${id}`);

      expect(result.strategyId).toBe(id);
      expect(result.strategyVersion).toBe(expected.strategyVersion);
      expect(result.parameters).toEqual(expected.parameters);
      expect(signals).toHaveLength(expected.signalCount);
      expect(result.trades).toHaveLength(expected.tradeCount);
      expect(result.equityCurve).toHaveLength(expected.equityCount);
      expect(sha256(signals)).toBe(expected.signalSha256);
      expect(sha256(result.trades)).toBe(expected.tradeSha256);
      expect(sha256(result.equityCurve)).toBe(expected.equitySha256);
    }
  });

  it("describes the exact executable strategy separately from source drafts", () => {
    for (const [id, parameters] of cases) {
      const strategy = requireStrategy(id);
      expect(strategy.executionSummary?.(parameters)).toContain("next bar open");
    }
  });
});
