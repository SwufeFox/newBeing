import { describe, expect, it } from "vitest";
import { buildEvaluationCandidates, MAX_EVALUATION_CANDIDATES } from "../src/lib/evaluation-candidates.js";

const base = { fastPeriod: 5, slowPeriod: 20 };

describe("evaluation candidate construction", () => {
  it("overrides only the swept parameter and keeps the others intact", () => {
    const { candidates, error } = buildEvaluationCandidates(base, "fastPeriod", "5", "15", "5");
    expect(error).toBeNull();
    expect(candidates.map((candidate) => candidate.fastPeriod)).toEqual([5, 10, 15]);
    expect(candidates.every((candidate) => candidate.slowPeriod === 20)).toBe(true);
  });

  it("includes both endpoints and a single value when from equals to", () => {
    const { candidates } = buildEvaluationCandidates(base, "fastPeriod", "7", "7", "1");
    expect(candidates.map((candidate) => candidate.fastPeriod)).toEqual([7]);
  });

  it("rejects a range wider than the server limit instead of truncating it", () => {
    const { candidates, error } = buildEvaluationCandidates(base, "fastPeriod", "1", "100", "1");
    expect(candidates).toEqual([]);
    expect(error).toContain(`limit is ${MAX_EVALUATION_CANDIDATES}`);
  });

  it("accepts a range that lands exactly on the limit", () => {
    const { candidates, error } = buildEvaluationCandidates(base, "fastPeriod", "1", String(MAX_EVALUATION_CANDIDATES), "1");
    expect(error).toBeNull();
    expect(candidates).toHaveLength(MAX_EVALUATION_CANDIDATES);
  });

  it("does not emit duplicate candidates from fractional steps", () => {
    const { candidates, error } = buildEvaluationCandidates(base, "fastPeriod", "0.1", "1", "0.1");
    expect(error).toBeNull();
    expect(new Set(candidates.map((candidate) => candidate.fastPeriod)).size).toBe(candidates.length);
    expect(candidates[0]!.fastPeriod).toBe(0.1);
    expect(candidates.at(-1)!.fastPeriod).toBe(1);
  });

  it("rejects a non-positive step, a reversed range and non-numeric input", () => {
    expect(buildEvaluationCandidates(base, "fastPeriod", "5", "10", "0").error).toMatch(/greater than zero/);
    expect(buildEvaluationCandidates(base, "fastPeriod", "10", "5", "1").error).toMatch(/at least from/);
    expect(buildEvaluationCandidates(base, "fastPeriod", "a", "10", "1").error).toMatch(/must be numbers/);
  });

  it("rejects a strategy with no numeric parameter to vary", () => {
    expect(buildEvaluationCandidates(base, "", "1", "5", "1").error).toMatch(/no numeric parameter/);
  });
});
