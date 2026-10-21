import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
// Resolve the database driver owned by storage; application has no driver dependency.
const Database = createRequire(import.meta.resolve("@newbeing/storage"))("better-sqlite3");
import { DEFAULT_WORKSPACE_STATE, type OrderPreview } from "@newbeing/core";
import type { ExchangeAdapter } from "@newbeing/market-data";
import { closeDatabaseForTests, getPaperPortfolio, getOrderPreview, listPaperOrders, paperAccountId, saveOrderPreview, saveWorkspaceState, recoverPaperIntent, listPendingPaperOrders, listPaperRecoveries } from "@newbeing/storage";
import { resolvePaperPreview } from "../src/paper.js";

let directory = "";
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-preview-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});
function prepare(): OrderPreview {
  const preview: OrderPreview = { id: "concurrent-preview", exchange: "kraken", accountId: paperAccountId("BTC/USD", "kraken"), symbol: "BTC/USD", side: "buy", quantity: 0.1, mode: "paper", referencePrice: 100, estimatedNotional: 10, estimatedFee: 0.01, status: "prepared", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), orderId: null };
  saveOrderPreview(preview);
  return preview;
}
function adapter(fetchSummary: ExchangeAdapter["fetchSummary"]): ExchangeAdapter {
  return { id: "kraken", fetchSummary } as ExchangeAdapter;
}
const summary = () => ({ symbol: "BTC/USD", last: 100, bid: 100, ask: 100, timestamp: Date.now(), changePct24h: null, high24h: null, low24h: null, quoteVolume24h: null });

describe("Paper preview confirmation", () => {
  it("binds the original venue and deduplicates overlapping confirm/dismiss while pricing outside SQLite", async () => {
    const preview = prepare();
    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, exchange: "coinbaseexchange" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchSummary = vi.fn(async () => { await gate; return summary(); });
    const adapterFor = vi.fn((venue) => { expect(venue).toBe("kraken"); return adapter(fetchSummary); });
    const first = resolvePaperPreview(preview.id, "confirm", adapterFor);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    const [repeat, dismiss] = await Promise.all([
      resolvePaperPreview(preview.id, "confirm", adapterFor),
      resolvePaperPreview(preview.id, "dismiss", adapterFor),
    ]);
    expect(repeat.order?.status).toBe("submitted");
    expect(repeat.retrySafe).toBe(false);
    expect(dismiss.preview.status).toBe("confirmed");
    // An independent writer can commit while the simulated network is suspended.
    const otherConnection = new Database(path.join(directory, "newbeing.sqlite"));
    try {
      otherConnection.pragma("busy_timeout = 0");
      expect(() => otherConnection.exec("UPDATE workspace_states SET updated_at = updated_at + 1")).not.toThrow();
    } finally { otherConnection.close(); release(); }
    const filled = await first;
    expect(filled.order?.status).toBe("filled");
    expect(getPaperPortfolio(preview.accountId!).baseBalance).toBe(0.1);
    expect(getPaperPortfolio(paperAccountId("BTC/USD", "coinbaseexchange")).baseBalance).toBe(0);
    expect(listPaperOrders(100, preview.accountId!)).toHaveLength(1);
    closeDatabaseForTests();
    const restored = await resolvePaperPreview(preview.id, "confirm", adapterFor);
    expect(restored.order).toEqual(filled.order);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    expect(adapterFor).toHaveBeenCalledTimes(1);
  });

  it.each(["quote", "failure"] as const)("fences late %s after recovery cancels an in-flight confirmed preview", async (outcome) => {
    const preview = prepare();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchSummary = vi.fn(async () => {
      await gate;
      if (outcome === "failure") throw new Error("late network failure");
      return summary();
    });
    const pending = resolvePaperPreview(preview.id, "confirm", () => adapter(fetchSummary));
    const orderId = `preview-${preview.id}`;
    expect(listPendingPaperOrders().map((order) => order.clientOrderId)).toContain(orderId);
    const before = getPaperPortfolio(preview.accountId!);
    recoverPaperIntent({ clientOrderId: orderId, actionId: "manual-cancel-action", reason: "Stop waiting for quote; operator cancelled." });
    release();
    const late = await pending;
    expect(late.order?.status).toBe("cancelled");
    expect(getPaperPortfolio(preview.accountId!)).toEqual(before);
    const retry = await resolvePaperPreview(preview.id, "confirm", () => adapter(fetchSummary));
    expect(retry.order?.status).toBe("cancelled");
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    expect(listPendingPaperOrders()).toEqual([]);
    expect(listPaperRecoveries()[0]?.accountId).toBe(preview.accountId);
  });

  it("never quotes after dismiss wins", async () => {
    const preview = prepare();
    const adapterFor = vi.fn(() => { throw new Error("must not quote"); });
    const [dismissed, confirmed] = await Promise.all([
      resolvePaperPreview(preview.id, "dismiss", adapterFor),
      resolvePaperPreview(preview.id, "confirm", adapterFor),
    ]);
    expect(dismissed.preview.status).toBe("dismissed");
    expect(confirmed.preview.status).toBe("dismissed");
    expect(confirmed.order).toBeNull();
    expect(adapterFor).not.toHaveBeenCalled();
    expect(listPaperOrders(100, preview.accountId!)).toEqual([]);
  });

  it("preserves unknown state after quote failure and never reopens on retry", async () => {
    const preview = prepare();
    const fetchSummary = vi.fn(async () => { throw new Error("network lost"); });
    const adapterFor = () => adapter(fetchSummary);
    const failed = await resolvePaperPreview(preview.id, "confirm", adapterFor);
    expect(failed.order?.status).toBe("unknown");
    expect(getOrderPreview(preview.id)?.status).toBe("confirmed");
    closeDatabaseForTests();
    const retry = await resolvePaperPreview(preview.id, "confirm", adapterFor);
    expect(retry.order?.status).toBe("unknown");
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    expect(getPaperPortfolio(preview.accountId!).baseBalance).toBe(0);
  });
});
