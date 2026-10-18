import { and, desc, eq } from "drizzle-orm";
import { DEFAULT_WORKSPACE_STATE, fillPaperOrder, type BacktestResult, type Candle, type ExchangeId, type OrderPreview, type PaperOrder, type PaperPortfolio, type ReplaySession, type StrategyParameters, type Timeframe, type WorkspaceState } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { experiments, orderPreviews, paperAccounts, paperOrders, replaySessions, strategies, workspaceStates } from "./schema.js";

/** Venues a stored row may legitimately name. A row holding anything else is
 *  treated as legacy rather than trusted, so a corrupt value cannot send a
 *  request to an adapter that does not exist. */
const EXCHANGE_IDS: readonly ExchangeId[] = ["binance", "coinbaseexchange", "okx", "kraken"];

export interface StoredStrategy {
  id: string;
  name: string;
  version: string;
  description: string;
  parameters: StrategyParameters;
  source: string;
  updatedAt: number;
}

export function getWorkspaceState(): { state: WorkspaceState; updatedAt: number } {
  const row = getDatabase().select().from(workspaceStates).where(eq(workspaceStates.id, 1)).get();
  if (!row) return { state: DEFAULT_WORKSPACE_STATE, updatedAt: 0 };
  try {
    /* Read the stored value as a plain string: the typed union no longer admits
       "backtest", and that is exactly the legacy value we must detect. */
    const raw = JSON.parse(row.payload) as Record<string, unknown>;
    /* A row written before the Backtest workspace was absorbed still names it.
       Normalising on READ (rather than only on write) means the API never
       returns a workspace the UI cannot render, even before the next save. */
    const activeWorkspace = raw.activeWorkspace === "backtest" ? "research" : raw.activeWorkspace;
    return {
      state: {
        ...DEFAULT_WORKSPACE_STATE,
        ...(raw as Partial<WorkspaceState>),
        activeWorkspace: activeWorkspace as WorkspaceState["activeWorkspace"],
      },
      updatedAt: row.updatedAt,
    };
  } catch {
    return { state: DEFAULT_WORKSPACE_STATE, updatedAt: row.updatedAt };
  }
}

export function saveWorkspaceState(state: WorkspaceState): number {
  const updatedAt = Date.now();
  getDatabase().insert(workspaceStates).values({ id: 1, payload: JSON.stringify(state), updatedAt })
    .onConflictDoUpdate({ target: workspaceStates.id, set: { payload: JSON.stringify(state), updatedAt } }).run();
  return updatedAt;
}

export function listStoredStrategies(): StoredStrategy[] {
  return getDatabase().select().from(strategies).orderBy(desc(strategies.updatedAt)).all().map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    parameters: JSON.parse(row.parameters) as StrategyParameters,
    source: row.source,
    updatedAt: row.updatedAt,
  }));
}

export function getStoredStrategy(id: string): StoredStrategy | undefined {
  const row = getDatabase().select().from(strategies).where(eq(strategies.id, id)).get();
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    parameters: JSON.parse(row.parameters) as StrategyParameters,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

export function saveStrategy(strategy: Omit<StoredStrategy, "updatedAt">): StoredStrategy {
  const updatedAt = Date.now();
  const row = { ...strategy, parameters: JSON.stringify(strategy.parameters), updatedAt };
  getDatabase().insert(strategies).values(row).onConflictDoUpdate({
    target: strategies.id,
    set: {
      name: strategy.name,
      version: strategy.version,
      description: strategy.description,
      parameters: JSON.stringify(strategy.parameters),
      source: strategy.source,
      updatedAt,
    },
  }).run();
  return { ...strategy, updatedAt };
}

export function saveExperiment(result: BacktestResult): void {
  getDatabase().insert(experiments).values({
    resultId: result.resultId,
    datasetId: result.datasetId,
    symbol: result.symbol,
    timeframe: result.timeframe,
    strategyId: result.strategyId,
    strategyVersion: result.strategyVersion,
    assumptions: JSON.stringify(result.assumptions),
    result: JSON.stringify(result),
    createdAt: Date.parse(result.createdAt),
  }).run();
}

export function getExperiment(resultId: string): BacktestResult | undefined {
  const row = getDatabase().select({ result: experiments.result }).from(experiments)
    .where(eq(experiments.resultId, resultId)).get();
  if (!row) return undefined;
  return JSON.parse(row.result) as BacktestResult;
}

export function listExperiments(limit = 20): BacktestResult[] {
  return getDatabase().select({ result: experiments.result }).from(experiments)
    .orderBy(desc(experiments.createdAt)).limit(Math.max(1, Math.min(100, limit))).all()
    .map((row) => JSON.parse(row.result) as BacktestResult);
}

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

export function replayAccountId(sessionId: string, symbol: string, exchange: ExchangeId = "binance"): string {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) throw new Error("Invalid replay session ID.");
  const parts = paperAccountId(symbol, exchange).split(":");
  const base = parts[2];
  const quote = parts[3];
  if (!base || !quote) throw new Error("Invalid replay symbol.");
  return `paper:replay:${sessionId}:${base}:${quote}`;
}

