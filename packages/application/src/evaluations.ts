import type { BacktestResult } from "@newbeing/core";
import { loadDatasetSnapshot, saveDatasetSnapshot, saveResearchResults } from "@newbeing/storage";
import { assertResearchAvailable, reproductionFor, ResearchError } from "./research-inputs.js";
import { runTrainHoldout, type TrainHoldoutInput, type TrainHoldoutResult } from "./train-holdout.js";

export type ResearchEvaluationRequest = Pick<TrainHoldoutInput, "datasetId" | "strategyId" | "candidates" | "config" | "splitIndex">;

export interface ResearchEvaluationResult extends TrainHoldoutResult {
  trainingDatasetId: string;
  holdoutDatasetId: string;
  resultIds: { training: string[]; holdout: string };
}

/** Evaluate an existing immutable snapshot offline, then publish all runs together.
 * datasetId on the report names the parent; each run names its actual segment.
 * Snapshots publish before the result transaction, so failed publication can leave
 * reusable snapshots, but never a partially saved set of evaluation results.
 */
export function runResearchEvaluation(request: ResearchEvaluationRequest): ResearchEvaluationResult {
  assertResearchAvailable();
  let snapshot: ReturnType<typeof loadDatasetSnapshot>;
  try { snapshot = loadDatasetSnapshot(request.datasetId); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ResearchError("Evaluation dataset snapshot not found.", 404);
    throw error;
  }
  const evaluation = runTrainHoldout({
    datasetId: request.datasetId, strategyId: request.strategyId,
    candidates: request.candidates, config: request.config, splitIndex: request.splitIndex,
    candles: snapshot.candles, exchange: snapshot.exchange, symbol: snapshot.symbol, timeframe: snapshot.timeframe,
  });
  const segment = (start: number, end: number) => saveDatasetSnapshot({
    exchange: snapshot.exchange, symbol: snapshot.symbol, timeframe: snapshot.timeframe,
    candles: snapshot.candles.slice(start, end),
  });
  const trainingDatasetId = segment(0, request.splitIndex);
  const holdoutDatasetId = segment(request.splitIndex, snapshot.candles.length);
  const reproduction = reproductionFor(trainingDatasetId);
  const bind = (result: BacktestResult, datasetId: string): void => {
    result.datasetId = datasetId;
    result.reproduction = { ...reproduction, snapshotId: datasetId };
  };
  for (const run of evaluation.training) bind(run.result, trainingDatasetId);
  bind(evaluation.holdout, holdoutDatasetId);
  assertResearchAvailable();
  saveResearchResults([...evaluation.training.map((run) => run.result), evaluation.holdout]);
  return {
    ...evaluation, trainingDatasetId, holdoutDatasetId,
    resultIds: { training: evaluation.training.map((run) => run.result.resultId), holdout: evaluation.holdout.resultId },
  };
}
