import type { BacktestConfig } from "@newbeing/core";
import { describe, expect, it } from "vitest";
import { sameBacktestConfig } from "../src/lib/research-inputs.js";

const config: BacktestConfig = {
  initialCapital: 10_000,
  positionFraction: 0.95,
  feeRate: 0.001,
  slippageRate: 0.0005,
  allowShorts: false,
};

function expectDifferent(left: BacktestConfig, right: BacktestConfig): void {
  expect(sameBacktestConfig(left, right)).toBe(false);
  expect(sameBacktestConfig(right, left)).toBe(false);
}

describe("research input configuration matching", () => {
  it("matches a completed Spot run when the workspace omits account mode", () => {
    const workspace: BacktestConfig = { ...config, initialCapital: 12_500, positionFraction: 0.7, feeRate: 0.0008, slippageRate: 0.0003, stopLossPct: 0.05, takeProfitPct: 0.1 };
    const saved: BacktestConfig = { ...workspace, accountMode: "spot" };
    expect(sameBacktestConfig(workspace, saved)).toBe(true);
    expect(sameBacktestConfig(saved, workspace)).toBe(true);
  });


  it.each<{ field: string; change: Partial<BacktestConfig> }>([
    { field: "account mode", change: { accountMode: "legacy-margin" } },
    { field: "capital", change: { initialCapital: 12_000 } },
    { field: "position fraction", change: { positionFraction: 0.6 } },
    { field: "fee rate", change: { feeRate: 0.00100001 } },
    { field: "slippage rate", change: { slippageRate: 0.00050001 } },
    { field: "short permission", change: { allowShorts: true } },
    { field: "stop loss", change: { stopLossPct: 0.05 } },
    { field: "take profit", change: { takeProfitPct: 0.1 } },
  ])("preserves a meaningful difference in $field", ({ change }) => {
    expectDifferent(config, { ...config, ...change });
  });

  it.each<{ field: string; change: Partial<BacktestConfig> }>([
    { field: "stop loss", change: { stopLossPct: 0.06 } },
    { field: "take profit", change: { takeProfitPct: 0.12 } },
  ])("detects changes to an existing $field", ({ change }) => {
    const protectedConfig = { ...config, stopLossPct: 0.05, takeProfitPct: 0.1 };
    expectDifferent(protectedConfig, { ...protectedConfig, ...change });
  });
});
