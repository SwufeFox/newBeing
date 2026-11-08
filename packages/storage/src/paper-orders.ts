import { and, asc, desc, eq, sql } from "drizzle-orm";
import { LedgerValidationError, fillPaperOrder, quantityUnits, type PaperOrder, type PaperPortfolio } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { paperAccounts, paperOrders, paperRecoveries } from "./schema.js";
import { INITIAL_PAPER_PORTFOLIO, assertPaperMutationAllowed, paperAccountId, portfolioFromRow } from "./paper.js";
import { getWorkspaceState } from "./workspace.js";

function paperOrderFromRow(row: typeof paperOrders.$inferSelect): PaperOrder | undefined {
  if (row.side !== "buy" && row.side !== "sell") return undefined;
  if (!( ["created", "submitted", "filled", "rejected", "cancelled", "unknown"] as string[]).includes(row.status)) return undefined;
  return {
    clientOrderId: row.clientOrderId,
    accountId: row.accountId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    status: row.status as PaperOrder["status"],
    fillPrice: row.fillPrice,
    fee: row.fee,
    createdAt: row.createdAt,
  };
}

export interface BeginPaperIntentResult {
  order: PaperOrder;
  portfolio: PaperPortfolio;
  deduplicated: boolean;
}

export function beginPaperIntent(input: Pick<PaperOrder, "clientOrderId" | "symbol" | "side" | "quantity">, accountId = paperAccountId(input.symbol)): BeginPaperIntentResult {
  quantityUnits(input.quantity);
  if (input.quantity <= 0 || !["buy", "sell"].includes(input.side)) throw new Error("Invalid paper order.");
  const db = getDatabase();
  return db.transaction((tx) => {
    const existingRow = tx.select().from(paperOrders).where(eq(paperOrders.clientOrderId, input.clientOrderId)).get();
    if (existingRow) {
      const existing = paperOrderFromRow(existingRow);
      if (!existing) throw new Error("Stored paper order state is invalid.");
      if (existingRow.accountId !== accountId || existing.symbol !== input.symbol || existing.side !== input.side || existing.quantity !== input.quantity) {
        throw new Error("Client order ID was already used with different order parameters.");
      }
      const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
      if (!accountRow) throw new Error("Paper account could not be read.");
      return { order: existing, portfolio: portfolioFromRow(accountRow), deduplicated: true };
    }
    assertPaperMutationAllowed(accountId);
    tx.insert(paperAccounts).values({ id: accountId, ...INITIAL_PAPER_PORTFOLIO, updatedAt: Date.now() }).onConflictDoNothing().run();
    const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
    if (!accountRow) throw new Error("Paper account could not be initialized.");
    const order: PaperOrder = { ...input, status: "created", fillPrice: null, fee: 0, createdAt: new Date().toISOString() };
    tx.insert(paperOrders).values({ ...order, accountId }).run();
    return { order: { ...order, accountId }, portfolio: portfolioFromRow(accountRow), deduplicated: false };
  }, { behavior: "immediate" });
}

export function markPaperIntentSubmitted(clientOrderId: string): PaperOrder {
  return getDatabase().transaction((tx) => {
    const row = tx.select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
    const order = row ? paperOrderFromRow(row) : undefined;
    if (!row || !order) throw new Error("Paper order intent could not be submitted.");
    if (order.status !== "created") return order;
    assertPaperMutationAllowed(row.accountId);
    tx.update(paperOrders).set({ status: "submitted" })
      .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "created"))).run();
    return { ...order, status: "submitted" };
  }, { behavior: "immediate" });
}

export function markPaperIntentUnknown(clientOrderId: string): PaperOrder {
  const db = getDatabase();
  db.update(paperOrders).set({ status: "unknown" })
    .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
  const row = db.select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
  const order = row ? paperOrderFromRow(row) : undefined;
  if (!order) throw new Error("Paper order could not be reconciled.");
  return order;
}

export interface PaperFillResult {
  order: PaperOrder;
  portfolio: PaperPortfolio;
  deduplicated: boolean;
  error?: string;
}

export function finalizePaperFill(clientOrderId: string, fillPrice: number, accountId?: string): PaperFillResult {
  const db = getDatabase();
  return db.transaction((tx) => {
    const orderRow = tx.select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
    const order = orderRow ? paperOrderFromRow(orderRow) : undefined;
    if (!order) throw new Error("Paper order intent not found.");
    if (!orderRow?.accountId) throw new Error("Legacy/unbound order cannot be finalized without proven ownership.");
    if (accountId !== undefined && accountId !== orderRow.accountId) throw new Error("Paper order account mismatch.");
    const resolvedAccountId = orderRow.accountId;
    const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, resolvedAccountId)).get();
    if (!accountRow) throw new Error("Paper account not found.");
    const portfolio = portfolioFromRow(accountRow);
    if (order.status !== "submitted") return { order, portfolio, deduplicated: true };
    // Serialize the workspace check with both Replay activation and wallet writes.
    // Replay-owned accounts retain their existing execution behavior.
    if (!resolvedAccountId.startsWith("paper:replay:") && getWorkspaceState().state.activeWorkspace === "replay") {
      tx.update(paperOrders).set({ status: "unknown" })
        .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
      return { order: { ...order, status: "unknown" }, portfolio, deduplicated: false, error: "Paper fill is disabled during Replay." };
    }
    try {
      const fill = fillPaperOrder(order, portfolio, fillPrice);
      tx.update(paperAccounts).set({ ...fill.portfolio, updatedAt: Date.now() }).where(eq(paperAccounts.id, resolvedAccountId)).run();
      tx.update(paperOrders).set({ status: "filled", fillPrice: fill.order.fillPrice, fee: fill.order.fee })
        .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
      return { order: fill.order, portfolio: fill.portfolio, deduplicated: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Paper fill rejected.";
      if (error instanceof LedgerValidationError || message.startsWith("Insufficient paper")) {
        tx.update(paperOrders).set({ status: "rejected" })
          .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
        return { order: { ...order, status: "rejected" }, portfolio, deduplicated: false, error: message };
      }
      throw error;
    }
  }, { behavior: "immediate" });
}

