import { eq } from "drizzle-orm";
import type { ExchangeId, PaperPortfolio } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { paperAccounts } from "./schema.js";
import { getWorkspaceState } from "./workspace.js";

/** Venues a stored row may legitimately name. A row holding anything else is
 *  treated as legacy rather than trusted, so a corrupt value cannot send a
 *  request to an adapter that does not exist. */
export const EXCHANGE_IDS: readonly ExchangeId[] = ["binance", "coinbaseexchange", "okx", "kraken"];

/* Account ids are namespaced per venue. The Binance namespace is deliberately
   spelled exactly as it always was ("binance-spot") so the ids of accounts that
   already hold balances keep resolving — renaming them would orphan real paper
   positions rather than migrate them. */
const PAPER_NAMESPACE: Record<ExchangeId, string> = {
  binance: "binance-spot",
  coinbaseexchange: "coinbase-spot",
  okx: "okx-spot",
  kraken: "kraken-spot",
};

export const PAPER_ACCOUNT_ID = "paper:binance-spot:USDT";

export function paperAccountId(symbol: string, exchange: ExchangeId = "binance"): string {
  const [base, quote, extra] = symbol.toUpperCase().split("/");
  if (!base || !quote || extra !== undefined || !/^[A-Z0-9]{2,20}$/.test(base) || !/^[A-Z0-9]{2,20}$/.test(quote)) {
    throw new Error("Paper trading needs a BASE/QUOTE symbol, for example BTC/USDT.");
  }
  return `paper:${PAPER_NAMESPACE[exchange]}:${base}:${quote}`;
}

/** Seed for a newly created Paper wallet. Never merged into an existing row. */
export const INITIAL_PAPER_PORTFOLIO: PaperPortfolio = { quoteBalance: 10_000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: 0.001 };

export function getPaperPortfolio(accountId = PAPER_ACCOUNT_ID): PaperPortfolio {
  const db = getDatabase();
  /* The Positions dock polls this every eight seconds and more than one surface
     reads it. An existing wallet must be served without taking SQLite's write
     lock, so the account is created only when it is genuinely missing. */
  const read = () => db.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
  const existing = read();
  if (existing) return portfolioFromRow(existing);
  db.insert(paperAccounts).values({ id: accountId, ...INITIAL_PAPER_PORTFOLIO, updatedAt: Date.now() }).onConflictDoNothing().run();
  const created = read();
  if (!created) throw new Error("Paper account could not be initialized.");
  return portfolioFromRow(created);
}

export function portfolioFromRow(row: typeof paperAccounts.$inferSelect): PaperPortfolio {
  return {
    quoteBalance: row.quoteBalance,
    baseBalance: row.baseBalance,
    averageEntryPrice: row.averageEntryPrice,
    ...(row.costBasis === null ? {} : { costBasis: row.costBasis }),
    realizedPnl: row.realizedPnl,
    feeRate: row.feeRate,
  };
}

export class PaperReplayBlockedError extends Error {
  constructor() {
    super("Normal Paper operations are disabled during Replay.");
    this.name = "PaperReplayBlockedError";
  }
}

export function assertPaperMutationAllowed(accountId: string | null | undefined): void {
  if (!accountId?.startsWith("paper:replay:") && getWorkspaceState().state.activeWorkspace === "replay") {
    throw new PaperReplayBlockedError();
  }
}
