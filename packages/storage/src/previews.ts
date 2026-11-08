import { and, desc, eq } from "drizzle-orm";
import { quantityUnits, type ExchangeId, type OrderPreview, type PaperOrder } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { orderPreviews } from "./schema.js";
import { EXCHANGE_IDS, assertPaperMutationAllowed, paperAccountId } from "./paper.js";
import { beginPaperIntent, getPaperOrder, markPaperIntentSubmitted } from "./paper-orders.js";

function asOrderPreview(row: typeof orderPreviews.$inferSelect): OrderPreview | undefined {
  if (row.side !== "buy" && row.side !== "sell") return undefined;
  if (row.mode !== "paper" || !(["prepared", "confirmed", "dismissed", "expired"] as string[]).includes(row.status)) return undefined;
  return {
    id: row.id,
    accountId: row.accountId,
    exchange: EXCHANGE_IDS.includes(row.exchange as ExchangeId) ? row.exchange as ExchangeId : null,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    mode: "paper",
    referencePrice: row.referencePrice,
    estimatedNotional: row.estimatedNotional,
    estimatedFee: row.estimatedFee,
    status: row.status as OrderPreview["status"],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    orderId: row.orderId,
  };
}

export function saveOrderPreview(preview: OrderPreview): void {
  quantityUnits(preview.quantity);
  if (!preview.exchange || preview.accountId !== paperAccountId(preview.symbol, preview.exchange)) throw new Error("New previews require a proven venue/account binding.");
  getDatabase().transaction((tx) => {
    assertPaperMutationAllowed(preview.accountId);
    tx.insert(orderPreviews).values({ ...preview }).run();
  }, { behavior: "immediate" });
}

export function getOrderPreview(id: string): OrderPreview | undefined {
  const row = getDatabase().select().from(orderPreviews).where(eq(orderPreviews.id, id)).get();
  return row ? asOrderPreview(row) : undefined;
}

export function listOrderPreviews(symbol?: string, limit = 20, accountId?: string): OrderPreview[] {
  const rows = getDatabase().select().from(orderPreviews).where(and(symbol === undefined ? undefined : eq(orderPreviews.symbol, symbol), accountId === undefined ? undefined : eq(orderPreviews.accountId, accountId))).orderBy(desc(orderPreviews.createdAt))
    .limit(Math.max(1, Math.min(50, limit))).all();
  const now = Date.now();
  return rows.flatMap((row) => {
    const preview = asOrderPreview(row);
    if (!preview || (symbol && preview.symbol !== symbol)) return [];
    if (preview.status === "prepared" && Date.parse(preview.expiresAt) <= now) {
      getDatabase().update(orderPreviews).set({ status: "expired" })
        .where(and(eq(orderPreviews.id, preview.id), eq(orderPreviews.status, "prepared"))).run();
      return [getOrderPreview(preview.id)!];
    }
    return [preview];
  });
}

export interface PreviewClaim {
  preview: OrderPreview;
  claimed: boolean;
  order?: PaperOrder | undefined;
}

/** The winning action and its submitted intent commit before any quote request. */
export function claimOrderPreview(id: string, action: "confirm" | "dismiss", now = Date.now()): PreviewClaim {
  return getDatabase().transaction((tx) => {
    const preview = getOrderPreview(id);
    if (!preview) throw new Error("Order preview not found.");
    if (preview.status !== "prepared") {
      return { preview, claimed: false, order: preview.orderId ? getPaperOrder(preview.orderId) : undefined };
    }
    assertPaperMutationAllowed(preview.accountId);
    const expiresAt = Date.parse(preview.expiresAt);
    const status = !Number.isFinite(expiresAt) || expiresAt <= now ? "expired" : action === "dismiss" ? "dismissed" : "confirmed";
    if (status !== "confirmed") {
      tx.update(orderPreviews).set({ status }).where(and(eq(orderPreviews.id, id), eq(orderPreviews.status, "prepared"))).run();
      return { preview: { ...preview, status }, claimed: false };
    }
    if (!preview.exchange || preview.accountId !== paperAccountId(preview.symbol, preview.exchange)) throw new Error("Legacy/unbound preview cannot be confirmed; prepare a new preview.");
    const orderId = `preview-${preview.id}`;
    const intent = beginPaperIntent({ clientOrderId: orderId, symbol: preview.symbol, side: preview.side, quantity: preview.quantity }, preview.accountId);
    if (intent.deduplicated) throw new Error("Preview order ID already exists without a matching confirmation.");
    const order = markPaperIntentSubmitted(orderId);
    tx.update(orderPreviews).set({ status, orderId }).where(and(eq(orderPreviews.id, id), eq(orderPreviews.status, "prepared"))).run();
    return { preview: { ...preview, status, orderId }, claimed: true, order };
  }, { behavior: "immediate" });
}
