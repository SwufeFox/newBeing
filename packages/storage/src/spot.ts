import { eq } from "drizzle-orm";
import { createSpotAccount, reserveSpotOrder, releaseSpotOrder, settleSpotOrder, spotAccountId, type ExchangeId, type PaperOrder, type SpotAccount } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { spotAccounts } from "./schema.js";
import { getWorkspaceState } from "./workspace.js";

/** Shared accounts live in a separate table/namespace. Legacy assets are never imported. */
export function getSpotAccount(exchange: ExchangeId, quote: string): SpotAccount | undefined {
  const row = getDatabase().select().from(spotAccounts).where(eq(spotAccounts.id, spotAccountId(exchange, quote))).get();
  return row ? JSON.parse(row.payload) as SpotAccount : undefined;
}
export class SpotReplayBlockedError extends Error {
  constructor() {
    super("Normal Paper operations are disabled during Replay.");
    this.name = "SpotReplayBlockedError";
  }
}

export function assertSpotPaperMutationAllowed(): void {
  if (getWorkspaceState().state.activeWorkspace === "replay") throw new SpotReplayBlockedError();
}

export function openSpotAccount(exchange: ExchangeId, quote: string): SpotAccount {
  const initial = createSpotAccount(exchange, quote);
  return getDatabase().transaction((tx) => {
    assertSpotPaperMutationAllowed();
    tx.insert(spotAccounts).values({ id: initial.id, payload: JSON.stringify(initial) }).onConflictDoNothing().run();
    return getSpotAccount(exchange, quote)!;
  }, { behavior: "immediate" });
}
function mutateSpotAccount<T>(exchange: ExchangeId, quote: string, mutate: (account: SpotAccount) => T, allowDuringReplay = false): { account: SpotAccount; result: T } {
  return getDatabase().transaction((tx) => {
    if (!allowDuringReplay) assertSpotPaperMutationAllowed();
    const account = getSpotAccount(exchange, quote);
    if (!account) throw new Error("Shared spot account not found; explicitly open a new account first.");
    const result = mutate(account);
    tx.update(spotAccounts).set({ payload: JSON.stringify(account) }).where(eq(spotAccounts.id, account.id)).run();
    return { account, result };
  }, { behavior: "immediate" });
}
export function beginSpotIntent(exchange: ExchangeId, quote: string, input: Pick<PaperOrder, "clientOrderId" | "symbol" | "side" | "quantity">, maximumPrice: number) {
  return mutateSpotAccount(exchange, quote, (account) => {
    const deduplicated = account.orders.some((order) => order.clientOrderId === input.clientOrderId);
    const order = reserveSpotOrder(account, input, maximumPrice);
    return { order, deduplicated };
  });
}
export function finalizeSpotIntent(exchange: ExchangeId, quote: string, orderId: string, price: number) {
  return mutateSpotAccount(exchange, quote, (account) => settleSpotOrder(account, orderId, price));
}
export function cancelSpotIntent(exchange: ExchangeId, quote: string, orderId: string) {
  return mutateSpotAccount(exchange, quote, (account) => releaseSpotOrder(account, orderId, "cancelled"));
}
/** Status-only reconciliation remains available if Replay starts during a quote request. */
export function markSpotIntentUnknown(exchange: ExchangeId, quote: string, orderId: string) {
  return mutateSpotAccount(exchange, quote, (account) => {
    const order = account.orders.find((item) => item.clientOrderId === orderId);
    if (!order) throw new Error("Spot order not found.");
    if (order.status === "submitted") order.status = "unknown";
    return order;
  }, true);
}
