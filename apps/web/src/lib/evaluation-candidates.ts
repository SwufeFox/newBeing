import type { StrategyParameters } from "@newbeing/core";

/** Mirrors SWEEP_MAX_RUNS on the server; candidates above it are rejected, not truncated. */
export const MAX_EVALUATION_CANDIDATES = 40;

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
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(increment)) {
    return { candidates: [], error: "From, to and step must be numbers." };
  }
  if (increment <= 0) return { candidates: [], error: "Step must be greater than zero." };
  if (end < start) return { candidates: [], error: "To must be at least from." };
  const count = Math.floor((end - start) / increment) + 1;
  if (count > MAX_EVALUATION_CANDIDATES) {
    return { candidates: [], error: `That range needs ${count} candidates; the limit is ${MAX_EVALUATION_CANDIDATES}. Widen the step.` };
  }
  const candidates: StrategyParameters[] = [];
  /* Rebuilt from index arithmetic so a 0.1 step does not accumulate binary drift
     into near-duplicate candidates that the server would reject as duplicates. */
  for (let index = 0; index < count; index += 1) {
    candidates.push({ ...parameters, [key]: Number((start + index * increment).toFixed(10)) });
  }
  return { candidates, error: null };
}
