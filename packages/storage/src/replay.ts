import { and, eq } from "drizzle-orm";
import { SPOT_EXECUTION_POLICY, SIMULATION_PRECISION, matchReplayBar, submitReplayOrder, validateReplayConfig, type Candle, type ExchangeId, type InstrumentIdentity, type ReplayConfig, type ReplayExecution, type ReplayOrderInput, type ReplaySession, type Timeframe } from "@newbeing/core";
import { INTERVALS } from "./candle-cache.js";
import { getDatabase } from "./db.js";
import { replayExecutions, replaySessions } from "./schema.js";
import { EXCHANGE_IDS, paperAccountId } from "./paper.js";
import { canonicalJson, loadDatasetSnapshot } from "./snapshots.js";

export function replayAccountId(sessionId: string, symbol: string, exchange: ExchangeId = "binance"): string {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) throw new Error("Invalid replay session ID.");
  const parts = paperAccountId(symbol, exchange).split(":");
  const base = parts[2];
  const quote = parts[3];
  if (!base || !quote) throw new Error("Invalid replay symbol.");
  return `paper:replay:${sessionId}:${base}:${quote}`;
}

function replaySessionFromRow(row: typeof replaySessions.$inferSelect): ReplaySession | undefined {
  if (!(["active", "finished"] as string[]).includes(row.status)) return undefined;
  try {
    const bars = JSON.parse(row.bars) as Candle[];
    if (!Array.isArray(bars)) return undefined;
    const candleSource = row.candleSource === "live" || row.candleSource === "local-cache" ? row.candleSource : undefined;
    let candleCache: ReplaySession["candleCache"];
    if (row.candleCache) {
      try {
        const parsed = JSON.parse(row.candleCache) as unknown;
        if (typeof parsed === "object" && parsed !== null && "fallback" in parsed && typeof parsed.fallback === "boolean" && "cachedAt" in parsed) {
          const cachedAt = parsed.cachedAt;
          if (typeof cachedAt === "string" || cachedAt === null) candleCache = { fallback: parsed.fallback, cachedAt };
        }
      } catch {
        /* Bad optional provenance must not make a valid replay session unreadable. */
      }
    }
    return {
      id: row.id,
      exchange: (EXCHANGE_IDS.includes(row.exchange as ExchangeId) ? row.exchange : "binance") as ExchangeId,
      symbol: row.symbol,
      timeframe: row.timeframe as Timeframe,
      startAt: row.startAt,
      cursor: row.cursor,
      bars,
      ...(candleSource ? { candleSource } : {}),
      ...(candleCache ? { candleCache } : {}),
      status: row.status as ReplaySession["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch {
    return undefined;
  }
}

export function createReplaySession(session: ReplaySession): void {
  getDatabase().insert(replaySessions).values({
    id: session.id,
    exchange: session.exchange,
    symbol: session.symbol,
    timeframe: session.timeframe,
    startAt: session.startAt,
    cursor: session.cursor,
    bars: JSON.stringify(session.bars),
    candleSource: session.candleSource ?? null,
    candleCache: session.candleCache ? JSON.stringify(session.candleCache) : null,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }).run();
}

export function getReplaySession(id: string): ReplaySession | undefined {
  const row = getDatabase().select().from(replaySessions).where(eq(replaySessions.id, id)).get();
  return row ? replaySessionFromRow(row) : undefined;
}

export function advanceReplaySession(
  id: string,
  expectedCursor: number,
  candle: Candle,
  provenance?: { source: "live" | "local-cache"; cache: { fallback: boolean; cachedAt: string | null } },
  expectedRevision?: number,
): { session: ReplaySession; deduplicated: boolean } {
  const db = getDatabase();
  return db.transaction((tx) => {
    const row = tx.select().from(replaySessions).where(eq(replaySessions.id, id)).get();
    const current = row ? replaySessionFromRow(row) : undefined;
    if (!current) throw new Error("Replay session not found or invalid.");
    if (current.status !== "active" || current.cursor !== expectedCursor) return { session: current, deduplicated: true };
    if (candle.timestamp <= current.cursor) throw new Error("Replay candle must move strictly forward.");
    const execution = getReplayExecution(id);
    if (execution) {
      if (execution.policyVersion !== 2) throw new Error("Legacy Replay execution is read-only; start a new session to select the current policy.");
      if (execution.datasetId) {
        const next = nextFrozenReplayBar(id, { session: current, execution });
        if (!next || canonicalJson(next) !== canonicalJson(candle)) throw new Error("Replay candle does not match its frozen dataset.");
      }
      if (expectedRevision !== undefined && execution.revision !== expectedRevision) throw new Error("Replay revision conflict; reload before retrying.");
      if (candle.timestamp !== current.cursor + INTERVALS[current.timeframe]) throw new Error("Replay requires the next contiguous bar.");
      matchReplayBar(execution, candle);
      execution.revision++;
      tx.update(replayExecutions).set({ payload: JSON.stringify(execution) }).where(eq(replayExecutions.sessionId, id)).run();
    }
    const bars = [...current.bars, candle].slice(-1000);
    const candleSource = current.candleSource === "local-cache" || provenance?.source === "local-cache"
      ? "local-cache"
      : provenance?.source ?? current.candleSource;
    const candleCache = provenance?.source === "local-cache" ? provenance.cache : current.candleCache;
    const updated: ReplaySession = {
      ...current,
      cursor: candle.timestamp,
      bars,
      ...(candleSource ? { candleSource } : {}),
      ...(candleCache ? { candleCache } : {}),
      updatedAt: new Date().toISOString(),
    };
    tx.update(replaySessions).set({
      cursor: updated.cursor,
      bars: JSON.stringify(updated.bars),
      candleSource: updated.candleSource ?? null,
      candleCache: updated.candleCache ? JSON.stringify(updated.candleCache) : null,
      updatedAt: updated.updatedAt,
    })
      .where(and(eq(replaySessions.id, id), eq(replaySessions.cursor, expectedCursor), eq(replaySessions.status, "active"))).run();
    const savedRow = tx.select().from(replaySessions).where(eq(replaySessions.id, id)).get();
    const saved = savedRow ? replaySessionFromRow(savedRow) : undefined;
    if (!saved) throw new Error("Replay session update failed.");
    return { session: saved, deduplicated: false };
  }, { behavior: "immediate" });
}

export function createConfiguredReplaySession(session: ReplaySession, instrument: InstrumentIdentity, config: ReplayConfig, datasetId?: string): ReplayExecution {
  validateReplayConfig(config);
  if (datasetId) {
    const snapshot = loadDatasetSnapshot(datasetId);
    if (snapshot.exchange !== session.exchange || snapshot.symbol !== session.symbol || snapshot.timeframe !== session.timeframe) throw new Error("Frozen Replay dataset instrument mismatch.");
    const seed = snapshot.candles.filter((bar) => bar.timestamp <= session.cursor).slice(-session.bars.length);
    if (!seed.length || seed.at(-1)?.timestamp !== session.cursor || canonicalJson(seed) !== canonicalJson(session.bars)) throw new Error("Replay seed must match its frozen dataset.");
  }
  if (instrument.venue !== session.exchange || instrument.symbol !== session.symbol || instrument.id !== `${instrument.venue}:spot:${encodeURIComponent(instrument.nativeId)}` || !instrument.nativeId || instrument.marketType !== "spot" || `${instrument.base}/${instrument.quote}` !== session.symbol) throw new Error("Replay instrument does not match session.");
  return getDatabase().transaction((tx) => {
    createReplaySession(session);
    const state: ReplayExecution = {
      version: 1, policyVersion: 2, executionPolicy: { ...SPOT_EXECUTION_POLICY }, ...(datasetId ? { datasetId } : {}), revision: 0, simulationPrecision: SIMULATION_PRECISION,
      account: { id: replayAccountId(session.id, session.symbol, session.exchange), venue: session.exchange, mode: "replay", quote: instrument.quote },
      instrument, config,
      portfolio: { quoteBalance: config.initialCapital, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: config.feeRate },
      orders: [], fills: [], brackets: [], equity: [{ timestamp: session.cursor, equity: config.initialCapital }], notes: "", tags: [],
    };
    tx.insert(replayExecutions).values({ sessionId: session.id, payload: JSON.stringify(state) }).run();
    return state;
  }, { behavior: "immediate" });
}

export function getReplayExecution(id: string): ReplayExecution | undefined {
  const row = getDatabase().select().from(replayExecutions).where(eq(replayExecutions.sessionId, id)).get();
  return row ? JSON.parse(row.payload) as ReplayExecution : undefined;
}

export function nextFrozenReplayBar(
  id: string,
  loaded?: { session?: ReplaySession; execution?: ReplayExecution },
): Candle | undefined {
  const session = loaded?.session ?? getReplaySession(id);
  const execution = loaded?.execution ?? getReplayExecution(id);
  if (!session || !execution?.datasetId) throw new Error("A frozen Replay dataset is required.");
  const snapshot = loadDatasetSnapshot(execution.datasetId);
  return snapshot.candles.find((bar) => bar.timestamp > session.cursor);
}

export type ReplayCommand =
  | { action: "order"; order: ReplayOrderInput }
  | { action: "cancel"; clientOrderId: string }
  | { action: "journal"; notes: string; tags: string[] }
  | { action: "finish" };

/** Legacy history has no compatible fill ledger. Start a new session explicitly. */
export function upgradeLegacyReplay(session: ReplaySession, instrument: InstrumentIdentity): ReplayExecution {
  const existing = getReplayExecution(session.id);
  if (existing) return existing;
  if (instrument.venue !== session.exchange || instrument.symbol !== session.symbol) throw new Error("Replay instrument mismatch.");
  throw new Error("Legacy Replay cannot acquire new execution semantics. Start a new configured session; legacy wallet and history remain available.");
}

export function commandReplay(id: string, expectedRevision: number, command: ReplayCommand): ReplayExecution {
  return getDatabase().transaction((tx) => {
    const session = getReplaySession(id);
    const state = getReplayExecution(id);
    if (!session || !state) throw new Error("Replay execution not found.");
    if (state.policyVersion !== 2) throw new Error("Legacy Replay execution is read-only; start a new session to select the current policy.");
    // Exact retries of an order remain safe even after the cursor/revision has moved.
    if (command.action === "order" && state.orders.some((order) => order.clientOrderId === command.order.clientOrderId)) {
      submitReplayOrder(state, command.order, session.cursor);
      return state;
    }
    if (state.revision !== expectedRevision) throw new Error("Replay revision conflict; reload before retrying.");
    if (command.action !== "journal" && session.status !== "active") throw new Error("Replay session has finished.");
    if (command.action === "order") submitReplayOrder(state, command.order, session.cursor);
    if (command.action === "cancel") {
      const order = state.orders.find((item) => item.clientOrderId === command.clientOrderId);
      if (!order) throw new Error("Replay order not found.");
      if (order.status === "submitted") order.status = "cancelled";
      else if (order.status !== "cancelled") throw new Error("Only pending Replay orders can be cancelled.");
    }
    if (command.action === "journal") {
      if (command.notes.length > 20_000 || command.tags.length > 20 || command.tags.some((tag) => !tag.trim() || tag.length > 80)) throw new Error("Invalid Replay journal.");
      state.notes = command.notes;
      state.tags = [...new Set(command.tags.map((tag) => tag.trim()))];
    }
    if (command.action === "finish") {
      state.orders.forEach((order) => { if (order.status === "submitted") order.status = "cancelled"; });
      tx.update(replaySessions).set({ status: "finished", updatedAt: new Date().toISOString() }).where(eq(replaySessions.id, id)).run();
    }
    state.revision++;
    tx.update(replayExecutions).set({ payload: JSON.stringify(state) }).where(eq(replayExecutions.sessionId, id)).run();
    return state;
  }, { behavior: "immediate" });
}

export function finishReplaySession(id: string): ReplaySession | undefined {
  const execution = getReplayExecution(id);
  if (execution) {
    commandReplay(id, execution.revision, { action: "finish" });
    return getReplaySession(id);
  }
  const db = getDatabase();
  db.update(replaySessions).set({ status: "finished", updatedAt: new Date().toISOString() })
    .where(and(eq(replaySessions.id, id), eq(replaySessions.status, "active"))).run();
  return getReplaySession(id);
}