export function getPaperPortfolio(accountId = PAPER_ACCOUNT_ID): PaperPortfolio {
  const db = getDatabase();
  const initial: PaperPortfolio = { quoteBalance: 10_000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: 0.001 };
  db.insert(paperAccounts).values({ id: accountId, ...initial, updatedAt: Date.now() }).onConflictDoNothing().run();
  const row = db.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
  if (!row) throw new Error("Paper account could not be initialized.");
  return portfolioFromRow(row);
}

function portfolioFromRow(row: typeof paperAccounts.$inferSelect): PaperPortfolio {
  return {
    quoteBalance: row.quoteBalance,
    baseBalance: row.baseBalance,
    averageEntryPrice: row.averageEntryPrice,
    realizedPnl: row.realizedPnl,
    feeRate: row.feeRate,
  };
}

function paperOrderFromRow(row: typeof paperOrders.$inferSelect): PaperOrder | undefined {
  if (row.side !== "buy" && row.side !== "sell") return undefined;
  if (!( ["created", "submitted", "filled", "rejected", "cancelled", "unknown"] as string[]).includes(row.status)) return undefined;
  return {
    clientOrderId: row.clientOrderId,
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
  const db = getDatabase();
  return db.transaction((tx) => {
    const existingRow = tx.select().from(paperOrders).where(eq(paperOrders.clientOrderId, input.clientOrderId)).get();
    if (existingRow) {
      const existing = paperOrderFromRow(existingRow);
      if (!existing) throw new Error("Stored paper order state is invalid.");
      if (existing.symbol !== input.symbol || existing.side !== input.side || existing.quantity !== input.quantity) {
        throw new Error("Client order ID was already used with different order parameters.");
      }
      const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
      if (!accountRow) throw new Error("Paper account could not be read.");
      return { order: existing, portfolio: portfolioFromRow(accountRow), deduplicated: true };
    }
    const initial: PaperPortfolio = { quoteBalance: 10_000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: 0.001 };
    tx.insert(paperAccounts).values({ id: accountId, ...initial, updatedAt: Date.now() }).onConflictDoNothing().run();
    const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).get();
    if (!accountRow) throw new Error("Paper account could not be initialized.");
    const order: PaperOrder = { ...input, status: "created", fillPrice: null, fee: 0, createdAt: new Date().toISOString() };
    tx.insert(paperOrders).values({ ...order }).run();
    return { order, portfolio: portfolioFromRow(accountRow), deduplicated: false };
  });
}

export function markPaperIntentSubmitted(clientOrderId: string): PaperOrder {
  const db = getDatabase();
  db.update(paperOrders).set({ status: "submitted" })
    .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "created"))).run();
  const row = db.select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
  const order = row ? paperOrderFromRow(row) : undefined;
  if (!order) throw new Error("Paper order intent could not be submitted.");
  return order;
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
    const resolvedAccountId = accountId ?? paperAccountId(order.symbol);
    const accountRow = tx.select().from(paperAccounts).where(eq(paperAccounts.id, resolvedAccountId)).get();
    if (!accountRow) throw new Error("Paper account not found.");
    const portfolio = portfolioFromRow(accountRow);
    if (order.status !== "submitted") return { order, portfolio, deduplicated: true };
    try {
      const fill = fillPaperOrder(order, portfolio, fillPrice);
      tx.update(paperAccounts).set({ ...fill.portfolio, updatedAt: Date.now() }).where(eq(paperAccounts.id, resolvedAccountId)).run();
      tx.update(paperOrders).set({ status: "filled", fillPrice: fill.order.fillPrice, fee: fill.order.fee })
        .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
      return { order: fill.order, portfolio: fill.portfolio, deduplicated: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Paper fill rejected.";
      if (message.startsWith("Insufficient paper")) {
        tx.update(paperOrders).set({ status: "rejected" })
          .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.status, "submitted"))).run();
        return { order: { ...order, status: "rejected" }, portfolio, deduplicated: false, error: message };
      }
      throw error;
    }
  });
}

export function getPaperOrder(clientOrderId: string): PaperOrder | undefined {
  const row = getDatabase().select().from(paperOrders).where(eq(paperOrders.clientOrderId, clientOrderId)).get();
  return row ? paperOrderFromRow(row) : undefined;
}

export function listPaperOrders(limit = 50): PaperOrder[] {
  return getDatabase().select().from(paperOrders).orderBy(desc(paperOrders.createdAt))
    .limit(Math.max(1, Math.min(100, limit))).all()
    .flatMap((row) => {
      const order = paperOrderFromRow(row);
      return order ? [order] : [];
    });
}

