import { eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { getDatabase } from "./db.js";
import { getWorkspaceState } from "./repositories.js";

/** Independent namespace: no legacy spot balances or Replay executions are imported. */
export const derivativesAccounts = sqliteTable("derivatives_accounts", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
});

/** Additive, idempotent migration, including databases created before derivatives. */
export function migrateDerivativesStorage(): void {
  getDatabase().run("CREATE TABLE IF NOT EXISTS derivatives_accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
}
export function assertDerivativesPaperWorkspace(): void {
  if (getWorkspaceState().state.activeWorkspace === "replay") throw new Error("Derivatives Paper is disabled during Replay.");
}
export function derivativesAccountId(venue: string, settle: string): string {
  return `derivatives:${encodeURIComponent(venue)}:${encodeURIComponent(settle)}`;
}
export function listDerivativesAccountRows<T>(): T[] {
  migrateDerivativesStorage();
  return getDatabase().select().from(derivativesAccounts).all().map((row) => JSON.parse(row.payload) as T);
}
export function getDerivativesAccountRow<T extends { id: string }>(id: string): T | undefined {
  migrateDerivativesStorage();
  const row = getDatabase().select().from(derivativesAccounts).where(eq(derivativesAccounts.id, id)).get();
  return row ? JSON.parse(row.payload) as T : undefined;
}
export function openDerivativesAccountRow<T extends { id: string }>(initial: T): T {
  migrateDerivativesStorage();
  return getDatabase().transaction((tx) => {
    assertDerivativesPaperWorkspace();
    tx.insert(derivativesAccounts).values({ id: initial.id, payload: JSON.stringify(initial) }).onConflictDoNothing().run();
    return getDerivativesAccountRow<T>(initial.id)!;
  }, { behavior: "immediate" });
}
/** Callback must be synchronous; state and its idempotency ledger commit together. */
export function mutateDerivativesAccountRow<T extends { id: string }, R>(id: string, mutate: (account: T) => R): { account: T; result: R } {
  migrateDerivativesStorage();
  return getDatabase().transaction((tx) => {
    assertDerivativesPaperWorkspace();
    const account = getDerivativesAccountRow<T>(id);
    if (!account) throw new Error("Explicitly open a derivatives Paper account first.");
    const result = mutate(account);
    if (result && typeof result === "object" && "then" in result) throw new Error("Derivatives transactions require synchronous mutations.");
    assertDerivativesPaperWorkspace();
    if (account.id !== id) throw new Error("Account identity cannot change.");
    tx.update(derivativesAccounts).set({ payload: JSON.stringify(account) }).where(eq(derivativesAccounts.id, id)).run();
    return { account, result };
  }, { behavior: "immediate" });
}
