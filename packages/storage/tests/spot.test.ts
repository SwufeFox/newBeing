import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beginSpotIntent, cancelSpotIntent, closeDatabaseForTests, finalizeSpotIntent, getDatabase, getSpotAccount, mutateSpotAccount, openSpotAccount } from "../src/index.js";

let directory: string;
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-spot-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});
const buy = (clientOrderId: string, symbol = "BTC/USDT", quantity = 1) => ({ clientOrderId, symbol, side: "buy" as const, quantity });

describe("shared spot wallet transactions", () => {
  it("requires explicit creation, seeds once across restarts and isolates venues and quotes", () => {
    expect(() => beginSpotIntent("binance", "USDT", buy("missing"), 100)).toThrow(/explicitly open/);
    const original = openSpotAccount("binance", "USDT");
    beginSpotIntent("binance", "USDT", buy("entry"), 100);
    finalizeSpotIntent("binance", "USDT", "entry", 100);
    closeDatabaseForTests();
    const reopened = openSpotAccount("binance", "USDT");
    expect(reopened.balances.USDT!.total).toBe(9899.9);
    expect(reopened.ledger.filter((entry) => entry.reason === "initial-capital")).toEqual(original.ledger);
    expect(openSpotAccount("kraken", "USDT").balances.USDT!.total).toBe(10000);
    expect(openSpotAccount("binance", "USD").balances.USD!.total).toBe(10000);
  });

  it("shares available quote across symbols without sharing base inventory, with reconcilable ledger", () => {
    openSpotAccount("binance", "USDT");
    beginSpotIntent("binance", "USDT", buy("btc", "BTC/USDT", 60), 100);
    expect(() => beginSpotIntent("binance", "USDT", buy("eth-too-much", "ETH/USDT", 40), 100)).toThrow(/available/);
    beginSpotIntent("binance", "USDT", buy("eth", "ETH/USDT", 30), 100);
    finalizeSpotIntent("binance", "USDT", "eth", 90);
    finalizeSpotIntent("binance", "USDT", "btc", 100);
    expect(() => beginSpotIntent("binance", "USDT", { ...buy("oversell", "ETH/USDT", 31), side: "sell" }, 100)).toThrow(/available/);
    beginSpotIntent("binance", "USDT", { ...buy("sell", "ETH/USDT", 30), side: "sell" }, 100);
    finalizeSpotIntent("binance", "USDT", "sell", 100);
    const account = getSpotAccount("binance", "USDT")!;
    expect(account.balances.BTC).toEqual({ total: 60, reserved: 0 });
    expect(account.balances.ETH).toEqual({ total: 0, reserved: 0 });
    expect(account.positions["BTC/USDT"]!.costBasis).toBe(6006);
    expect(account.positions["ETH/USDT"]!.realizedPnl).toBe(294.3);
    for (const [asset, balance] of Object.entries(account.balances)) {
      expect(account.ledger.filter((entry) => entry.asset === asset).reduce((sum, entry) => sum + entry.delta, 0)).toBeCloseTo(balance.total, 8);
      expect(balance.reserved).toBe(0);
    }
    expect(new Set(account.ledger.map((entry) => entry.id)).size).toBe(account.ledger.length);
  });

  it("deduplicates all intent parameters and releases each reservation only once", () => {
    openSpotAccount("binance", "USDT");
    beginSpotIntent("binance", "USDT", buy("once"), 100);
    expect(beginSpotIntent("binance", "USDT", buy("once"), 100).result.deduplicated).toBe(true);
    expect(() => beginSpotIntent("binance", "USDT", buy("once"), 101)).toThrow(/different parameters/);
    cancelSpotIntent("binance", "USDT", "once");
    cancelSpotIntent("binance", "USDT", "once");
    finalizeSpotIntent("binance", "USDT", "once", 90);
    expect(getSpotAccount("binance", "USDT")!.balances.USDT).toEqual({ total: 10000, reserved: 0 });
    expect(getSpotAccount("binance", "USDT")!.fills).toEqual([]);
    beginSpotIntent("binance", "USDT", buy("filled"), 100);
    finalizeSpotIntent("binance", "USDT", "filled", 100);
    finalizeSpotIntent("binance", "USDT", "filled", 99);
    cancelSpotIntent("binance", "USDT", "filled");
    expect(getSpotAccount("binance", "USDT")!.fills).toHaveLength(1);
  });

  it("retains unknown reservations across restart until explicit cancellation and rejects price overruns", () => {
    openSpotAccount("binance", "USDT");
    beginSpotIntent("binance", "USDT", buy("unknown"), 100);
    mutateSpotAccount("binance", "USDT", (account) => { account.orders[0]!.status = "unknown"; });
    closeDatabaseForTests();
    expect(getSpotAccount("binance", "USDT")!.balances.USDT!.reserved).toBe(100.1);
    finalizeSpotIntent("binance", "USDT", "unknown", 90);
    expect(getSpotAccount("binance", "USDT")!.fills).toEqual([]);
    cancelSpotIntent("binance", "USDT", "unknown");
    beginSpotIntent("binance", "USDT", buy("overrun"), 100);
    expect(finalizeSpotIntent("binance", "USDT", "overrun", 101).result.status).toBe("rejected");
    expect(getSpotAccount("binance", "USDT")!.balances.USDT).toEqual({ total: 10000, reserved: 0 });
  });

  it("releases a deterministic settlement rejection without consuming other reservations", () => {
    openSpotAccount("binance", "USDT");
    beginSpotIntent("binance", "USDT", buy("dust"), 100);
    beginSpotIntent("binance", "USDT", buy("other", "ETH/USDT", 90), 100);
    expect(finalizeSpotIntent("binance", "USDT", "dust", 1e-12).result.status).toBe("rejected");
    expect(getSpotAccount("binance", "USDT")!.balances.USDT).toEqual({ total: 10000, reserved: 9009 });
    finalizeSpotIntent("binance", "USDT", "other", 100);
    finalizeSpotIntent("binance", "USDT", "dust", 100);
    const account = getSpotAccount("binance", "USDT")!;
    expect(account.balances.USDT).toEqual({ total: 991, reserved: 0 });
    expect(account.fills.map((fill) => fill.orderId)).toEqual(["other"]);
  });

  it("serializes competing inventory reservations and cancels only the selected sell", () => {
    openSpotAccount("binance", "USDT");
    beginSpotIntent("binance", "USDT", buy("inventory", "BTC/USDT", 3), 100);
    finalizeSpotIntent("binance", "USDT", "inventory", 100);
    const sell = (clientOrderId: string, quantity: number) => ({ ...buy(clientOrderId, "BTC/USDT", quantity), side: "sell" as const });
    beginSpotIntent("binance", "USDT", sell("first", 2), 100);
    expect(() => beginSpotIntent("binance", "USDT", sell("oversell", 2), 100)).toThrow(/available/);
    beginSpotIntent("binance", "USDT", sell("second", 1), 100);
    cancelSpotIntent("binance", "USDT", "first");
    finalizeSpotIntent("binance", "USDT", "second", 90);
    finalizeSpotIntent("binance", "USDT", "first", 100);
    const account = getSpotAccount("binance", "USDT")!;
    expect(account.balances.BTC).toEqual({ total: 2, reserved: 0 });
    expect(account.balances.USDT).toEqual({ total: 9789.61, reserved: 0 });
    expect(account.positions["BTC/USDT"]).toEqual({ costBasis: 200.2, realizedPnl: -10.19 });
    expect(account.fills).toHaveLength(2);
  });

  it("rolls back balances, fills and ledger together on persistence failure", () => {
    openSpotAccount("binance", "USDT");
    beginSpotIntent("binance", "USDT", buy("rollback"), 100);
    const before = getSpotAccount("binance", "USDT");
    getDatabase().run("CREATE TRIGGER fail_spot BEFORE UPDATE ON spot_accounts BEGIN SELECT RAISE(ABORT, 'spot rollback'); END");
    expect(() => finalizeSpotIntent("binance", "USDT", "rollback", 100)).toThrow(/spot rollback/);
    expect(getSpotAccount("binance", "USDT")).toEqual(before);
  });
});
