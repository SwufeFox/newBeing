import type { StrategyParameters } from "@newbeing/core";

export const SWEEP_MAX_RUNS = 40;
interface Decimal { coefficient: bigint; exponent: number }
function decimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new Error("Sweep range must be numbers.");
  const [mantissa = "", power = "0"] = value.toString().split("e");
  const fraction = mantissa.split(".")[1]?.length ?? 0;
  return normalize({ coefficient: BigInt(mantissa.replace(".", "")), exponent: Number(power) - fraction });
}
function normalize(value: Decimal): Decimal {
  let { coefficient, exponent } = value;
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  while (coefficient % 10n === 0n) { coefficient /= 10n; exponent += 1; }
  return { coefficient, exponent };
}
function range(from: number, to: number, step: number) {
  const values = [decimal(from), decimal(to), decimal(step)];
  if (step <= 0) throw new Error("Sweep step must be greater than zero.");
  if (to < from) throw new Error("Sweep end must not be below its start.");
  const exponent = Math.min(...values.map((v) => v.exponent));
  const [start = 0n, end = 0n, increment = 0n] = values.map((v) => v.coefficient * 10n ** BigInt(v.exponent - exponent));
  return { start, increment, exponent, count: (end - start) / increment + 1n };
}
function bounded(count: bigint): void {
  if (count > BigInt(SWEEP_MAX_RUNS)) throw new Error(`That range needs ${count} runs; the limit is ${SWEEP_MAX_RUNS}. Widen the step.`);
}
function enumerate(r: ReturnType<typeof range>): number[] {
  return Array.from({ length: Number(r.count) }, (_, i) => {
    const exact = normalize({ coefficient: r.start + BigInt(i) * r.increment, exponent: r.exponent });
    const value = Number(`${exact.coefficient}e${exact.exponent}`);
    if (!Number.isFinite(value)) throw new Error("Sweep value cannot roundtrip through Number.toString.");
    const back = decimal(value);
    if (back.coefficient !== exact.coefficient || back.exponent !== exact.exponent) throw new Error("Sweep value cannot roundtrip through Number.toString.");
    return value;
  });
}

/** Inclusive exact decimal range. Numeric inputs mean their Number.toString decimal. */
export function sweepValues(from: number, to: number, step: number): number[] {
  const r = range(from, to, step);
  bounded(r.count);
  return enumerate(r);
}

export interface SweepAxis { parameter: string; from: number; to: number; step: number }
/** Last axis varies fastest; preflight the whole product before allocating any rows. */
export function sweepCartesian(axes: readonly SweepAxis[]): StrategyParameters[] {
  if (axes.length === 0 || axes.length > SWEEP_MAX_RUNS) throw new Error("Supply between 1 and 40 sweep axes.");
  const seen = new Set<string>();
  const ranges = axes.map((axis) => {
    if (!axis.parameter || seen.has(axis.parameter)) throw new Error("Duplicate or empty sweep parameter.");
    seen.add(axis.parameter);
    return range(axis.from, axis.to, axis.step);
  });
  bounded(ranges.reduce((product, r) => product * r.count, 1n));
  let rows: StrategyParameters[] = [{}];
  ranges.forEach((r, index) => {
    const values = enumerate(r);
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [axes[index]!.parameter]: value })));
  });
  return rows;
}
