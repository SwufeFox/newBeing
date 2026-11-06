import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDatabaseForTests, getDatabase, getWorkspaceState, saveWorkspaceState } from "../src/index.js";
import { DERIVATIVES_ORDER_PAGE_SIZE, derivativesAccountId, findDerivativesOrderRows, getDerivativesAccountRow, getDerivativesAccountState, getDerivativesOrderRow, listDerivativesAccountRows, listDerivativesOrderPage, mutateDerivativesAccountRow, openDerivativesAccountRow } from "../src/derivatives.js";

let directory: string;
const previousDirectory = process.env.NEWBEING_DATA_DIR;
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-derivatives-storage-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  if (previousDirectory === undefined) delete process.env.NEWBEING_DATA_DIR; else process.env.NEWBEING_DATA_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
});
type Order = { clientOrderId: string; instrumentId: string; fee: string };
type Account = { id: string; available: string; orders: Order[]; orderCount: number };
const initial = (): Account => ({ id: derivativesAccountId("okx", "USDT"), available: "100.123456789123456789", orders: [], orderCount: 0 });
const order = (clientOrderId: string, instrumentId = "instrument"): Order => ({ clientOrderId, instrumentId, fee: "0.000000000000000001" });
function append(id: string, item: Order, limit?: number) {
  return mutateDerivativesAccountRow<Account, Order, string>(id, item.clientOrderId, (state) => {
    state.available = "0.000000000000000001";
    return { result: item.clientOrderId, order: item };
  }, limit);
}
function legacy(payloads: Array<{ id: string; payload: string }>, trigger = false): void {
  const db = new Database(path.join(directory, "newbeing.sqlite"));
  db.exec("CREATE TABLE derivatives_accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO derivatives_accounts VALUES (?, ?)");
  for (const row of payloads) insert.run(row.id, row.payload);
  if (trigger) db.exec("CREATE TRIGGER fail_migration BEFORE UPDATE ON derivatives_accounts BEGIN SELECT RAISE(ABORT, 'migration failure'); END");
  db.close();
}