export type PaperRecovery = typeof paperRecoveries.$inferSelect;
export interface RecoverPaperIntentInput {
  clientOrderId: string;
  actionId: string;
  reason: string;
}

/** Pending is independent of the capped recent history, including unbound legacy rows. */
export function listPendingPaperOrders(): PaperOrder[] {
  return getDatabase().select().from(paperOrders)
    .where(sql`${paperOrders.status} IN ('created', 'submitted', 'unknown')`)
    .orderBy(asc(paperOrders.createdAt)).all().flatMap((row) => {
      const order = paperOrderFromRow(row);
      return order ? [order] : [];
    });
}

export function hasPendingPaperOrders(accountId: string): boolean {
  return getDatabase().select({ clientOrderId: paperOrders.clientOrderId }).from(paperOrders)
    .where(and(sql`${paperOrders.status} IN ('created', 'submitted', 'unknown')`, eq(paperOrders.accountId, accountId)))
    .limit(1).get() !== undefined;
}

export function listPaperRecoveries(): PaperRecovery[] {
  return getDatabase().select().from(paperRecoveries).orderBy(desc(paperRecoveries.createdAt)).all();
}

/** Local Paper has no external fill: never price or mutate a wallet during recovery.
 * This transaction serializes with finalize; cancellation fences a delayed quote.
 * Missing legacy ownership is preserved, never guessed from current workspace.
 */
export function recoverPaperIntent(input: RecoverPaperIntentInput): { order: PaperOrder; recovery: PaperRecovery; deduplicated: boolean } {
  if (!/^[A-Za-z0-9-]{8,100}$/.test(input.actionId) || !input.reason.trim() || input.reason.length > 2000) throw new Error("Recovery needs an action ID and an audit reason (1–2000 characters).");
  return getDatabase().transaction((tx) => {
    const row = tx.select().from(paperOrders).where(eq(paperOrders.clientOrderId, input.clientOrderId)).get();
    const order = row ? paperOrderFromRow(row) : undefined;
    if (!row || !order) throw new Error("Paper order intent not found.");
    const previous = tx.select().from(paperRecoveries).where(eq(paperRecoveries.clientOrderId, input.clientOrderId)).get();
    if (previous) {
      if (previous.actionId !== input.actionId || previous.reason !== input.reason) throw new Error("Order already recovered; reload its saved audit record.");
      return { order, recovery: previous, deduplicated: true };
    }
    if (tx.select().from(paperRecoveries).where(eq(paperRecoveries.actionId, input.actionId)).get()) throw new Error("Recovery action ID already used for another order.");
    if (!["created", "submitted", "unknown"].includes(order.status)) throw new Error("Only pending Paper intents can be recovered; committed outcomes are final.");
    const accountExists = row.accountId ? tx.select().from(paperAccounts).where(eq(paperAccounts.id, row.accountId)).get() : undefined;
    const requiresReview = !accountExists || row.fillPrice !== null || row.fee !== 0;
    const recovery: PaperRecovery = {
      clientOrderId: order.clientOrderId, actionId: input.actionId, accountId: row.accountId,
      previousStatus: order.status, outcome: "cancelled", reason: input.reason, requiresReview,
      createdAt: new Date().toISOString(),
    };
    tx.update(paperOrders).set({ status: "cancelled" }).where(and(eq(paperOrders.clientOrderId, order.clientOrderId), eq(paperOrders.status, order.status))).run();
    tx.insert(paperRecoveries).values(recovery).run();
    return { order: { ...order, status: "cancelled" as const }, recovery, deduplicated: false };
  }, { behavior: "immediate" });
}

export function getPaperOrder(clientOrderId: string): PaperOrder | undefined {
  const row = getDatabase().select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
  return row ? paperOrderFromRow(row) : undefined;
}

export function listPaperOrders(limit = 50, accountId?: string): PaperOrder[] {
  return getDatabase().select().from(paperOrders).where(accountId === undefined ? undefined : eq(paperOrders.accountId, accountId)).orderBy(desc(paperOrders.createdAt))
    .limit(Math.max(1, Math.min(100, limit))).all()
    .flatMap((row) => {
      const order = paperOrderFromRow(row);
      return order ? [order] : [];
    });
}
