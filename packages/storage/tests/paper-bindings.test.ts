import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getDatabase, migrateDatabase } from "../src/db.js";
import { paperOrders, orderPreviews } from "../src/schema.js";
import { beginPaperIntent, claimOrderPreview, closeDatabaseForTests, finalizePaperFill, getOrderPreview, getPaperPortfolio, listPaperOrders, listOrderPreviews, markPaperIntentSubmitted, paperAccountId, saveOrderPreview } from "../src/index.js";
import type { OrderPreview } from "@newbeing/core";

let directory = "";
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-bindings-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});
function preview(id = "binding-preview"): OrderPreview {
  return { id, exchange: "kraken", accountId: paperAccountId("BTC/USD", "kraken"), symbol: "BTC/USD", side: "buy", quantity: 0.1, mode: "paper", referencePrice: 100, estimatedNotional: 10, estimatedFee: 0.01, status: "prepared", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), orderId: null };
}

describe("atomic Paper account binding", () => {
  it("rejects cross-account client IDs and finalization even on deduplicated fills", () => {
    const a = paperAccountId("BTC/USD", "kraken");
    const b = paperAccountId("BTC/USD", "coinbaseexchange");
    const input = { clientOrderId: "bound-order", symbol: "BTC/USD", side: "buy" as const, quantity: 0.1 };
    beginPaperIntent(input, a);
    getPaperPortfolio(b);
    expect(() => beginPaperIntent(input, b)).toThrow(/different order parameters/);
    markPaperIntentSubmitted(input.clientOrderId);
    expect(() => finalizePaperFill(input.clientOrderId, 100, b)).toThrow(/account mismatch/);
    expect(finalizePaperFill(input.clientOrderId, 100).portfolio.baseBalance).toBe(0.1);
    expect(() => finalizePaperFill(input.clientOrderId, 100, b)).toThrow(/account mismatch/);
    expect(getPaperPortfolio(b).baseBalance).toBe(0);
    closeDatabaseForTests();
    expect(finalizePaperFill(input.clientOrderId, 100).deduplicated).toBe(true);
  });

  it("filters account and symbol before limits", () => {
    const target = preview("old-target");
    saveOrderPreview(target);
    const input = { clientOrderId: "old-order", symbol: "BTC/USD", side: "buy" as const, quantity: 0.1 };
    beginPaperIntent(input, target.accountId!);
    for (let index = 0; index < 110; index++) {
      const other = { ...preview(`other-${index}`), exchange: "binance" as const, accountId: paperAccountId("ETH/USDT"), symbol: "ETH/USDT", createdAt: new Date(Date.now() + index + 100).toISOString() };
      saveOrderPreview(other);
      beginPaperIntent({ ...input, clientOrderId: `noise-${index}`, symbol: "ETH/USDT" }, other.accountId);
    }
    expect(listPaperOrders(1, target.accountId!)).toHaveLength(1);
    expect(listPaperOrders(1, target.accountId!)[0]?.clientOrderId).toBe("old-order");
    expect(listOrderPreviews(target.symbol, 1, target.accountId!)[0]?.id).toBe(target.id);
  });

  it("allows only the first confirm/dismiss and keeps expiry closed", () => {
    saveOrderPreview(preview());
    const confirmed = claimOrderPreview("binding-preview", "confirm");
    expect(confirmed.claimed).toBe(true);
    expect(confirmed.order).toMatchObject({ status: "submitted", accountId: preview().accountId });
    expect(claimOrderPreview("binding-preview", "confirm").claimed).toBe(false);
    expect(claimOrderPreview("binding-preview", "dismiss").preview.status).toBe("confirmed");
    saveOrderPreview(preview("dismiss-first"));
    expect(claimOrderPreview("dismiss-first", "dismiss").preview.status).toBe("dismissed");
    expect(claimOrderPreview("dismiss-first", "confirm").claimed).toBe(false);
    saveOrderPreview({ ...preview("expired"), expiresAt: new Date(0).toISOString() });
    expect(claimOrderPreview("expired", "confirm").preview.status).toBe("expired");
  });

  it("rolls back a confirmation if order creation fails", () => {
    const p = preview();
    saveOrderPreview(p);
    beginPaperIntent({ clientOrderId: `preview-${p.id}`, symbol: p.symbol, side: p.side, quantity: p.quantity }, p.accountId!);
    expect(() => claimOrderPreview(p.id, "confirm")).toThrow(/already exists/);
    expect(getOrderPreview(p.id)?.status).toBe("prepared");
  });

  it("keeps legacy records unbound and refuses to attribute or execute them", () => {
    const p = preview();
    getDatabase().insert(orderPreviews).values({ ...p, accountId: null, exchange: null }).run();
    getDatabase().insert(paperOrders).values({ clientOrderId: "old-unbound", symbol: p.symbol, side: p.side, quantity: p.quantity, status: "submitted", fee: 0, createdAt: p.createdAt }).run();
    closeDatabaseForTests();
    expect(getOrderPreview(p.id)?.accountId).toBeNull();
    expect(listOrderPreviews(p.symbol, 20, p.accountId!)).toEqual([]);
    expect(listPaperOrders(20, p.accountId!)).toEqual([]);
    expect(() => claimOrderPreview(p.id, "confirm")).toThrow(/Legacy\/unbound/);
    expect(() => finalizePaperFill("old-unbound", 100, p.accountId!)).toThrow(/Legacy\/unbound/);
    expect(claimOrderPreview(p.id, "dismiss").preview.status).toBe("dismissed");
  });
});

describe("startup migrations", () => {
  it("rolls back all preceding DDL on a late failure and can retry idempotently", () => {
    const sqlite = new Database(":memory:");
    try {
      // The missing created_at makes the final account-history index fail, after ALTERs.
      sqlite.exec("CREATE TABLE paper_orders (client_order_id TEXT PRIMARY KEY); CREATE TABLE paper_accounts (id TEXT PRIMARY KEY)");
      expect(() => migrateDatabase(sqlite)).toThrow();
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'candle_cache'").all()).toEqual([]);
      expect((sqlite.pragma("table_info(paper_accounts)") as Array<{ name: string }>).map((c) => c.name)).toEqual(["id"]);
      expect((sqlite.pragma("table_info(paper_orders)") as Array<{ name: string }>).map((c) => c.name)).toEqual(["client_order_id"]);
      sqlite.exec("ALTER TABLE paper_orders ADD COLUMN created_at TEXT");
      migrateDatabase(sqlite);
      migrateDatabase(sqlite);
      expect((sqlite.pragma("table_info(paper_orders)") as Array<{ name: string }>).filter((c) => c.name === "account_id")).toHaveLength(1);
    } finally { sqlite.close(); }
  });
});
