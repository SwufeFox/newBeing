import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ENGINE_VERSION, getStrategy, type BacktestResult, type ResearchReproduction, type StrategyDefinition, type StrategyParameters } from "@newbeing/core";
import { canonicalJson, getWorkspaceState, loadDatasetSnapshot, outcomeIdentity } from "@newbeing/storage";
export { outcomeIdentity } from "@newbeing/storage";

export class ResearchError extends Error {
  constructor(message: string, public readonly status: 404 | 409 | 422) { super(message); }
}
export function assertResearchAvailable(): void {
  if (getWorkspaceState().state.activeWorkspace === "replay") throw new ResearchError("Backtests are disabled while Replay is active, to avoid exposing future-derived results.", 409);
}
/** Hash all executable core modules, not just a version label or function body.
 * The server deployment must retain its compiled core artifact for reruns. */
export function researchImplementationHash(): string {
  // Bundlers may replace import.meta.url with a virtual [project] URL. Resolve
  // from the real host cwd first; native Node/MCP can fall back to this module.
  let entry: string | undefined;
  for (const anchor of [path.join(process.cwd(), "package.json"), import.meta.url]) {
    try {
      const candidate = createRequire(anchor).resolve("@newbeing/core");
      if (existsSync(candidate)) { entry = candidate; break; }
    } catch { /* Try the next runtime module anchor. */ }
  }
  if (!entry) throw new Error("Executable core artifact is unavailable.");
  const directory = path.dirname(entry);
  const files = readdirSync(directory).filter((name) => name.endsWith(".js")).sort();
  if (!files.length) throw new Error("Executable core artifact is unavailable.");
  const hash = createHash("sha256");
  for (const file of files) hash.update(canonicalJson([file, readFileSync(path.join(directory, file), "utf8")]));
  return hash.digest("hex");
}
export function reproductionFor(snapshotId: string): ResearchReproduction {
  return { format: 1, snapshotId, implementationHash: researchImplementationHash() };
}

export function assertSameOutcome(saved: BacktestResult, result: BacktestResult): void {
  if (outcomeIdentity(saved) !== outcomeIdentity(result)) throw new ResearchError("Saved research output drift detected; rerun was not published.", 409);
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
