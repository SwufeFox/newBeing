import type { BacktestConfig } from "@newbeing/core";

/** Omitted account mode uses the engine's Spot default; all other inputs stay exact. */
export function sameBacktestConfig(left: BacktestConfig, right: BacktestConfig): boolean {
  return (left.accountMode ?? "spot") === (right.accountMode ?? "spot")
    && left.initialCapital === right.initialCapital
    && left.positionFraction === right.positionFraction
    && left.feeRate === right.feeRate
    && left.slippageRate === right.slippageRate
    && left.allowShorts === right.allowShorts
    && left.stopLossPct === right.stopLossPct
    && left.takeProfitPct === right.takeProfitPct;
}
