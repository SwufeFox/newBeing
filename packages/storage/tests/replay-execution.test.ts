import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { advanceReplaySession, candleCache, closeDatabaseForTests, commandReplay, createConfiguredReplaySession, createReplaySession, finishReplaySession, getCachedCandles, getDatabase, getReplayExecution, getReplaySession, nextFrozenReplayBar, saveCachedCandles, saveDatasetSnapshot, upgradeLegacyReplay } from "../src/index.js";
import type { Candle, InstrumentIdentity, ReplaySession } from "@newbeing/core";

let directory: string;
const candle = (timestamp: number): Candle => ({ timestamp, open: 100, high: 110, low: 90, close: 100, volume: 1 });
const instrument: InstrumentIdentity = { id: "kraken:spot:XXBTZUSD", venue: "kraken", nativeId: "XXBTZUSD", symbol: "BTC/USD", base: "BTC", quote: "USD", marketType: "spot" };
const config = { initialCapital: 2000, feeRate: 0.001, slippageRate: 0.01 };
const session = (): ReplaySession => ({ id: "session-execution-1234", exchange: "kraken", symbol: "BTC/USD", timeframe: "1m", startAt: 120_000, cursor: 60_000, bars: [candle(60_000)], status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
const order = { clientOrderId: "once", type: "market" as const, side: "buy" as const, quantity: 2 };

beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-execution-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  vi.restoreAllMocks();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});

