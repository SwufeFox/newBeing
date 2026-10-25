import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { BacktestResult, BacktestSweepResult, WorkspaceState } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { experiments, savedEvaluations, savedSweeps, workspaceStates } from "./schema.js";
import { canonicalJson, loadDatasetSnapshot } from "./snapshots.js";
import { getWorkspaceState } from "./repositories.js";

/** Version 2 binds deterministic inputs and full outputs, excluding publication metadata. */
export function outcomeIdentity(result: BacktestResult): string {
  const { resultId: _id, createdAt: _at, rerunOf: _parent, reproduction: _ref, candleSource: _source, candleCache: _cache, ...computation } = result;
  return createHash("sha256").update(canonicalJson(["outcome-2", computation])).digest("hex");
}

/** Legacy input-only outcome IDs are accepted only when reading originals for comparison. */
export function validateResearchSweep(results: readonly BacktestResult[], sweep: BacktestSweepResult, allowLegacy = false): void {
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  const fail = () => { throw new Error("Sweep result bindings mismatch."); };
  if ((sweep.outcomeVersion !== 2 && !(allowLegacy && sweep.outcomeVersion === undefined)) ||
      !sweep.values.length || sweep.values.length > 40 || sweep.runs.length !== results.length || sweep.values.length !== results.length ||
      new Set(sweep.values).size !== sweep.values.length || new Set(results.map((r) => r.resultId)).size !== results.length ||
      !Object.hasOwn(sweep.parameters, sweep.parameter) || typeof sweep.parameters[sweep.parameter] !== "number" ||
      !sweep.reproduction || sweep.reproduction.format !== 1 || sweep.reproduction.snapshotId !== sweep.datasetId) fail();
  const snapshot = loadDatasetSnapshot(sweep.datasetId);
  if (snapshot.exchange !== sweep.exchange || snapshot.symbol !== sweep.symbol || snapshot.timeframe !== sweep.timeframe || snapshot.candles.length !== sweep.bars) fail();
  results.forEach((result, index) => {
    const run = sweep.runs[index]!;
    const value = sweep.values[index]!;
    if (!Number.isFinite(value) || run.value !== value || run.resultId !== result.resultId ||
        result.datasetId !== sweep.datasetId || result.exchange !== sweep.exchange || result.symbol !== sweep.symbol || result.timeframe !== sweep.timeframe ||
        result.strategyId !== sweep.strategyId || result.strategyVersion !== sweep.strategyVersion || result.engineVersion !== sweep.engineVersion ||
        !same(result.parameters, { ...sweep.parameters, [sweep.parameter]: value }) || !same(result.assumptions, sweep.config) ||
        !same(result.metrics, run.metrics) || !same(result.reproduction, sweep.reproduction) ||
        (sweep.outcomeVersion === 2 && run.outcomeId !== outcomeIdentity(result))) fail();
  });
}

/** Publish results only after the immutable input is available and verified.
 * A sweep and all of its full run results commit in one SQLite transaction. */
export interface SavedEvaluationRecord { evaluationId: string; request: string; report: string; createdAt: number }

export function getSavedEvaluation(evaluationId: string): SavedEvaluationRecord | undefined {
  return getDatabase().select().from(savedEvaluations).where(eq(savedEvaluations.evaluationId, evaluationId)).get();
}

export function listSavedEvaluations(limit = 20): SavedEvaluationRecord[] {
  return getDatabase().select().from(savedEvaluations).orderBy(desc(savedEvaluations.createdAt)).limit(Math.max(1, Math.min(100, limit))).all();
}

export function saveResearchResults(results: readonly BacktestResult[], sweep?: BacktestSweepResult, open?: { expected: ReturnType<typeof getWorkspaceState>; state: WorkspaceState }, evaluation?: { evaluationId: string; request: string; report: string; createdAt: number }): void {
  for (const result of results) {
    if (!result.reproduction || result.reproduction.snapshotId !== result.datasetId) throw new Error("Research result requires its original snapshot.");
    const snapshot = loadDatasetSnapshot(result.datasetId);
    if (snapshot.exchange !== result.exchange || snapshot.symbol !== result.symbol || snapshot.timeframe !== result.timeframe) throw new Error("Research snapshot identity mismatch.");
  }
  if (sweep) validateResearchSweep(results, sweep);
  getDatabase().transaction((tx) => {
    const current = getWorkspaceState();
    if (current.state.activeWorkspace === "replay") throw new Error("Research publication is disabled during Replay.");
    const navigate = open && current.updatedAt === open.expected.updatedAt && canonicalJson(current.state) === canonicalJson(open.expected.state);
    for (const result of results) tx.insert(experiments).values({ resultId: result.resultId, datasetId: result.datasetId, symbol: result.symbol, timeframe: result.timeframe, strategyId: result.strategyId, strategyVersion: result.strategyVersion, assumptions: canonicalJson(result.assumptions), result: canonicalJson(result), createdAt: Date.parse(result.createdAt) }).run();
    if (sweep) tx.insert(savedSweeps).values({ sweepId: sweep.sweepId, result: canonicalJson(sweep), createdAt: sweep.createdAt }).run();
    if (evaluation) tx.insert(savedEvaluations).values(evaluation).run();
    if (navigate) {
      const payload = JSON.stringify(open.state);
      const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
      tx.insert(workspaceStates).values({ id: 1, payload, updatedAt }).onConflictDoUpdate({ target: workspaceStates.id, set: { payload, updatedAt } }).run();
    }
  }, { behavior: "immediate" });
}
export function getSavedSweep(sweepId: string): BacktestSweepResult | undefined {
  const row = getDatabase().select().from(savedSweeps).where(eq(savedSweeps.sweepId, sweepId)).get();
  return row ? JSON.parse(row.result) as BacktestSweepResult : undefined;
}
export function listSavedSweeps(limit = 20): BacktestSweepResult[] {
  return getDatabase().select().from(savedSweeps).orderBy(desc(savedSweeps.createdAt)).limit(Math.max(1, Math.min(100, limit))).all().map((row) => JSON.parse(row.result) as BacktestSweepResult);
}
