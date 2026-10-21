import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ENGINE_VERSION, getStrategy, type BacktestResult, type ResearchReproduction, type StrategyDefinition, type StrategyParameters } from "@newbeing/core";
import { canonicalJson, getWorkspaceState, loadDatasetSnapshot } from "@newbeing/storage";

export class ResearchError extends Error {
  constructor(message: string, public readonly status: 404 | 409 | 422) { super(message); }
}
export function assertResearchAvailable(): void {
  if (getWorkspaceState().state.activeWorkspace === "replay") throw new ResearchError("Backtests are disabled while Replay is active, to avoid exposing future-derived results.", 409);
}
/** Hash all executable core modules, not just a version label or function body.
 * The server deployment must retain its compiled core artifact for reruns. */
export function researchImplementationHash(): string {
  const directory = path.dirname(fileURLToPath(import.meta.resolve("@newbeing/core")));
  const files = readdirSync(directory).filter((name) => name.endsWith(".js")).sort();
  if (!files.length) throw new Error("Executable core artifact is unavailable.");
  const hash = createHash("sha256");
  for (const file of files) hash.update(canonicalJson([file, readFileSync(path.join(directory, file), "utf8")]));
  return hash.digest("hex");
}
export function reproductionFor(snapshotId: string): ResearchReproduction {
  return { format: 1, snapshotId, implementationHash: researchImplementationHash() };
}

/** Deterministic outcome identity: same dataset + parameters + assumptions + engine
 * produces the same id on every run. Deliberately excludes resultId and createdAt,
 * so a rerun of the same inputs yields the same outcome while keeping a fresh run id. */
export function outcomeIdentity(result: Pick<BacktestResult, "datasetId" | "strategyId" | "strategyVersion" | "parameters" | "assumptions" | "execution" | "engineVersion">): string {
  const hash = createHash("sha256");
  hash.update(canonicalJson([
    "outcome-1",
    result.datasetId,
    result.strategyId,
    result.strategyVersion,
    result.parameters,
    result.assumptions,
    result.execution,
    result.engineVersion,
  ]));
  return hash.digest("hex");
}
export function resolveResearchStrategy(id: string, parameters: StrategyParameters): { strategy: StrategyDefinition; parameters: StrategyParameters } {
  const strategy = getStrategy(id);
  if (!strategy) throw new Error(`Unknown built-in strategy: ${id}`);
  for (const [key, value] of Object.entries(parameters)) {
    if (!Object.hasOwn(strategy.defaults, key) || typeof value !== typeof strategy.defaults[key] || (typeof value === "number" && !Number.isFinite(value))) throw new Error(`Invalid strategy parameter: ${key}`);
  }
  return { strategy, parameters: { ...strategy.defaults, ...parameters } };
}
export function originalResearchInput(saved: { reproduction?: ResearchReproduction; datasetId: string; strategyId: string; strategyVersion: string; engineVersion: string; exchange: string; symbol: string; timeframe: string }) {
  assertResearchAvailable();
  const ref = saved.reproduction;
  if (!ref || ref.format !== 1) throw new ResearchError("Legacy result has no immutable candle snapshot and cannot be rerun reproducibly.", 409);
  const strategy = getStrategy(saved.strategyId);
  if (!strategy || strategy.version !== saved.strategyVersion || saved.engineVersion !== ENGINE_VERSION || ref.implementationHash !== researchImplementationHash()) throw new ResearchError("Saved strategy/engine implementation is incompatible with this deployment.", 409);
  if (ref.snapshotId !== saved.datasetId) throw new ResearchError("Saved snapshot identity mismatch.", 422);
  const snapshot = loadDatasetSnapshot(ref.snapshotId);
  if (snapshot.exchange !== saved.exchange || snapshot.symbol !== saved.symbol || snapshot.timeframe !== saved.timeframe) throw new ResearchError("Saved instrument identity mismatch.", 422);
  return { strategy, snapshot, reproduction: { ...ref } };
}
