import { describe, expect, it } from "vitest";
import { sweepValues, SWEEP_MAX_RUNS } from "../src/sweep.js";

describe("sweepValues", () => {
  it("enumerates an inclusive integer range", () => {
    expect(sweepValues(5, 25, 5)).toEqual([5, 10, 15, 20, 25]);
  });

  it("does not drift on a fractional step", () => {
    // Naive accumulation gives 0.30000000000000004 here; a sweep that reports
    // "0.30000000000000004" as a parameter value would be unciteable.
    const values = sweepValues(0.1, 0.4, 0.1);
    expect(values).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(values.every((v) => String(v).length <= 4)).toBe(true);
  });

  it("stops at the last value that fits, without overshooting", () => {
    // 10..20 by 3 = 10, 13, 16, 19 — 22 would exceed the end.
    expect(sweepValues(10, 20, 3)).toEqual([10, 13, 16, 19]);
  });

  it("a single point is a legal range", () => {
    expect(sweepValues(7, 7, 1)).toEqual([7]);
  });

  it("refuses a step of zero or less", () => {
    expect(() => sweepValues(1, 10, 0)).toThrow(/greater than zero/);
    expect(() => sweepValues(1, 10, -1)).toThrow(/greater than zero/);
  });

  it("refuses an end below its start", () => {
    expect(() => sweepValues(20, 10, 1)).toThrow(/below its start/);
  });

  it("refuses non-finite bounds", () => {
    expect(() => sweepValues(Number.NaN, 10, 1)).toThrow(/must be numbers/);
    expect(() => sweepValues(1, Number.POSITIVE_INFINITY, 1)).toThrow(/must be numbers/);
  });

  it("caps the run count and says how to fix it", () => {
    // 1..1000 by 1 needs 1000 runs; the message must name the limit.
    expect(() => sweepValues(1, 1000, 1)).toThrow(new RegExp(String(SWEEP_MAX_RUNS)));
    // and exactly-at-the-limit is allowed
    expect(sweepValues(1, SWEEP_MAX_RUNS, 1)).toHaveLength(SWEEP_MAX_RUNS);
    expect(() => sweepValues(1, SWEEP_MAX_RUNS + 1, 1)).toThrow(/limit/);
  });

  it("reports a count consistent with the values it returns", () => {
    const values = sweepValues(2, 60, 7);
    expect(values).toHaveLength(Math.floor((60 - 2) / 7) + 1);
    expect(values[0]).toBe(2);
    expect(values.at(-1)).toBeLessThanOrEqual(60);
  });
});
