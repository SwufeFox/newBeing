import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beginPaperIntent,
  closeDatabaseForTests,
  getDatabase,
  listOrderPreviews,
  listPendingPaperOrders,
  markPaperIntentSubmitted,
  paperAccountId,
  saveOrderPreview,
} from "../src/index.js";
import { sql } from "drizzle-orm";
import type { OrderPreview } from "@newbeing/core";

let dataDirectory = "";

beforeEach(() => {
  closeDatabaseForTests();
  dataDirectory = mkdtempSync(path.join(tmpdir(), "newbeing-storage-indexes-"));
  process.env.NEWBEING_DATA_DIR = dataDirectory;
});

afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(dataDirectory, { recursive: true, force: true });
});

function previewFixture(id: string, symbol: string, createdAt: string): OrderPreview {
  const exchange = "binance" as const;
  return {
    id,
    exchange,
    accountId: paperAccountId(symbol, exchange),
    symbol,
    side: "buy",
    quantity: 0.1,
    mode: "paper",
    referencePrice: 50_000,
    estimatedNotional: 5_000,
    estimatedFee: 1,
    status: "prepared",
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + 60_000).toISOString(),
    orderId: null,
  };
}

describe("query indexes", () => {
  it("creates the paper_orders status index and the order_previews symbol index", () => {
    const names = getDatabase()
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .map((row) => row.name);
    expect(names).toContain("paper_orders_status_idx");
    expect(names).toContain("order_previews_symbol_idx");
    expect(names).toContain("saved_sweeps_created_at_idx");
  });

  it("plans pending-order lookups through paper_orders_status_idx", () => {
    const plan = getDatabase()
      .all<{ detail: string }>(
        sql`EXPLAIN QUERY PLAN SELECT client_order_id FROM paper_orders WHERE status IN ('created','submitted','unknown') ORDER BY created_at`,
      )
      .map((row) => row.detail);
    expect(plan.some((detail) => detail.includes("paper_orders_status_idx"))).toBe(true);
  });

  it("plans symbol-filtered preview lookups through order_previews_symbol_idx", () => {
    const plan = getDatabase()
      .all<{ detail: string }>(
        sql`EXPLAIN QUERY PLAN SELECT id FROM order_previews WHERE symbol = 'BTC/USDT' ORDER BY created_at DESC LIMIT 20`,
      )
      .map((row) => row.detail);
    expect(plan.some((detail) => detail.includes("order_previews_symbol_idx"))).toBe(true);
  });

  it("keeps pending orders and preview listings returning seeded rows", () => {
    const inputs = [
      { clientOrderId: "index-pending-0001", symbol: "BTC/USDT", side: "buy" as const, quantity: 0.1 },
      { clientOrderId: "index-pending-0002", symbol: "ETH/USDT", side: "buy" as const, quantity: 0.2 },
      { clientOrderId: "index-pending-0003", symbol: "BTC/USDT", side: "sell" as const, quantity: 0.05 },
    ];
    for (const input of inputs) beginPaperIntent(input);
    markPaperIntentSubmitted("index-pending-0002");

    const pending = listPendingPaperOrders();
    expect(pending.map((order) => order.clientOrderId)).toEqual([
      "index-pending-0001",
      "index-pending-0002",
      "index-pending-0003",
    ]);
    expect(pending.map((order) => order.status)).toEqual(["created", "submitted", "created"]);

    saveOrderPreview(previewFixture("index-preview-0001", "BTC/USDT", "2026-01-01T00:00:00.000Z"));
    saveOrderPreview(previewFixture("index-preview-0002", "BTC/USDT", "2026-01-02T00:00:00.000Z"));
    saveOrderPreview(previewFixture("index-preview-0003", "ETH/USDT", "2026-01-03T00:00:00.000Z"));

    const btcPreviews = listOrderPreviews("BTC/USDT");
    expect(btcPreviews.map((preview) => preview.id)).toEqual(["index-preview-0002", "index-preview-0001"]);
    expect(listOrderPreviews("ETH/USDT").map((preview) => preview.id)).toEqual(["index-preview-0003"]);
  });
});