describe("transactional Replay execution", () => {
  it("persists pending intent, fills and journal across a database restart", () => {
    const s = session();
    createConfiguredReplaySession(s, instrument, config);
    commandReplay(s.id, 0, { action: "order", order });
    expect(getReplayExecution(s.id)?.fills).toEqual([]);
    closeDatabaseForTests();
    expect(getReplayExecution(s.id)?.orders[0]?.status).toBe("submitted");
    advanceReplaySession(s.id, s.cursor, candle(120_000), undefined, 1);
    commandReplay(s.id, 2, { action: "journal", notes: "A deliberate entry", tags: ["test", "test"] });
    const saved = getReplayExecution(s.id);
    closeDatabaseForTests();
    expect(getReplayExecution(s.id)).toEqual(saved);
    expect(saved?.fills).toHaveLength(1);
    expect(saved?.portfolio.quoteBalance).toBeCloseTo(1797.798);
    expect(saved?.tags).toEqual(["test"]);
    expect(getReplaySession(s.id)?.cursor).toBe(120_000);
  });

  it("binds seed and every subsequent fill to the verified frozen dataset across restart", () => {
    const s = session();
    const candles = [candle(60_000), { ...candle(120_000), open: 105 }, candle(180_000)];
    const datasetId = saveDatasetSnapshot({ exchange: s.exchange, symbol: s.symbol, timeframe: s.timeframe, candles });
    expect(() => createConfiguredReplaySession({ ...s, bars: [{ ...s.bars[0]!, close: 101 }] }, instrument, config, datasetId)).toThrow(/seed/);
    expect(getReplaySession(s.id)).toBeUndefined();
    const wrongVenue = saveDatasetSnapshot({ exchange: "binance", symbol: s.symbol, timeframe: s.timeframe, candles });
    expect(() => createConfiguredReplaySession(s, instrument, config, wrongVenue)).toThrow(/instrument mismatch/);
    createConfiguredReplaySession(s, instrument, config, datasetId);
    commandReplay(s.id, 0, { action: "order", order });
    closeDatabaseForTests();
    const before = getReplayExecution(s.id);
    expect(before?.datasetId).toBe(datasetId);
    expect(nextFrozenReplayBar(s.id)).toEqual(candles[1]);
    expect(() => advanceReplaySession(s.id, s.cursor, candle(120_000), undefined, 1)).toThrow(/frozen dataset/);
    expect(getReplayExecution(s.id)).toEqual(before);
    expect(getReplaySession(s.id)).toEqual(s);
    advanceReplaySession(s.id, s.cursor, candles[1]!, undefined, 1);
    expect(getReplayExecution(s.id)?.fills[0]?.price).toBe(106.05);
    advanceReplaySession(s.id, 120_000, candles[2]!, undefined, 2);
    expect(nextFrozenReplayBar(s.id)).toBeUndefined();
    const exhausted = getReplayExecution(s.id);
    expect(() => advanceReplaySession(s.id, 180_000, candle(240_000), undefined, 3)).toThrow(/frozen dataset/);
    expect(getReplayExecution(s.id)).toEqual(exhausted);
    expect(getReplaySession(s.id)?.cursor).toBe(180_000);
  });

  it("deduplicates order retries after revision changes and rejects conflicting intent", () => {
    const s = session();
    createConfiguredReplaySession(s, instrument, config);
    commandReplay(s.id, 0, { action: "order", order });
    advanceReplaySession(s.id, s.cursor, candle(120_000), undefined, 1);
    expect(commandReplay(s.id, 0, { action: "order", order }).revision).toBe(2);
    expect(() => commandReplay(s.id, 0, { action: "order", order: { ...order, quantity: 3 } })).toThrow(/different parameters/);
    expect(getReplayExecution(s.id)?.fills).toHaveLength(1);
  });

  it("deduplicates competing cursor steps and rejects stale revisions and skipped intervals", () => {
    const s = session();
    createConfiguredReplaySession(s, instrument, config);
    commandReplay(s.id, 0, { action: "order", order });
    expect(() => advanceReplaySession(s.id, s.cursor, candle(120_000), undefined, 0)).toThrow(/revision conflict/);
    expect(() => advanceReplaySession(s.id, s.cursor, candle(180_000), undefined, 1)).toThrow(/contiguous/);
    advanceReplaySession(s.id, s.cursor, candle(120_000), undefined, 1);
    expect(advanceReplaySession(s.id, s.cursor, candle(180_000), undefined, 1).deduplicated).toBe(true);
    expect(getReplaySession(s.id)?.cursor).toBe(120_000);
    expect(getReplayExecution(s.id)?.fills).toHaveLength(1);
    expect(() => commandReplay(s.id, 1, { action: "journal", notes: "stale", tags: [] })).toThrow(/revision conflict/);
  });

  it("rolls back ledger and cursor together if the session update fails", () => {
    const s = session();
    createConfiguredReplaySession(s, instrument, config);
    commandReplay(s.id, 0, { action: "order", order });
    const before = getReplayExecution(s.id);
    getDatabase().run("CREATE TRIGGER fail_step BEFORE UPDATE OF cursor ON replay_sessions BEGIN SELECT RAISE(ABORT, 'injected rollback'); END");
    expect(() => advanceReplaySession(s.id, s.cursor, candle(120_000), undefined, 1)).toThrow(/injected rollback/);
    expect(getReplayExecution(s.id)).toEqual(before);
    expect(getReplaySession(s.id)).toEqual(s);
  });

  it("rolls back session creation if ledger insertion fails", () => {
    getDatabase().run("CREATE TRIGGER fail_create BEFORE INSERT ON replay_executions BEGIN SELECT RAISE(ABORT, 'injected create'); END");
    const s = session();
    expect(() => createConfiguredReplaySession(s, instrument, config)).toThrow(/injected create/);
    expect(getReplaySession(s.id)).toBeUndefined();
  });

  it("rejects conflicting native identity before persisting a session", () => {
    const s = session();
    for (const bad of [{ ...instrument, venue: "binance" as const }, { ...instrument, id: "kraken:spot:BTCUSD" }, { ...instrument, quote: "USDT" }]) {
      expect(() => createConfiguredReplaySession(s, bad, config)).toThrow(/instrument/);
      expect(getReplaySession(s.id)).toBeUndefined();
    }
  });

  it("cancels pending orders on finish, including through the compatible helper", () => {
    const s = session();
    createConfiguredReplaySession(s, instrument, config);
    commandReplay(s.id, 0, { action: "order", order });
    finishReplaySession(s.id);
    expect(getReplaySession(s.id)?.status).toBe("finished");
    expect(getReplayExecution(s.id)?.orders[0]?.status).toBe("cancelled");
    expect(getReplayExecution(s.id)?.fills).toEqual([]);
  });

  it("migrates an old database without inventing a new fill ledger", () => {
    const sqlite = new Database(path.join(directory, "newbeing.sqlite"));
    sqlite.exec("CREATE TABLE replay_sessions (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, start_at INTEGER NOT NULL, cursor INTEGER NOT NULL, bars TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    const old = { ...session(), exchange: "binance" as const, symbol: "BTC/USDT" };
    sqlite.prepare("INSERT INTO replay_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(old.id, old.symbol, old.timeframe, old.startAt, old.cursor, JSON.stringify(old.bars), old.status, old.createdAt, old.updatedAt);
    sqlite.close();
    expect(getReplaySession(old.id)).toEqual(old);
    expect(getReplayExecution(old.id)).toBeUndefined();
    expect(() => upgradeLegacyReplay(old, { ...instrument, venue: "binance", symbol: old.symbol })).toThrow(/new execution semantics/);
    expect(getReplayExecution(old.id)).toBeUndefined();
    closeDatabaseForTests();
    expect(getReplaySession(old.id)).toEqual(old);
  });
});

describe("persistent candle finality", () => {
  it("stores completed candles only and excludes legacy snapshots cached before close before applying limit", () => {
    vi.spyOn(Date, "now").mockReturnValue(600_000);
    saveCachedCandles("kraken", "BTC/USD", "1m", [candle(480_000), candle(600_000)]);
    expect(getDatabase().select().from(candleCache).all()).toHaveLength(1);
    getDatabase().insert(candleCache).values({ exchange: "kraken", symbol: "BTC/USD", timeframe: "1m", ...candle(420_000), cachedAt: 450_000 }).run();
    expect(getCachedCandles("kraken", "BTC/USD", "1m", 0, 1).candles).toEqual([candle(480_000)]);
    closeDatabaseForTests();
    expect(getCachedCandles("kraken", "BTC/USD", "1m", 0, 10).candles).toEqual([candle(480_000)]);
    saveCachedCandles("kraken", "BTC/USD", "1m", [candle(420_000)]);
    expect(getCachedCandles("kraken", "BTC/USD", "1m", 0, 10).candles).toHaveLength(2);
    expect(getCachedCandles("binance", "BTC/USD", "1m", 0, 10).candles).toEqual([]);
  });
});