describe("derivatives indexed ledger", () => {
  it("migrates legacy orders in sequence and reopens without changing balances or duplicating history", () => {
    const account = initial();
    const orders = [order("first"), order("second"), order("third", "other")];
    legacy([{ id: account.id, payload: JSON.stringify({ ...account, orders, orderCount: undefined }) }]);
    expect(getDerivativesAccountRow<Account>(account.id)).toEqual({ ...account, orders, orderCount: 3 });
    expect(getDerivativesAccountRow<Account>(account.id, 2)).toEqual({ ...account, orders: orders.slice(1), orderCount: 3 });
    expect(getDerivativesAccountState<Account>(account.id)).toEqual({ id: account.id, available: account.available });
    closeDatabaseForTests();
    expect(openDerivativesAccountRow(account, 1)).toEqual({ ...account, orders: orders.slice(-1), orderCount: 3 });
    expect(getDerivativesOrderRow<Order>(account.id, "first")).toEqual(orders[0]);
    expect(findDerivativesOrderRows<Order>("first", "instrument")).toEqual([{ accountId: account.id, order: orders[0] }]);
    expect(findDerivativesOrderRows<Order>("first", "other")).toEqual([]);
  });
  it.each<[string, (id: string) => unknown]>([
    ["duplicate order", (id: string) => ({ id, orders: [order("x"), order("x")] })],
    ["missing instrument", (id: string) => ({ id, orders: [{ clientOrderId: "x" }] })],
    ["empty order id", (id: string) => ({ id, orders: [order(" ")] })],
    ["invalid orders", (id: string) => ({ id, orders: null })],
    ["wrong account identity", (_id: string) => ({ id: "wrong", orders: [] })],
  ])("rolls back the entire migration for %s", (_name, invalid) => {
    const id = initial().id;
    const rows = [{ id: "valid", payload: JSON.stringify({ id: "valid", orders: [order("valid")] }) }, { id, payload: JSON.stringify(invalid(id)) }];
    legacy(rows);
    expect(() => getDatabase()).toThrow();
    const db = new Database(path.join(directory, "newbeing.sqlite"));
    try {
      expect(db.prepare("SELECT id, payload FROM derivatives_accounts ORDER BY id").all()).toEqual([...rows].sort((a, b) => a.id.localeCompare(b.id)));
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'derivatives_orders'").get()).toBeUndefined();
    } finally { db.close(); }
  });
  it("rolls back a migration when an update fails", () => {
    const id = initial().id;
    const payload = JSON.stringify({ id, orders: [order("first")] });
    legacy([{ id, payload }], true);
    expect(() => getDatabase()).toThrow(/migration failure/);
    const db = new Database(path.join(directory, "newbeing.sqlite"));
    try {
      expect(db.prepare("SELECT payload FROM derivatives_accounts WHERE id = ?").get(id)).toEqual({ payload });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'derivatives_orders'").get()).toBeUndefined();
    } finally { db.close(); }
  });
  it("returns bounded snapshots and looks up old orders independently of the limit", () => {
    const account = initial();
    openDerivativesAccountRow(account);
    for (const item of [order("one"), order("two"), order("three")]) append(account.id, item, 1);
    expect(getDerivativesAccountRow<Account>(account.id, 2)).toMatchObject({ orders: [order("two"), order("three")], orderCount: 3 });
    expect(listDerivativesAccountRows<Account>(1)[0]).toMatchObject({ orders: [order("three")], orderCount: 3 });
    expect(getDerivativesOrderRow<Order>(account.id, "one")).toEqual(order("one"));
    expect(getDerivativesAccountRow<Account>(account.id)?.orders).toEqual([order("one"), order("two"), order("three")]);
  });
  it.each([0, 1, 19, 20, 21, 40, 41])("traverses all %i orders across page boundaries", (count) => {
    const account = initial();
    openDerivativesAccountRow(account);
    const items = Array.from({ length: count }, (_, index) => order(`order-${index}`));
    for (const item of items) append(account.id, item);
    const collected: Order[] = [];
    let before: string | undefined;
    do {
      const page = listDerivativesOrderPage<Order>(account.id, before);
      expect(page.orders.length).toBeLessThanOrEqual(DERIVATIVES_ORDER_PAGE_SIZE);
      collected.push(...page.orders);
      expect(page.hasMore).toBe(collected.length < count);
      before = page.hasMore ? page.orders[page.orders.length - 1]!.clientOrderId : undefined;
    } while (before !== undefined);
    expect(collected).toEqual(items.reverse());
  });
  it("keeps the cursor stable across appends and validates account ownership", () => {
    const account = initial();
    const other = { ...initial(), id: derivativesAccountId("deribit", "USDT") };
    openDerivativesAccountRow(account);
    openDerivativesAccountRow(other);
    for (let index = 0; index < 21; index++) append(account.id, order(`order-${index}`));
    append(other.id, order("other"));
    const first = listDerivativesOrderPage<Order>(account.id);
    expect(first.hasMore).toBe(true);
    append(account.id, order("new-fill"));
    expect(listDerivativesOrderPage<Order>(account.id, first.orders[19]!.clientOrderId)).toEqual({ orders: [order("order-0")], hasMore: false });
    expect(listDerivativesOrderPage<Order>(other.id)).toEqual({ orders: [order("other")], hasMore: false });
    expect(() => listDerivativesOrderPage(account.id, "other")).toThrow(/cursor/i);
    expect(() => listDerivativesOrderPage(account.id, "missing")).toThrow(/cursor/i);
    expect(() => listDerivativesOrderPage(account.id, "")).toThrow(/cursor/i);
    expect(() => listDerivativesOrderPage("missing-account")).toThrow(/account/i);
  });
  it.each(["INSERT ON derivatives_orders", "UPDATE ON derivatives_accounts"])("rolls back state and history on failed %s", (operation) => {
    const account = initial();
    openDerivativesAccountRow(account);
    getDatabase().run(`CREATE TRIGGER fail_write BEFORE ${operation} BEGIN SELECT RAISE(ABORT, 'write failure'); END`);
    expect(() => append(account.id, order("bad"))).toThrow();
    expect(getDerivativesAccountRow<Account>(account.id)).toEqual(account);
  });
  it("rejects async callbacks, identity changes, mismatched orders and duplicates", () => {
    const account = initial();
    openDerivativesAccountRow(account);
    expect(() => mutateDerivativesAccountRow<Account, Order, void>(account.id, "x", (async () => ({ result: undefined })) as never)).toThrow(/synchronous/);
    expect(() => mutateDerivativesAccountRow<Account, Order, void>(account.id, "x", (state) => { state.id = "other"; return { result: undefined }; })).toThrow(/identity/);
    expect(() => mutateDerivativesAccountRow<Account, Order, void>(account.id, "x", () => ({ result: undefined, order: order("y") }))).toThrow(/identity/);
    append(account.id, order("x"));
    expect(() => append(account.id, order("x"))).toThrow(/existing/);
    expect(getDerivativesAccountRow<Account>(account.id)?.orderCount).toBe(1);
  });
  it("fences Replay before and after the callback", () => {
    const account = initial();
    openDerivativesAccountRow(account);
    const workspace = getWorkspaceState().state;
    expect(() => mutateDerivativesAccountRow<Account, Order, void>(account.id, "x", (state) => {
      state.available = "0";
      saveWorkspaceState({ ...workspace, activeWorkspace: "replay" });
      return { result: undefined, order: order("x") };
    })).toThrow(/Replay/);
    expect(getDerivativesAccountRow<Account>(account.id)).toEqual(account);
    saveWorkspaceState({ ...workspace, activeWorkspace: "replay" });
    expect(() => append(account.id, order("x"))).toThrow(/Replay/);
    expect(() => openDerivativesAccountRow({ ...account, id: "other" })).toThrow(/Replay/);
  });
  it("fails closed when an old writer restores embedded orders", () => {
    const account = initial();
    openDerivativesAccountRow(account);
    getDatabase().run(`UPDATE derivatives_accounts SET payload = '${JSON.stringify(account)}'`);
    expect(() => getDerivativesAccountRow<Account>(account.id)).toThrow(/legacy orders/);
    expect(() => append(account.id, order("x"))).toThrow(/legacy orders/);
    expect(() => openDerivativesAccountRow(account)).toThrow(/legacy orders/);
  });
  it("holds the write lock throughout the mutation", () => {
    const account = initial();
    openDerivativesAccountRow(account);
    const competing = new Database(path.join(directory, "newbeing.sqlite"), { timeout: 0 });
    try {
      mutateDerivativesAccountRow<Account, Order, void>(account.id, "x", () => {
        expect(() => competing.prepare("UPDATE derivatives_accounts SET payload = payload").run()).toThrow(/locked/);
        return { result: undefined };
      });
      expect(() => competing.prepare("UPDATE derivatives_accounts SET payload = payload").run()).not.toThrow();
    } finally { competing.close(); }
  });
});
