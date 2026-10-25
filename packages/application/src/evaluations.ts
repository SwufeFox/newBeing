import { randomUUID } from "node:crypto";
import type { BacktestResult } from "@newbeing/core";
import { loadDatasetSnapshot, saveDatasetSnapshot, saveResearchResults } from "@newbeing/storage";
import { assertResearchAvailable, reproductionFor, ResearchError } from "./research-inputs.js";
import { runTrainHoldout, type TrainHoldoutInput, type TrainHoldoutResult } from "./train-holdout.js";

export type ResearchEvaluationRequest = Pick<TrainHoldoutInput, "datasetId" | "strategyId" | "candidates" | "config" | "splitIndex">;

export interface ResearchEvaluationResult extends TrainHoldoutResult {
  trainingDatasetId: string;
  holdoutDatasetId: string;
  resultIds: { training: string[]; holdout: string };
  reportId: string;
  createdAt: string;
}

/** Evaluate an existing immutable snapshot offline, then publish all runs together. */
export function runResearchEvaluation(request: ResearchEvaluationRequest, originalRequest = JSON.stringify(request)): ResearchEvaluationResult {
  assertResearchAvailable();
  let snapshot: ReturnType<typeof loadDatasetSnapshot>;
  try { snapshot = loadDatasetSnapshot(request.datasetId); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ResearchError("Evaluation dataset snapshot not found.", 404);
    throw error;
  }
  const evaluation = runTrainHoldout({
    datasetId: request.datasetId, strategyId: request.strategyId, candidates: request.candidates,
    config: request.config, splitIndex: request.splitIndex, candles: snapshot.candles,
    exchange: snapshot.exchange, symbol: snapshot.symbol, timeframe: snapshot.timeframe,
  });
  const segment = (start: number, end: number) => saveDatasetSnapshot({
    exchange: snapshot.exchange, symbol: snapshot.symbol, timeframe: snapshot.timeframe, candles: snapshot.candles.slice(start, end),
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

  const resultIds = { training: evaluation.training.map((run) => run.result.resultId), holdout: evaluation.holdout.resultId };
  const reportId = randomUUID();
  const createdAt = new Date().toISOString();
  const compactReport = {
    reportId, createdAt, datasetId: evaluation.datasetId, trainingDatasetId, holdoutDatasetId,
    exchange: evaluation.holdout.exchange, symbol: evaluation.holdout.symbol, timeframe: evaluation.holdout.timeframe,
    strategyId: evaluation.holdout.strategyId, trainingBoundary: evaluation.trainingBoundary, holdoutBoundary: evaluation.holdoutBoundary,
    training: evaluation.training.map(({ candidateIndex, parameters, result }) => ({ candidateIndex, parameters, result: { resultId: result.resultId, metrics: result.metrics } })),
    selectedCandidateIndex: evaluation.selectedCandidateIndex, selectedParameters: evaluation.selectedParameters,
    selectionRule: evaluation.selectionRule, initialization: evaluation.initialization, evaluation: evaluation.evaluation,
    holdout: { resultId: evaluation.holdout.resultId, metrics: evaluation.holdout.metrics, exchange: evaluation.holdout.exchange, symbol: evaluation.holdout.symbol, timeframe: evaluation.holdout.timeframe },
    resultIds,
  };
  saveResearchResults([...evaluation.training.map((run) => run.result), evaluation.holdout], undefined, undefined, {
    evaluationId: reportId, request: originalRequest, report: JSON.stringify(compactReport), createdAt: Date.parse(createdAt),
  });
  return { ...evaluation, trainingDatasetId, holdoutDatasetId, resultIds, reportId, createdAt };
}
