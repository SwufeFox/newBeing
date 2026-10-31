import { Decimal } from "decimal.js";

// Local simulator policy, not exchange lot sizes or currency minor units.
const LedgerDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export const SIMULATION_PRECISION = { quantityDecimals: 12, moneyDecimals: 8, rounding: "half-up", venueRules: "not-enforced" } as const;

export class LedgerValidationError extends Error {}

export function decimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new LedgerValidationError("Ledger values must be finite.");
  return new LedgerDecimal(value.toString());
}

function representable(value: Decimal): number {
  const result = value.toNumber();
  if (!Number.isFinite(result) || result.toString() !== value.toString()) throw new LedgerValidationError("Ledger value cannot be represented by the numeric storage protocol.");
  return result;
}

export function quantityUnits(value: number): Decimal {
  const units = decimal(value);
  if (units.isNegative() || units.decimalPlaces() > SIMULATION_PRECISION.quantityDecimals) throw new LedgerValidationError("Quantity is not representable by the local simulation policy (12 decimal places).");
  return units;
}

export function addQuantity(left: number, right: number): number {
  return representable(quantityUnits(left).plus(quantityUnits(right)));
}

export function subtractQuantity(left: number, right: number): number {
  const result = quantityUnits(left).minus(quantityUnits(right));
  if (result.isNegative()) throw new LedgerValidationError("Insufficient paper base balance.");
  return representable(result);
}

export function money(value: Decimal | number): number {
  return representable((typeof value === "number" ? decimal(value) : value).toDecimalPlaces(SIMULATION_PRECISION.moneyDecimals));
}

export function validateMoney(value: number): void {
  if (money(value) !== value) throw new LedgerValidationError("Balance is not representable by the local simulation policy (8 decimal places).");
}

export function estimatePaperAmounts(price: number, quantity: number, feeRate: number): { notional: number; fee: number } {
  if (price <= 0 || quantity <= 0 || feeRate < 0 || feeRate > 0.05) throw new LedgerValidationError("Invalid simulated price, quantity or fee rate.");
  const notional = money(decimal(price).times(quantityUnits(quantity)));
  if (notional <= 0) throw new LedgerValidationError("Order notional is below local simulation money precision.");
  const fee = money(decimal(notional).times(decimal(feeRate)));
  return { notional, fee };
}
