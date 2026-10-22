import { eq } from "drizzle-orm";
import { createSpotAccount, reserveSpotOrder, releaseSpotOrder, settleSpotOrder, spotAccountId, type ExchangeId, type PaperOrder, type SpotAccount } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { spotAccounts } from "./schema.js";

/** Shared accounts live in a separate table/namespace. Legacy assets are never imported. */
export function getSpotAccount(exchange: ExchangeId, quote: string): SpotAccount | undefined {
  const row = getDatabase().select().from(spotAccounts).where(eq(spotAccounts.id, spotAccountId(exchange, quote))).get();
  return row ? JSON.parse(row.payload) as SpotAccount : undefined;
}
export function openSpotAccount(exchange: ExchangeId, quote: string): SpotAccount {
  const initial = createSpotAccount(exchange, quote);
  getDatabase().insert(spotAccounts).values({ id: initial.id, payload: JSON.stringify(initial) }).onConflictDoNothing().run();
  return getSpotAccount(exchange, quote)!;
}
export function mutateSpotAccount<T>(exchange: ExchangeId, quote: string, mutate: (account: SpotAccount) => T): { account: SpotAccount; result: T } {
  return getDatabase().transaction((tx) => {
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
