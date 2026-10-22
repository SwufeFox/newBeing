import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { beginPaperIntent, closeDatabaseForTests, finalizePaperFill, getDatabase, getPaperOrder, getPaperPortfolio, listPaperOrders, listPaperRecoveries, listPendingPaperOrders, paperAccountId, paperOrders, recoverPaperIntent } from "../src/index.js";

let directory = "";
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-recovery-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});
const accountId = paperAccountId("BTC/USD", "kraken");
const input = { clientOrderId: "crash-order", symbol: "BTC/USD", side: "buy" as const, quantity: 0.1 };
const action = { clientOrderId: input.clientOrderId, actionId: "recovery-action-1", reason: "Operator terminated interrupted local Paper; no external execution exists." };

function crashAt(stage: "created" | "submitted" | "wallet-write" | "committed"): void {
  const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, "../dist/index.js")).href;
  const source = `
    import * as s from ${JSON.stringify(moduleUrl)};
    const input = ${JSON.stringify(input)};
    s.beginPaperIntent(input, ${JSON.stringify(accountId)});
    if (${JSON.stringify(stage)} === 'created') process.exit(73);
    s.markPaperIntentSubmitted(input.clientOrderId);
    if (${JSON.stringify(stage)} === 'submitted') process.exit(73);
    if (${JSON.stringify(stage)} === 'wallet-write') {
      const sqlite = globalThis.__newbeing_sqlite_v1__.sqlite;
      sqlite.function('crash_after_wallet', () => process.exit(73));
      sqlite.exec("CREATE TEMP TRIGGER crash_fill BEFORE UPDATE OF status ON paper_orders WHEN NEW.status = 'filled' BEGIN SELECT crash_after_wallet(); END");
    }
    s.finalizePaperFill(input.clientOrderId, 100, ${JSON.stringify(accountId)});
    process.exit(73);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { env: { ...process.env, NEWBEING_DATA_DIR: directory }, encoding: "utf8", timeout: 15000 });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(73);
}

describe("explicit local Paper recovery after process failure", () => {
  it.each(["created", "submitted", "wallet-write"] as const)("safely terminates %s crash with persisted reason, owner and exact retry", (stage) => {
    crashAt(stage);
    const before = getPaperPortfolio(accountId);
    expect(before.quoteBalance).toBe(10000);
    expect(before.baseBalance).toBe(0);
    expect(listPendingPaperOrders()).toHaveLength(1);
    const result = recoverPaperIntent(action);
    expect(result.order.status).toBe("cancelled");
    expect(result.recovery).toMatchObject({ ...action, accountId, previousStatus: stage === "created" ? "created" : "submitted", requiresReview: false });
    expect(getPaperPortfolio(accountId)).toEqual(before);
    // A late writer cannot turn the terminated intent into a fill.
    expect(finalizePaperFill(input.clientOrderId, 777, accountId).order.status).toBe("cancelled");
    expect(getPaperPortfolio(accountId)).toEqual(before);
    closeDatabaseForTests();
    expect(recoverPaperIntent(action)).toMatchObject({ recovery: result.recovery, deduplicated: true });
    expect(listPaperRecoveries()).toHaveLength(1);
    expect(listPendingPaperOrders()).toEqual([]);
    expect(() => recoverPaperIntent({ ...action, reason: "changed" })).toThrow(/already recovered/);
  }, 30_000); // The child itself has a 15s deadline; allow startup and verification too.

  it("recognizes a committed fill after response loss without reapplying or cancelling it", () => {
    crashAt("committed");
    const before = getPaperPortfolio(accountId);
    expect(before).toMatchObject({ quoteBalance: 9989.99, baseBalance: 0.1 });
    expect(getPaperOrder(input.clientOrderId)?.status).toBe("filled");
    expect(listPendingPaperOrders()).toEqual([]);
    expect(() => recoverPaperIntent(action)).toThrow(/committed outcomes/);
    expect(finalizePaperFill(input.clientOrderId, 200, accountId).deduplicated).toBe(true);
    expect(getPaperPortfolio(accountId)).toEqual(before);
    expect(listPaperRecoveries()).toEqual([]);
  }, 30_000);

  it("preserves unknown legacy ownership and flags manual review, without creating a wallet", () => {
    getDatabase().insert(paperOrders).values({ ...input, accountId: null, status: "unknown", fillPrice: null, fee: 0, createdAt: new Date(0).toISOString() }).run();
    const result = recoverPaperIntent(action);
    expect(result.recovery).toMatchObject({ accountId: null, previousStatus: "unknown", requiresReview: true });
    expect(result.order.accountId).toBeNull();
    expect(getDatabase().all("SELECT * FROM paper_accounts")).toEqual([]);
    expect(() => finalizePaperFill(input.clientOrderId, 100)).toThrow(/Legacy\/unbound/);
  });

  it("rolls cancellation back if the audit insert fails", () => {
    beginPaperIntent(input, accountId);
    getDatabase().run("CREATE TEMP TRIGGER fail_recovery BEFORE INSERT ON paper_recoveries BEGIN SELECT RAISE(ABORT, 'audit disk failure'); END");
    expect(() => recoverPaperIntent(action)).toThrow(/audit disk failure/);
    expect(getPaperOrder(input.clientOrderId)?.status).toBe("created");
    expect(listPaperRecoveries()).toEqual([]);
    getDatabase().run("DROP TRIGGER fail_recovery");
    expect(recoverPaperIntent(action).order.status).toBe("cancelled");
  });

  it("flags contradictory legacy fill fields without changing money or destroying evidence", () => {
    beginPaperIntent(input, accountId);
    getDatabase().run("UPDATE paper_orders SET status = 'unknown', fill_price = 99, fee = 0.01");
    const before = getPaperPortfolio(accountId);
    expect(recoverPaperIntent(action)).toMatchObject({ order: { status: "cancelled", fillPrice: 99, fee: 0.01 }, recovery: { requiresReview: true, accountId } });
    expect(getPaperPortfolio(accountId)).toEqual(before);
  });

  it("keeps old pending intents visible beyond recent history and rejects action-ID reuse atomically", () => {
    beginPaperIntent(input, accountId);
    for (let index = 0; index < 105; index++) {
      const id = `noise-${index}`;
      getDatabase().insert(paperOrders).values({ ...input, clientOrderId: id, accountId, status: "rejected", fillPrice: null, fee: 0, createdAt: "2099-01-01" }).run();
    }
    expect(listPaperOrders(100).some((order) => order.clientOrderId === input.clientOrderId)).toBe(false);
    expect(listPendingPaperOrders().map((order) => order.clientOrderId)).toEqual([input.clientOrderId]);
    recoverPaperIntent(action);
    beginPaperIntent({ ...input, clientOrderId: "other-order" }, accountId);
    expect(() => recoverPaperIntent({ ...action, clientOrderId: "other-order" })).toThrow(/already used/);
    expect(getPaperOrder("other-order")?.status).toBe("created");
    expect(listPaperRecoveries()).toHaveLength(1);
    expect(() => recoverPaperIntent({ ...action, actionId: "different-action", reason: " " })).toThrow(/audit reason/);
  });
});
