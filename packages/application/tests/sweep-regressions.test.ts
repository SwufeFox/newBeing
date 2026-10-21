import { describe, expect, it } from "vitest";
import { sweepCartesian, sweepValues } from "../src/sweep.js";

describe("exact bounded decimal sweep regressions", () => {
  it("preserves an offset finer than the step and handles scientific notation", () => {
    expect(sweepValues(0.05, 0.35, 0.1)).toEqual([0.05, 0.15, 0.25, 0.35]);
    expect(sweepValues(1e-7, 4e-7, 1e-7)).toEqual([1e-7, 2e-7, 3e-7, 4e-7]);
    expect(sweepValues(-0.25, 0.05, 0.1)).toEqual([-0.25, -0.15, -0.05, 0.05]);
    expect(sweepValues(0, 0.29999999999, 0.1)).toEqual([0, 0.1, 0.2]);
  });
  it("rejects a decimal result that cannot roundtrip through Number.toString", () => {
    expect(() => sweepValues(1e16, 1e16 + 2, 1)).toThrow(/roundtrip/);
    expect(() => sweepValues(1, 1.0000000000000002, 1e-17)).toThrow(/roundtrip/);
  });
  it("bounds the actual Cartesian product with stable axis order", () => {
    const axes = [{ parameter: "a", from: 1, to: 5, step: 1 }, { parameter: "b", from: 10, to: 17, step: 1 }];
    expect(sweepCartesian(axes)).toEqual(Array.from({ length: 5 }, (_, a) => Array.from({ length: 8 }, (_, b) => ({ a: a + 1, b: b + 10 }))).flat());
    expect(() => sweepCartesian([axes[0]!, { ...axes[1]!, to: 18 }])).toThrow(/limit/);
    expect(() => sweepCartesian([{ parameter: "a", from: 0, to: 1e308, step: 5e-324 }])).toThrow(/limit/);
    expect(() => sweepCartesian([axes[0]!, axes[0]!])).toThrow(/Duplicate/);
  });
});
