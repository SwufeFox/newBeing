import { desc, eq } from "drizzle-orm";
import type { BacktestResult, BacktestSweepResult } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { experiments, savedSweeps } from "./schema.js";
import { canonicalJson, loadDatasetSnapshot } from "./snapshots.js";

/** Publish results only after the immutable input is available and verified.
 * A sweep and all of its full run results commit in one SQLite transaction. */
export function saveResearchResults(results: readonly BacktestResult[], sweep?: BacktestSweepResult): void {
  for (const result of results) {
    if (!result.reproduction || result.reproduction.snapshotId !== result.datasetId) throw new Error("Research result requires its original snapshot.");
    const snapshot = loadDatasetSnapshot(result.datasetId);
    if (snapshot.exchange !== result.exchange || snapshot.symbol !== result.symbol || snapshot.timeframe !== result.timeframe) throw new Error("Research snapshot identity mismatch.");
  }
  if (sweep && (sweep.runs.length !== results.length || sweep.runs.some((run, index) => run.resultId !== results[index]?.resultId || sweep.datasetId !== results[index]?.datasetId))) throw new Error("Sweep result bindings mismatch.");
  getDatabase().transaction((tx) => {
    for (const result of results) tx.insert(experiments).values({ resultId: result.resultId, datasetId: result.datasetId, symbol: result.symbol, timeframe: result.timeframe, strategyId: result.strategyId, strategyVersion: result.strategyVersion, assumptions: canonicalJson(result.assumptions), result: canonicalJson(result), createdAt: Date.parse(result.createdAt) }).run();
    if (sweep) tx.insert(savedSweeps).values({ sweepId: sweep.sweepId, result: canonicalJson(sweep), createdAt: sweep.createdAt }).run();
  });
}
export function getSavedSweep(sweepId: string): BacktestSweepResult | undefined {
  const row = getDatabase().select().from(savedSweeps).where(eq(savedSweeps.sweepId, sweepId)).get();
  return row ? JSON.parse(row.result) as BacktestSweepResult : undefined;
}
export function listSavedSweeps(limit = 20): BacktestSweepResult[] {
  return getDatabase().select().from(savedSweeps).orderBy(desc(savedSweeps.createdAt)).limit(Math.max(1, Math.min(100, limit))).all().map((row) => JSON.parse(row.result) as BacktestSweepResult);
}
