import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beginPaperIntent,
  advanceReplaySession,
  closeDatabaseForTests,
  createReplaySession,
  finalizePaperFill,
  getPaperOrder,
  getPaperPortfolio,
  getWorkspaceState,
  paperAccountId,
  replayAccountId,
  getReplaySession,
  markPaperIntentSubmitted,
  saveWorkspaceState,
} from "../src/index.js";
import { DEFAULT_WORKSPACE_STATE, type Candle, type ReplaySession } from "@newbeing/core";

let dataDirectory = "";

beforeEach(() => {
  closeDatabaseForTests();
  dataDirectory = mkdtempSync(path.join(tmpdir(), "newbeing-storage-"));
  process.env.NEWBEING_DATA_DIR = dataDirectory;
});

afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(dataDirectory, { recursive: true, force: true });
});

describe("SQLite repositories", () => {
  it("persists local workspace state with a monotonic server timestamp", () => {
    const first = getWorkspaceState();
    expect(first.state.symbol).toBe(DEFAULT_WORKSPACE_STATE.symbol);
    expect(first.updatedAt).toBe(0);
    const updatedAt = saveWorkspaceState({ ...first.state, symbol: "ETH/USDT" });
    const saved = getWorkspaceState();
    expect(saved.state.symbol).toBe("ETH/USDT");
    expect(saved.updatedAt).toBe(updatedAt);
  });

  it("persists intent before fill and atomically deduplicates fills", () => {
    const input = { clientOrderId: "storage-once-0001", symbol: "BTC/USDT", side: "buy" as const, quantity: 0.1 };
    const intent = beginPaperIntent(input);
    expect(intent.deduplicated).toBe(false);
    expect(intent.order.status).toBe("created");
    const submitted = markPaperIntentSubmitted(input.clientOrderId);
    expect(submitted.status).toBe("submitted");
    const repeated = beginPaperIntent(input);
    expect(repeated.deduplicated).toBe(true);
    expect(repeated.order.status).toBe("submitted");

    const firstFill = finalizePaperFill(input.clientOrderId, 50_000);
    expect(firstFill.order.status).toBe("filled");
    expect(firstFill.deduplicated).toBe(false);
    const repeatedFill = finalizePaperFill(input.clientOrderId, 50_000);
    expect(repeatedFill.deduplicated).toBe(true);
    expect(repeatedFill.portfolio).toEqual(firstFill.portfolio);
    expect(repeatedFill.portfolio.baseBalance).toBe(0.1);
    expect(repeatedFill.portfolio.quoteBalance).toBe(4_995);
    expect(getPaperOrder(input.clientOrderId)?.status).toBe("filled");
  });

  it("rejects reusing a client ID with different parameters and isolates wallets by base asset", () => {
    const input = { clientOrderId: "storage-once-0002", symbol: "BTC/USDT", side: "buy" as const, quantity: 0.1 };
    beginPaperIntent(input);
    expect(() => beginPaperIntent({ ...input, quantity: 0.2 })).toThrow(/different order parameters/);
    expect(getPaperPortfolio("paper:binance-spot:ETH:USDT").quoteBalance).toBe(10_000);
    expect(() => paperAccountId("BTC/USDC")).toThrow(/USDT-quoted/);
  });

  it("persists only the replay cursor and atomically releases one next bar", () => {
    const candle = (timestamp: number, close: number): Candle => ({ timestamp, open: close, high: close, low: close, close, volume: 1 });
    const session: ReplaySession = {
      id: "replay-session-1234",
      symbol: "BTC/USDT",
      timeframe: "1m",
      startAt: 120_000,
      cursor: 60_000,
      bars: [candle(0, 100), candle(60_000, 101)],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    createReplaySession(session);
    const first = advanceReplaySession(session.id, 60_000, candle(120_000, 102));
    expect(first.deduplicated).toBe(false);
    expect(first.session.cursor).toBe(120_000);
    expect(first.session.bars.map((bar) => bar.timestamp)).toEqual([0, 60_000, 120_000]);
    const retry = advanceReplaySession(session.id, 60_000, candle(180_000, 103));
    expect(retry.deduplicated).toBe(true);
    expect(retry.session.cursor).toBe(120_000);
    expect(retry.session.bars).toHaveLength(3);
    expect(getReplaySession(session.id)?.cursor).toBe(120_000);
  });

  it("keeps replay Paper wallets separate from the normal simulator", () => {
    const replayId = replayAccountId("session-12345678", "BTC/USDT");
    const paperId = paperAccountId("BTC/USDT");
    expect(replayId).not.toBe(paperId);
    expect(getPaperPortfolio(replayId).quoteBalance).toBe(10_000);
    expect(getPaperPortfolio(paperId).quoteBalance).toBe(10_000);
  });
});
