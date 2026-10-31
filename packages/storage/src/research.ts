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
      (sweep.mode !== undefined && sweep.mode !== (sweep.walkForward ? "walk-forward" : "full-sample")) ||
      !sweep.values.length || sweep.values.length > 40 || sweep.runs.length !== results.length || (!sweep.walkForward && sweep.values.length !== results.length) ||
      new Set(sweep.values).size !== sweep.values.length || new Set(results.map((r) => r.resultId)).size !== results.length ||
      !Object.hasOwn(sweep.parameters, sweep.parameter) || typeof sweep.parameters[sweep.parameter] !== "number" ||
      !sweep.reproduction || sweep.reproduction.format !== 1 || sweep.reproduction.snapshotId !== sweep.datasetId) fail();
  const snapshot = loadDatasetSnapshot(sweep.datasetId);
  if (snapshot.exchange !== sweep.exchange || snapshot.symbol !== sweep.symbol || snapshot.timeframe !== sweep.timeframe || snapshot.candles.length !== sweep.bars) fail();
  const legacySegments = new Map<string, { start: number; end: number }>();
  if (sweep.walkForward && sweep.runs.some((run) => !run.segment)) {
    if (!allowLegacy || sweep.runs.some((run) => Boolean(run.segment)) || sweep.runs.length !== sweep.values.length * 4 + 4) fail();
    const n = snapshot.candles.length;
    const boundaries = [Math.floor(0.5 * n), Math.floor(0.6 * n), Math.floor(0.7 * n), Math.floor(0.8 * n)];
    let offset = 0;
    for (let index = 0; index < 3; index++) {
      for (let candidate = 0; candidate < sweep.values.length; candidate++) legacySegments.set(sweep.runs[offset++]!.resultId, { start: 0, end: boundaries[index]! });
      legacySegments.set(sweep.runs[offset++]!.resultId, { start: boundaries[index]!, end: boundaries[index + 1]! });
    }
    for (let candidate = 0; candidate < sweep.values.length; candidate++) legacySegments.set(sweep.runs[offset++]!.resultId, { start: 0, end: boundaries[3]! });
    legacySegments.set(sweep.runs[offset]!.resultId, { start: boundaries[3]!, end: n });
  }
  results.forEach((result, index) => {
    const run = sweep.runs[index]!;
    const value = sweep.walkForward ? result.parameters[sweep.parameter] as number : sweep.values[index]!;
    if (sweep.walkForward) {
      if (!run.segment && !legacySegments.has(run.resultId)) fail();
      if (run.segment) {
        if (!Number.isInteger(run.segment.start) || !Number.isInteger(run.segment.end) || run.segment.start < 0 || run.segment.end - run.segment.start < 2 || run.segment.end > snapshot.candles.length || run.segment.reproduction.snapshotId !== run.segment.datasetId) fail();
        const segmentSnapshot = loadDatasetSnapshot(run.segment.datasetId);
        if (segmentSnapshot.exchange !== sweep.exchange || segmentSnapshot.symbol !== sweep.symbol || segmentSnapshot.timeframe !== sweep.timeframe || !same(segmentSnapshot.candles, snapshot.candles.slice(run.segment.start, run.segment.end))) fail();
      } else if (!allowLegacy || result.datasetId !== sweep.datasetId) fail();
    }
    if (!Number.isFinite(value) || run.value !== value || run.resultId !== result.resultId ||
        result.datasetId !== (sweep.walkForward ? run.segment?.datasetId ?? sweep.datasetId : sweep.datasetId) || result.exchange !== sweep.exchange || result.symbol !== sweep.symbol || result.timeframe !== sweep.timeframe ||
        result.strategyId !== sweep.strategyId || result.strategyVersion !== sweep.strategyVersion || result.engineVersion !== sweep.engineVersion ||
        !same(result.parameters, { ...sweep.parameters, [sweep.parameter]: value }) || !same(result.assumptions, sweep.config) ||
        !same(result.metrics, run.metrics) || !same(result.reproduction, sweep.walkForward ? run.segment?.reproduction ?? sweep.reproduction : sweep.reproduction) ||

        (sweep.outcomeVersion === 2 && run.outcomeId !== outcomeIdentity(result))) fail();
  });
  if (sweep.walkForward) {
    const report = sweep.walkForward;
    const total = snapshot.candles.length;
    const expected = { train50: Math.floor(0.5 * total), train60: Math.floor(0.6 * total), train70: Math.floor(0.7 * total), train80: Math.floor(0.8 * total), total };
    if (report.mode !== "walk-forward" || report.selectionRule !== "training-totalReturn-desc/parameter-value-asc" ||
        !same(report.boundaries, expected) || report.folds.length !== 3 ||
        expected.train50 < 2 || expected.train60 - expected.train50 < 2 || expected.train70 - expected.train60 < 2 || expected.train80 - expected.train70 < 2 || total - expected.train80 < 2 ||
        results.length !== sweep.values.length * 4 + 4) fail();

    const segmentForRun = (run: BacktestSweepResult["runs"][number]) => run.segment ?? legacySegments.get(run.resultId);
    const allowedSegments = new Set([
      `0:${expected.train50}`, `0:${expected.train60}`, `0:${expected.train70}`, `0:${expected.train80}`,
      `${expected.train50}:${expected.train60}`, `${expected.train60}:${expected.train70}`,
      `${expected.train70}:${expected.train80}`, `${expected.train80}:${total}`,
    ]);
    if (sweep.runs.some((run) => {
      const segment = segmentForRun(run);
      return !segment || !allowedSegments.has(`${segment.start}:${segment.end}`);
    })) fail();
    const runById = new Map(sweep.runs.map((run) => [run.resultId, run]));
    const candles = snapshot.candles;
    const selectTrainingWinner = (end: number) => {
      const candidates = sweep.runs.filter((run) => {
        const segment = segmentForRun(run);
        return segment?.start === 0 && segment.end === end;
      });
      const candidateValues = candidates.map((run) => run.value).sort((a, b) => a - b);
      const expectedValues = [...sweep.values].sort((a, b) => a - b);
      if (candidates.length !== expectedValues.length || !same(candidateValues, expectedValues)) fail();
      return [...candidates].sort((a, b) => b.metrics.totalReturn - a.metrics.totalReturn || a.value - b.value)[0]!;
    };
    const folds = [
      { trainEnd: expected.train50, validationStart: expected.train50, validationEnd: expected.train60 },
      { trainEnd: expected.train60, validationStart: expected.train60, validationEnd: expected.train70 },
      { trainEnd: expected.train70, validationStart: expected.train70, validationEnd: expected.train80 },
    ];
    for (let index = 0; index < folds.length; index++) {
      const fold = report.folds[index]!;
      const boundary = folds[index]!;
      const selectedTraining = runById.get(fold.trainingResultId);
      const validation = runById.get(fold.validationResultId);
      const winner = selectTrainingWinner(boundary.trainEnd);
      const validationRuns = sweep.runs.filter((run) => {
        const segment = segmentForRun(run);
        return segment?.start === boundary.validationStart && segment.end === boundary.validationEnd;
      });
      if (fold.trainEnd !== boundary.trainEnd || fold.validationStart !== boundary.validationStart || fold.validationEnd !== boundary.validationEnd ||
          fold.trainStartTimestamp !== candles[0]!.timestamp || fold.trainEndTimestamp !== candles[boundary.trainEnd - 1]!.timestamp ||
          fold.validationStartTimestamp !== candles[boundary.validationStart]!.timestamp || fold.validationEndTimestamp !== candles[boundary.validationEnd - 1]!.timestamp ||
          !selectedTraining || !validation || validationRuns.length !== 1 ||
          selectedTraining.resultId !== winner.resultId || selectedTraining.value !== fold.candidateValue ||
          validation.resultId !== validationRuns[0]!.resultId || validation.value !== fold.candidateValue ||
          !same(fold.trainingMetrics, selectedTraining.metrics) || !same(fold.validationMetrics, validation.metrics)) fail();
    }
    const finalWinner = selectTrainingWinner(expected.train80);
    const finalTest = runById.get(report.finalTestResultId);
    const finalTestRuns = sweep.runs.filter((run) => {
      const segment = segmentForRun(run);
      return segment?.start === expected.train80 && segment.end === total;
    });
    if (report.finalTrainingStartTimestamp !== candles[0]!.timestamp || report.finalTrainingEndTimestamp !== candles[expected.train80 - 1]!.timestamp ||
        report.finalTestStartTimestamp !== candles[expected.train80]!.timestamp || report.finalTestEndTimestamp !== candles[total - 1]!.timestamp ||
        report.finalCandidateValue !== finalWinner.value || report.finalTrainingResultId !== finalWinner.resultId ||
        !same(report.finalTrainingMetrics, finalWinner.metrics) || !finalTest || finalTestRuns.length !== 1 ||
        finalTest.resultId !== finalTestRuns[0]!.resultId || finalTest.value !== report.finalCandidateValue || !same(report.finalTestMetrics, finalTest.metrics)) fail();
  }
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
