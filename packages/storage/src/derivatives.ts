import { sql } from "drizzle-orm";
import { getDatabase } from "./db.js";
import { getWorkspaceState } from "./workspace.js";

export type DerivativesStoredOrder = { clientOrderId: string; instrumentId: string };
export type DerivativesStoredAccount = { id: string; orders: DerivativesStoredOrder[]; orderCount: number };
type AccountState<T extends DerivativesStoredAccount> = Omit<T, "orders" | "orderCount">;
type PayloadRow = { payload: string };
export const DERIVATIVES_ORDER_PAGE_SIZE = 20;
export class DerivativesOrderPageError extends Error {}

export function assertDerivativesPaperWorkspace(): void {
  if (getWorkspaceState().state.activeWorkspace === "replay") throw new Error("Derivatives Paper is disabled during Replay.");
}
export function derivativesAccountId(venue: string, settle: string): string {
  return `derivatives:${encodeURIComponent(venue)}:${encodeURIComponent(settle)}`;
}
function parseState<T extends DerivativesStoredAccount>(id: string, payload: string): AccountState<T> {
  const state: unknown = JSON.parse(payload);
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Invalid derivatives account state.");
  const record = state as Record<string, unknown>;
  if (record.id !== id || Object.hasOwn(record, "orders") || Object.hasOwn(record, "orderCount")) throw new Error("Invalid derivatives account identity or legacy orders in persisted state.");
  return state as AccountState<T>;
}
function validateLimit(limit?: number): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw new Error("Order limit must be a positive integer.");
}
function readState<T extends DerivativesStoredAccount>(id: string): AccountState<T> | undefined {
  const row = getDatabase().get<PayloadRow>(sql`SELECT payload FROM derivatives_accounts WHERE id = ${id}`);
  return row ? parseState<T>(id, row.payload) : undefined;
}
function snapshot<T extends DerivativesStoredAccount>(id: string, state: AccountState<T>, limit?: number): T {
  const db = getDatabase();
  const count = db.get<{ count: number }>(sql`SELECT COALESCE(MAX(sequence), 0) AS count FROM derivatives_orders WHERE account_id = ${id}`)!.count;
  const rows = limit === undefined
    ? db.all<PayloadRow>(sql`SELECT payload FROM derivatives_orders WHERE account_id = ${id} ORDER BY sequence`)
    : db.all<PayloadRow>(sql`SELECT payload FROM (SELECT sequence, payload FROM derivatives_orders WHERE account_id = ${id} ORDER BY sequence DESC LIMIT ${limit}) ORDER BY sequence`);
  return { ...state, orders: rows.map((row) => JSON.parse(row.payload)), orderCount: count } as T;
}
export function listDerivativesAccountRows<T extends DerivativesStoredAccount>(orderLimit?: number): T[] {
  validateLimit(orderLimit);
  return getDatabase().transaction(() => {
    const rows = getDatabase().all<{ id: string; payload: string }>(sql`SELECT id, payload FROM derivatives_accounts ORDER BY id`);
    return rows.map((row) => snapshot<T>(row.id, parseState<T>(row.id, row.payload), orderLimit));
  });
}
export function getDerivativesAccountRow<T extends DerivativesStoredAccount>(id: string, orderLimit?: number): T | undefined {
  validateLimit(orderLimit);
  return getDatabase().transaction(() => {
    const state = readState<T>(id);
    return state ? snapshot<T>(id, state, orderLimit) : undefined;
  });
}
export function getDerivativesAccountState<T extends DerivativesStoredAccount>(id: string): AccountState<T> | undefined {
  return readState<T>(id);
}
export function getDerivativesOrderRow<O extends DerivativesStoredOrder>(accountId: string, clientOrderId: string): O | undefined {
  const row = getDatabase().get<PayloadRow>(sql`SELECT payload FROM derivatives_orders WHERE account_id = ${accountId} AND client_order_id = ${clientOrderId}`);
  readState<DerivativesStoredAccount>(accountId);
  return row ? JSON.parse(row.payload) as O : undefined;
}
/** Read one newest-first page using the account-local ledger sequence as cursor. */
export function listDerivativesOrderPage<O extends DerivativesStoredOrder>(accountId: string, before?: string): { orders: O[]; hasMore: boolean } {
  return getDatabase().transaction(() => {
    if (!readState<DerivativesStoredAccount>(accountId)) throw new DerivativesOrderPageError("Derivatives account not found.");
    let sequence: number | undefined;
    if (before !== undefined) {
      if (typeof before !== "string" || !before.trim() || before.length > 128) throw new DerivativesOrderPageError("Invalid derivatives order cursor.");
      const cursor = getDatabase().get<{ sequence: number }>(sql`SELECT sequence FROM derivatives_orders WHERE account_id = ${accountId} AND client_order_id = ${before}`);
      if (!cursor) throw new DerivativesOrderPageError("Invalid derivatives order cursor for account.");
      sequence = cursor.sequence;
    }
    const limit = DERIVATIVES_ORDER_PAGE_SIZE + 1;
    const rows = sequence === undefined
      ? getDatabase().all<PayloadRow>(sql`SELECT payload FROM derivatives_orders WHERE account_id = ${accountId} ORDER BY sequence DESC LIMIT ${limit}`)
      : getDatabase().all<PayloadRow>(sql`SELECT payload FROM derivatives_orders WHERE account_id = ${accountId} AND sequence < ${sequence} ORDER BY sequence DESC LIMIT ${limit}`);
    return { orders: rows.slice(0, DERIVATIVES_ORDER_PAGE_SIZE).map((row) => JSON.parse(row.payload) as O), hasMore: rows.length > DERIVATIVES_ORDER_PAGE_SIZE };
  });
}
export function findDerivativesOrderRows<O extends DerivativesStoredOrder>(clientOrderId: string, instrumentId: string): Array<{ accountId: string; order: O }> {
  return getDatabase().all<{ accountId: string; payload: string; state: string }>(sql`SELECT o.account_id AS accountId, o.payload, a.payload AS state FROM derivatives_orders o JOIN derivatives_accounts a ON a.id = o.account_id WHERE o.client_order_id = ${clientOrderId} AND o.instrument_id = ${instrumentId} ORDER BY o.account_id`).map((row) => {
    parseState<DerivativesStoredAccount>(row.accountId, row.state);
    return { accountId: row.accountId, order: JSON.parse(row.payload) as O };
  });
}
export function openDerivativesAccountRow<T extends DerivativesStoredAccount>(initial: T, orderLimit?: number): T {
  validateLimit(orderLimit);
  return getDatabase().transaction(() => {
    assertDerivativesPaperWorkspace();
    const { orders, orderCount, ...state } = initial;
    if (!Array.isArray(orders) || orders.length !== 0 || orderCount !== 0) throw new Error("New derivatives accounts must have empty order history.");
    getDatabase().run(sql`INSERT INTO derivatives_accounts (id, payload) VALUES (${initial.id}, ${JSON.stringify(state)}) ON CONFLICT(id) DO NOTHING`);
    return snapshot<T>(initial.id, readState<T>(initial.id)!, orderLimit);
  }, { behavior: "immediate" });
}
/** Account state and an optional new order commit as one synchronous transaction. */
export function mutateDerivativesAccountRow<T extends DerivativesStoredAccount, O extends DerivativesStoredOrder, R>(id: string, clientOrderId: string, mutate: (state: AccountState<T>, existing: O | undefined) => { result: R; order?: O }, orderLimit?: number): { account: T; result: R } {
  validateLimit(orderLimit);
  return getDatabase().transaction(() => {
    assertDerivativesPaperWorkspace();
    const state = readState<T>(id);
    if (!state) throw new Error("Explicitly open a derivatives Paper account first.");
    const existing = getDerivativesOrderRow<O>(id, clientOrderId);
    const outcome = mutate(state, existing);
    if (outcome && (typeof outcome === "object" || typeof outcome === "function") && "then" in outcome) throw new Error("Derivatives transactions require synchronous mutations.");
    assertDerivativesPaperWorkspace();
    if (state.id !== id || Object.hasOwn(state, "orders") || Object.hasOwn(state, "orderCount")) throw new Error("Account identity or order history cannot change in state.");
    if (outcome.order) {
      if (existing) throw new Error("Cannot append an existing client order ID.");
      if (outcome.order.clientOrderId !== clientOrderId || !clientOrderId.trim() || typeof outcome.order.instrumentId !== "string" || !outcome.order.instrumentId.trim()) throw new Error("Invalid derivatives order identity.");
    }
    const db = getDatabase();
    db.run(sql`UPDATE derivatives_accounts SET payload = ${JSON.stringify(state)} WHERE id = ${id}`);
    if (outcome.order) {
      const count = db.get<{ count: number }>(sql`SELECT COALESCE(MAX(sequence), 0) AS count FROM derivatives_orders WHERE account_id = ${id}`)!.count;
      db.run(sql`INSERT INTO derivatives_orders (account_id, sequence, client_order_id, instrument_id, payload) VALUES (${id}, ${count + 1}, ${clientOrderId}, ${outcome.order.instrumentId}, ${JSON.stringify(outcome.order)})`);
    }
    return { account: snapshot<T>(id, state, orderLimit), result: outcome.result };
  }, { behavior: "immediate" });
}
