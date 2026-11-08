import { desc, eq } from "drizzle-orm";
import type { StrategyParameters } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { strategies } from "./schema.js";

export interface StoredStrategy {
  id: string;
  name: string;
  version: string;
  description: string;
  parameters: StrategyParameters;
  source: string;
  updatedAt: number;
}
/** Listing metadata without the potentially large source draft. */
export type StoredStrategySummary = Omit<StoredStrategy, "source">;

export function listStoredStrategies(): StoredStrategy[] {
  return getDatabase().select().from(strategies).orderBy(desc(strategies.updatedAt)).all().map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    parameters: JSON.parse(row.parameters) as StrategyParameters,
    source: row.source,
    updatedAt: row.updatedAt,
  }));
}

/** Avoid reading the source column for roster responses; fetch it by ID. */
export function listStoredStrategySummaries(): StoredStrategySummary[] {
  return getDatabase().select({
    id: strategies.id,
    name: strategies.name,
    version: strategies.version,
    description: strategies.description,
    parameters: strategies.parameters,
    updatedAt: strategies.updatedAt,
  }).from(strategies).orderBy(desc(strategies.updatedAt)).all().map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    parameters: JSON.parse(row.parameters) as StrategyParameters,
    updatedAt: row.updatedAt,
  }));
}

export function getStoredStrategy(id: string): StoredStrategy | undefined {
  const row = getDatabase().select().from(strategies).where(eq(strategies.id, id)).get();
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    parameters: JSON.parse(row.parameters) as StrategyParameters,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

export function saveStrategy(strategy: Omit<StoredStrategy, "updatedAt">): StoredStrategy {
  const updatedAt = Date.now();
  const row = { ...strategy, parameters: JSON.stringify(strategy.parameters), updatedAt };
  getDatabase().insert(strategies).values(row).onConflictDoUpdate({
    target: strategies.id,
    set: {
      name: strategy.name,
      version: strategy.version,
      description: strategy.description,
      parameters: JSON.stringify(strategy.parameters),
      source: strategy.source,
      updatedAt,
    },
  }).run();
  return { ...strategy, updatedAt };
}