function asOrderPreview(row: typeof orderPreviews.$inferSelect): OrderPreview | undefined {
  if (row.side !== "buy" && row.side !== "sell") return undefined;
  if (row.mode !== "paper" || !(["prepared", "confirmed", "dismissed", "expired"] as string[]).includes(row.status)) return undefined;
  return {
    id: row.id,
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
  getDatabase().insert(orderPreviews).values({ ...preview }).run();
}

export function getOrderPreview(id: string): OrderPreview | undefined {
  const row = getDatabase().select().from(orderPreviews).where(eq(orderPreviews.id, id)).get();
  return row ? asOrderPreview(row) : undefined;
}

export function listOrderPreviews(symbol?: string, limit = 20): OrderPreview[] {
  const rows = getDatabase().select().from(orderPreviews).orderBy(desc(orderPreviews.createdAt))
    .limit(Math.max(1, Math.min(50, limit))).all();
  const now = Date.now();
  return rows.flatMap((row) => {
    const preview = asOrderPreview(row);
    if (!preview || (symbol && preview.symbol !== symbol)) return [];
    if (preview.status === "prepared" && Date.parse(preview.expiresAt) <= now) {
      getDatabase().update(orderPreviews).set({ status: "expired" })
        .where(and(eq(orderPreviews.id, preview.id), eq(orderPreviews.status, "prepared"))).run();
      return [{ ...preview, status: "expired" }];
    }
    return [preview];
  });
}

export function updateOrderPreview(id: string, changes: Pick<OrderPreview, "status"> & { orderId?: string | null }): void {
  getDatabase().update(orderPreviews).set({ status: changes.status, ...(changes.orderId === undefined ? {} : { orderId: changes.orderId }) })
    .where(eq(orderPreviews.id, id)).run();
}

function replaySessionFromRow(row: typeof replaySessions.$inferSelect): ReplaySession | undefined {
  if (!(["active", "finished"] as string[]).includes(row.status)) return undefined;
  try {
    const bars = JSON.parse(row.bars) as Candle[];
    if (!Array.isArray(bars)) return undefined;
    return {
      id: row.id,
      exchange: (EXCHANGE_IDS.includes(row.exchange as ExchangeId) ? row.exchange : "binance") as ExchangeId,
      symbol: row.symbol,
      timeframe: row.timeframe as Timeframe,
      startAt: row.startAt,
      cursor: row.cursor,
      bars,
      status: row.status as ReplaySession["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch {
    return undefined;
  }
}

export function createReplaySession(session: ReplaySession): void {
  getDatabase().insert(replaySessions).values({
    id: session.id,
    exchange: session.exchange,
    symbol: session.symbol,
    timeframe: session.timeframe,
    startAt: session.startAt,
    cursor: session.cursor,
    bars: JSON.stringify(session.bars),
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }).run();
}

export function getReplaySession(id: string): ReplaySession | undefined {
  const row = getDatabase().select().from(replaySessions).where(eq(replaySessions.id, id)).get();
  return row ? replaySessionFromRow(row) : undefined;
}

export function advanceReplaySession(id: string, expectedCursor: number, candle: Candle): { session: ReplaySession; deduplicated: boolean } {
  const db = getDatabase();
  return db.transaction((tx) => {
    const row = tx.select().from(replaySessions).where(eq(replaySessions.id, id)).get();
    const current = row ? replaySessionFromRow(row) : undefined;
    if (!current) throw new Error("Replay session not found or invalid.");
    if (current.status !== "active" || current.cursor !== expectedCursor) return { session: current, deduplicated: true };
    if (candle.timestamp <= current.cursor) throw new Error("Replay candle must move strictly forward.");
    const bars = [...current.bars, candle].slice(-1000);
    const updated: ReplaySession = { ...current, cursor: candle.timestamp, bars, updatedAt: new Date().toISOString() };
    tx.update(replaySessions).set({ cursor: updated.cursor, bars: JSON.stringify(updated.bars), updatedAt: updated.updatedAt })
      .where(and(eq(replaySessions.id, id), eq(replaySessions.cursor, expectedCursor), eq(replaySessions.status, "active"))).run();
    const savedRow = tx.select().from(replaySessions).where(eq(replaySessions.id, id)).get();
    const saved = savedRow ? replaySessionFromRow(savedRow) : undefined;
    if (!saved) throw new Error("Replay session update failed.");
    return { session: saved, deduplicated: saved.cursor !== candle.timestamp };
  });
}

export function finishReplaySession(id: string): ReplaySession | undefined {
  const db = getDatabase();
  db.update(replaySessions).set({ status: "finished", updatedAt: new Date().toISOString() })
    .where(and(eq(replaySessions.id, id), eq(replaySessions.status, "active"))).run();
  return getReplaySession(id);
}
