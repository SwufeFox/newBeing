import type { StrategyParameters } from "@newbeing/core";
import { sweepValues, SWEEP_MAX_RUNS } from "@newbeing/application/sweep-values";

export const MAX_EVALUATION_CANDIDATES = SWEEP_MAX_RUNS;

/** Inclusive from/to/step values, each candidate overriding one numeric parameter.
 *  Rejects an oversized range instead of silently dropping its tail. */
export function buildEvaluationCandidates(
  parameters: StrategyParameters,
  key: string,
  from: string,
  to: string,
  step: string,
): { candidates: StrategyParameters[]; error: string | null } {
  if (!key) return { candidates: [], error: "This strategy has no numeric parameter to vary." };
  const start = Number(from);
  const end = Number(to);
  const increment = Number(step);
  if ([from, to, step].some((value) => value.trim() === "") || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(increment)) {
    return { candidates: [], error: "From, to and step must be numbers." };
  }
  if (increment <= 0) return { candidates: [], error: "Step must be greater than zero." };
  if (end < start) return { candidates: [], error: "To must be at least from." };
  try {
    const candidates = sweepValues(start, end, increment).map((value) => ({ ...parameters, [key]: value }));
    return { candidates, error: null };
  } catch (reason) {
    return { candidates: [], error: reason instanceof Error ? reason.message : "Invalid evaluation range." };
  }
}
