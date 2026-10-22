import { decimal, estimatePaperAmounts, money, SIMULATION_PRECISION, validateMoney } from "./ledger.js";

export const LEGACY_MARGIN_EXECUTION_POLICY = {
  id: "legacy-margin/v1",
  marketType: "synthetic-margin",
  shorts: true,
  feeCurrency: "quote",
  sizing: "Synthetic notional exposure; entry fees deducted from cash without purchasing inventory.",
  protection: "Opening signals precede range protection; stop wins ambiguous ranges, including entry-bar targets.",
} as const;

export const SPOT_EXECUTION_POLICY = {
  id: "spot-quote-fees/v1",
  marketType: "spot",
  shorts: false,
  feeCurrency: "quote",
  sizing: "Budget includes entry fees; quantity rounds down to local precision.",
  protection: "Opening gaps execute first, then opening orders, then intrabar protection. Stop wins ambiguous ranges; entry-bar targets are deferred.",
} as const;

/** Return an affordable quantity under the same rounded notional/fee rules as settlement. */
export function spotBuyQuantity(budget: number, price: number, feeRate: number): number {
  validateMoney(budget);
  if (budget < 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.05) throw new Error("Invalid spot sizing inputs.");
  let units = decimal(budget).div(decimal(price).times(decimal(1).plus(feeRate))).toDecimalPlaces(SIMULATION_PRECISION.quantityDecimals, 1);
  const step = decimal(10).pow(-SIMULATION_PRECISION.quantityDecimals);
  // Rounded notional and fee can together exceed the mathematical budget by one money unit.
  if (units.isZero()) return 0;
  let quantity = units.toNumber();
  let amounts = estimatePaperAmounts(price, quantity, feeRate);
  if (money(decimal(amounts.notional).plus(amounts.fee)) > budget) {
    units = decimal(Math.max(0, budget - 1e-8)).div(decimal(price).times(decimal(1).plus(feeRate))).toDecimalPlaces(SIMULATION_PRECISION.quantityDecimals, 1);
    quantity = units.toNumber();
    if (quantity <= 0) return 0;
    amounts = estimatePaperAmounts(price, quantity, feeRate);
    if (money(decimal(amounts.notional).plus(amounts.fee)) > budget) quantity = units.minus(step).toNumber();
  }
  return quantity;
}

export function longProtectionFill(
  bar: { open: number; low: number; high: number },
  stopLoss: number | undefined,
  takeProfit: number | undefined,
  phase: "open" | "range",
  targetActive: boolean,
): { price: number; reason: "stop-loss" | "take-profit" } | null {
  const low = phase === "open" ? bar.open : bar.low;
  const high = phase === "open" ? bar.open : bar.high;
  if (stopLoss !== undefined && low <= stopLoss) return { price: Math.min(bar.open, stopLoss), reason: "stop-loss" };
  if (targetActive && takeProfit !== undefined && high >= takeProfit) return { price: Math.max(bar.open, takeProfit), reason: "take-profit" };
  return null;
}
